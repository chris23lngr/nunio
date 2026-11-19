import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { AgentCapability, ApprovalMode } from "./capabilities.js";
import {
  capabilityIds,
  checkCapabilities,
  grantedKinds,
} from "./capabilities.js";
import type { Clock } from "./gate.js";
import type { Kind } from "./kinds.js";
import type { Principal, Transaction } from "./principal.js";
import { principal as mint, withOwner } from "./principal.js";

/**
 * The Temporal Schedules that start an Agent's Runs (ADR-0006). A port, because `delegation` never imports
 * Temporal; each call must be idempotent, so a repeated pause or end is harmless.
 */
export interface Schedules {
  create(r: {
    agentId: string;
    studentId: string;
    timeZone: string;
  }): Promise<void>;
  pause(agentId: string): Promise<void>;
  unpause(agentId: string): Promise<void>;
  delete(agentId: string): Promise<void>;
}

/** The pilot presets and the Grants each holds on its scope. */
const presets = {
  keep_course_organized: ["studyBlock.create", "studyBlock.move"] as Kind[],
  prepare_for_exam: ["studyBlock.create", "studyBlock.move"] as Kind[],
};
export type Preset = keyof typeof presets;

/** What a preset Agent covers: one Course, or one exam. Its Grants and its Runs' proposals take exactly this. */
export type AgentScope = { courseId: string } | { obligationId: string };
/** The scope as stored: an exam's row also keeps the exam's Course, for showing. Null for a free-text Agent. */
const scopeOf = (r: {
  preset: string | null;
  courseId: string | null;
  obligationId: string | null;
}): AgentScope | null =>
  !r.preset
    ? null
    : r.obligationId
      ? { obligationId: r.obligationId }
      : { courseId: r.courseId! };

/** The form a free-text Agent is created and edited with: all of it is saved at once. */
export type AgentForm = {
  name: string;
  description: string;
  emoji: string;
  instructions: string;
  /** Its Courses, its scope: at least one. */
  courseIds: string[];
  /** Its Capabilities, each with its mode. */
  capabilities: { id: string; mode: string }[];
  budgetMicroUsd: number;
};

/**
 * Stores an Agent's Capabilities and keeps its Grants in step: one, unscoped, for each kind a Capability on `always`
 * or `automatic` takes, and none once the Agent is Ended. The gate reads them at each Action, so a change applies at
 * the next one.
 */
async function saveCapabilities(
  tx: Transaction,
  agent: { id: string; studentId: string; state: string },
  held: AgentCapability[],
) {
  const { id: agentId, studentId } = agent;
  await tx.agentCapability.deleteMany({ where: { agentId } });
  await tx.agentCapability.createMany({
    data: held.map(({ id, mode }) => ({
      agentId,
      studentId,
      capability: id,
      mode,
    })),
  });
  const kinds = agent.state === "ended" ? [] : grantedKinds(held);
  await tx.grant.deleteMany({ where: { agentId, kind: { notIn: kinds } } });
  const kept = await tx.grant.findMany({ where: { agentId } });
  await tx.grant.createMany({
    data: kinds
      .filter((kind) => !kept.some((g) => g.kind === kind))
      .map((kind) => ({ id: randomUUID(), studentId, agentId, kind })),
  });
}

/**
 * The form's Courses, if each may be on the Agent: one of the student's accepted, unarchived Courses, or one the Agent
 * already has, Archived or not. Otherwise why not.
 */
async function checkCourses(
  tx: Transaction,
  courseIds: string[],
  kept: string[] = [],
) {
  const ids = [...new Set(courseIds)];
  if (!ids.length) return "invalid" as const;
  const found = await tx.course.findMany({ where: { id: { in: ids } } });
  for (const id of ids) {
    if (kept.includes(id)) continue;
    const course = found.find((c) => c.id === id);
    if (course?.status !== "accepted") return "gone" as const;
    if (course.archivedAt) return "course_archived" as const;
  }
  return ids;
}

/** Why an Agent is Paused: by the student, by exhausting its Budget, or by its Course being Archived. */
export type PausedBy = "student" | "budget" | "course_archived";

/** nunio no longer acts for an Archived Course, so no Agent on it may run. */
const isCourseArchived = async (tx: Transaction, courseId: string | null) =>
  Boolean(
    courseId &&
      (await tx.course.findFirst({
        where: { id: courseId, archivedAt: { not: null } },
      })),
  );

/** Ongoing delegations the student owns: records plus the Schedules that start their Runs. */
export function createAgents({
  db,
  schedules,
  clock,
}: {
  db: PrismaClient;
  /** Needed only to create, pause, resume or end; the worker only starts Runs. */
  schedules?: Schedules;
  clock: Clock;
}) {
  const scheduled = () => {
    if (!schedules)
      throw new Error("createAgents needs schedules to change an Agent");
    return schedules;
  };
  // Re-read committed authority under a lock so a delayed command cannot overwrite a newer Schedule state.
  const syncSchedule = (p: Principal, id: string) =>
    withOwner(db, p, async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${id} FOR UPDATE`;
      const r = await tx.agent.findUnique({ where: { id } });
      // Until Agents get their trigger, only a preset Agent has a Schedule.
      if (!r?.preset) return;
      if (r?.state === "paused") await scheduled().pause(id);
      else if (r?.state === "active") await scheduled().unpause(id);
      else if (r?.state === "ended") await scheduled().delete(id);
    });
  /** Moves a Course's Agents in `from` to a new state, then syncs each one's Schedule after the commit. */
  const changeForCourse = async (
    p: Principal,
    courseId: string,
    from: "active" | { not: "ended" },
    to: () =>
      | { state: "paused"; pausedBy: PausedBy }
      | { state: "ended"; endedAt: Date },
  ) => {
    if (p.kind !== "student") return;
    const ids = await withOwner(db, p, async (tx) => {
      const ids = (
        await tx.agent.findMany({
          where: { courseId, state: from },
          select: { id: true },
        })
      ).map((r) => r.id);
      const data = to();
      await tx.agent.updateMany({ where: { id: { in: ids } }, data });
      if (data.state === "ended")
        await tx.grant.deleteMany({ where: { agentId: { in: ids } } });
      return ids;
    });
    for (const id of ids) await syncSchedule(p, id);
  };
  return {
    /** A pilot preset with its Grants and Schedule, or a free-text Agent from its form, which has neither yet. */
    async create(
      p: Principal,
      input:
        | ((
            | { preset: "keep_course_organized"; courseId: string }
            | { preset: "prepare_for_exam"; obligationId: string }
          ) & { budgetMicroUsd: number })
        | AgentForm,
    ) {
      if (p.kind !== "student") return { status: "gone" } as const;
      if (!("preset" in input))
        return withOwner(db, p, async (tx, studentId) => {
          const held = checkCapabilities(input.capabilities);
          if (!held) return { status: "invalid" } as const;
          const courseIds = await checkCourses(tx, input.courseIds);
          if (typeof courseIds === "string")
            return { status: courseIds } as const;
          const id = randomUUID();
          const { courseIds: _, capabilities: __, ...fields } = input;
          const agent = await tx.agent.create({
            data: { id, studentId, ...fields },
          });
          await tx.agentCourse.createMany({
            data: courseIds.map((courseId) => ({
              agentId: id,
              courseId,
              studentId,
            })),
          });
          await saveCapabilities(tx, agent, held);
          return { status: "ok", id } as const;
        });
      return withOwner(db, p, async (tx, studentId) => {
        // The scope, and the Course stored beside it: the Course itself, or the exam's.
        const found =
          input.preset === "keep_course_organized"
            ? (await tx.course.findFirst({
                where: { id: input.courseId, status: { not: "merged" } },
              }))
              ? {
                  scope: { courseId: input.courseId },
                  courseId: input.courseId,
                }
              : null
            : await tx.obligation
                .findFirst({
                  where: {
                    id: input.obligationId,
                    kind: "exam",
                    state: { not: "rejected" },
                    course: { status: { notIn: ["merged", "rejected"] } },
                  },
                })
                .then((o) =>
                  o
                    ? { scope: { obligationId: o.id }, courseId: o.courseId }
                    : null,
                );
        if (!found) return { status: "gone" } as const;
        if (await isCourseArchived(tx, found.courseId))
          return { status: "course_archived" } as const;
        const { scope } = found;
        const id = randomUUID();
        await tx.agent.create({
          data: {
            id,
            studentId,
            preset: input.preset,
            courseId: found.courseId,
            obligationId: "obligationId" in scope ? scope.obligationId : null,
            budgetMicroUsd: input.budgetMicroUsd,
          },
        });
        await tx.grant.createMany({
          data: presets[input.preset].map((kind) => ({
            id: randomUUID(),
            studentId,
            agentId: id,
            kind,
            ...scope,
          })),
        });
        const timeZone =
          (await tx.planPreference.findFirst())?.timeZone ?? "Europe/Berlin";
        // Inside the transaction: if the Schedule cannot be created, no Agent is recorded.
        await scheduled().create({ agentId: id, studentId, timeZone });
        return { status: "ok", id } as const;
      });
    },

    /**
     * Saves a free-text Agent's whole form; its next Run reads it. Its Courses may keep one that was Archived since.
     * A preset Agent has no form until the Agents cutover converts it, so it is "invalid".
     */
    async update(p: Principal, id: string, form: AgentForm) {
      if (p.kind !== "student") return { status: "gone" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        // Serialises saves, and the gate's read of the Grants, on the Agent.
        await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${id} FOR UPDATE`;
        const r = await tx.agent.findUnique({
          where: { id },
          include: { courses: true },
        });
        if (!r) return { status: "gone" } as const;
        if (r.preset) return { status: "invalid" } as const;
        const held = checkCapabilities(form.capabilities);
        if (!held) return { status: "invalid" } as const;
        const courseIds = await checkCourses(
          tx,
          form.courseIds,
          r.courses.map((c) => c.courseId),
        );
        if (typeof courseIds === "string")
          return { status: courseIds } as const;
        const { courseIds: _, capabilities: __, ...fields } = form;
        await tx.agent.update({ where: { id }, data: fields });
        await saveCapabilities(tx, r, held);
        await tx.agentCourse.deleteMany({
          where: { agentId: id, courseId: { notIn: courseIds } },
        });
        await tx.agentCourse.createMany({
          data: courseIds.map((courseId) => ({
            agentId: id,
            courseId,
            studentId,
          })),
          skipDuplicates: true,
        });
        return { status: "ok" } as const;
      });
    },

    /** Takes no further Actions, including in a Run under way, while keeping its Grants. */
    async pause(p: Principal, id: string) {
      if (p.kind !== "student") return { status: "gone" } as const;
      const found = await withOwner(db, p, async (tx) => {
        await tx.agent.updateMany({
          where: { id, state: "active" },
          data: { state: "paused", pausedBy: "student" },
        });
        return (
          (await tx.agent.findUnique({ where: { id } }))?.state === "paused"
        );
      });
      if (!found) return { status: "gone" } as const;
      // After the commit: the record is what the gate checks, so a Run firing meanwhile is refused anyway.
      await syncSchedule(p, id);
      return { status: "ok" } as const;
    },

    /** Only the student resumes a Paused Agent, whoever paused it, and not while its Course is Archived. */
    async resume(p: Principal, id: string) {
      if (p.kind !== "student") return { status: "gone" } as const;
      const found = await withOwner(db, p, async (tx) => {
        const r = await tx.agent.findUnique({ where: { id } });
        if (r && (await isCourseArchived(tx, r.courseId)))
          return "course_archived";
        await tx.agent.updateMany({
          where: { id, state: "paused" },
          data: { state: "active", pausedBy: null },
        });
        return (
          (await tx.agent.findUnique({ where: { id } }))?.state === "active"
        );
      });
      if (found === "course_archived")
        return { status: "course_archived" } as const;
      if (!found) return { status: "gone" } as const;
      await syncSchedule(p, id);
      return { status: "ok" } as const;
    },

    /** Stops for good: its Grants are gone and its history remains. */
    async end(p: Principal, id: string) {
      if (p.kind !== "student") return { status: "gone" } as const;
      const found = await withOwner(db, p, async (tx) => {
        await tx.agent.updateMany({
          where: { id, state: { not: "ended" } },
          data: { state: "ended", endedAt: clock.now() },
        });
        await tx.grant.deleteMany({ where: { agentId: id } });
        return Boolean(await tx.agent.findUnique({ where: { id } }));
      });
      if (!found) return { status: "gone" } as const;
      await syncSchedule(p, id);
      return { status: "ok" } as const;
    },

    /** Pauses every active Agent on an Archived Course; only the student resumes them. */
    async pauseForCourse(p: Principal, courseId: string) {
      await changeForCourse(p, courseId, "active", () => ({
        state: "paused",
        pausedBy: "course_archived",
      }));
    },

    /** Ends every Agent on a Course being deleted; their Grants go and their history remains. */
    async endForCourse(p: Principal, courseId: string) {
      await changeForCourse(p, courseId, { not: "ended" }, () => ({
        state: "ended",
        endedAt: clock.now(),
      }));
    },

    /** The student's Agents, newest first, Ended ones included: their history remains. */
    async list(p: Principal) {
      return withOwner(db, p, async (tx) =>
        (await tx.agent.findMany({ orderBy: { createdAt: "desc" } })).map(
          (r) => ({
            id: r.id,
            preset: r.preset as Preset | null,
            name: r.name,
            emoji: r.emoji,
            scope: scopeOf(r),
            state: r.state as "active" | "paused" | "ended",
            pausedBy: r.pausedBy as PausedBy | null,
          }),
        ),
      );
    },

    /** Its form, scope, state, Grants, and usage against its Budget; null when it is not the student's. */
    async view(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        const r = await tx.agent.findUnique({
          where: { id },
          include: {
            grants: true,
            courses: { include: { course: true } },
            capabilities: true,
          },
        });
        if (!r) return null;
        return {
          id: r.id,
          preset: r.preset as Preset | null,
          name: r.name,
          description: r.description,
          emoji: r.emoji,
          instructions: r.instructions,
          courses: r.courses
            .map(({ course }) => ({
              id: course.id,
              title: course.title,
              color: course.color,
              archived: course.archivedAt !== null,
            }))
            .sort((a, b) => a.title.localeCompare(b.title, "de")),
          // In the capability set's order. One no longer in code is left out.
          capabilities: capabilityIds.flatMap((capability) =>
            r.capabilities
              .filter((c) => c.capability === capability)
              .map((c) => ({ id: capability, mode: c.mode as ApprovalMode })),
          ),
          scope: scopeOf(r),
          state: r.state as "active" | "paused" | "ended",
          pausedBy: r.pausedBy as PausedBy | null,
          grants: r.grants.map((g) => ({
            kind: g.kind as Kind,
            courseId: g.courseId,
            obligationId: g.obligationId,
          })),
          budget: {
            limitMicroUsd: Number(r.budgetMicroUsd),
            usedMicroUsd: Number(r.usedMicroUsd),
            heldMicroUsd: Number(r.heldMicroUsd),
          },
        };
      });
    },

    /** The scope of the Agent a Run belongs to; null for a Run without one. */
    async scopeOfRun(runId: string): Promise<AgentScope | null> {
      return withOwner(db, mint.fromRun(runId), async (tx) => {
        const run = await tx.run.findUnique({
          where: { id: runId },
          include: { agent: true },
        });
        return run?.agent ? scopeOf(run.agent) : null;
      });
    },

    /** Records a Run of an active Agent, as its Schedule fires; null when it is not active. */
    async startRun({
      studentId,
      agentId,
      runId,
      workflowId,
    }: {
      studentId: string;
      agentId: string;
      /** Stable across retries of the workflow's startup Activity. */
      runId: string;
      /** The workflow to signal once the student decides on one of the Run's Actions. */
      workflowId: string;
    }) {
      return withOwner(db, mint.fromSession({ studentId }), async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${agentId} FOR UPDATE`;
        const existing = await tx.run.findUnique({ where: { id: runId } });
        if (existing) return existing.agentId === agentId ? existing.id : null;
        const agent = await tx.agent.findUnique({
          where: { id: agentId },
        });
        if (agent?.state !== "active") return null;
        const run = await tx.run.create({
          data: { id: runId, studentId, agentId, workflowId },
        });
        return run.id;
      });
    },

    /**
     * Records a Run the student started, from a Chat or elsewhere: it has no Agent and so no Grants (ADR-0001).
     * Idempotent on `runId`; "gone" for a Chat that is not the student's, or a `runId` already used otherwise.
     */
    async startStudentRun(
      student: Principal,
      {
        runId,
        workflowId,
        chatId,
      }: { runId: string; workflowId: string; chatId?: string },
    ): Promise<{ status: "ok" | "gone" }> {
      if (student.kind !== "student")
        throw new Error("Only a student starts a Run without an Agent");
      return withOwner(db, student, async (tx, studentId) => {
        // RLS hides another student's Chat, so it counts as gone like one that never existed.
        if (chatId && !(await tx.chat.findUnique({ where: { id: chatId } })))
          return { status: "gone" };
        // A concurrent start, or another student's Run under the same ID, leaves the existing row in place.
        await tx.run.createMany({
          data: [{ id: runId, studentId, workflowId, chatId: chatId ?? null }],
          skipDuplicates: true,
        });
        const run = await tx.run.findUnique({ where: { id: runId } });
        return {
          status:
            run && !run.agentId && run.chatId === (chatId ?? null)
              ? "ok"
              : "gone",
        };
      });
    },
  };
}
export type Agents = ReturnType<typeof createAgents>;
