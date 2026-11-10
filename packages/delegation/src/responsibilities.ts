import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { Clock } from "./gate.js";
import type { Kind } from "./kinds.js";
import type { Principal, Transaction } from "./principal.js";
import { principal as mint, withOwner } from "./principal.js";

/**
 * The Temporal Schedules that start a Responsibility's Runs (ADR-0006). A port, because `delegation` never imports
 * Temporal; each call must be idempotent, so a repeated pause or end is harmless.
 */
export interface Schedules {
  create(r: {
    responsibilityId: string;
    studentId: string;
    timeZone: string;
  }): Promise<void>;
  pause(responsibilityId: string): Promise<void>;
  unpause(responsibilityId: string): Promise<void>;
  delete(responsibilityId: string): Promise<void>;
}

/** The pilot presets and the Grants each holds on its scope. */
const presets = {
  keep_course_organized: ["studyBlock.create", "studyBlock.move"] as Kind[],
  prepare_for_exam: ["studyBlock.create", "studyBlock.move"] as Kind[],
};
export type Preset = keyof typeof presets;

/** What a Responsibility covers: one Course, or one exam. Its Grants and its Runs' proposals take exactly this. */
export type ResponsibilityScope =
  | { courseId: string }
  | { obligationId: string };
/** The scope as stored: an exam's row also keeps the exam's Course, for showing. */
const scopeOf = (r: {
  courseId: string | null;
  obligationId: string | null;
}): ResponsibilityScope =>
  r.obligationId ? { obligationId: r.obligationId } : { courseId: r.courseId! };

/** Why a Responsibility is Paused: by the student, by exhausting its Budget, or by its Course being Archived. */
export type PausedBy = "student" | "budget" | "course_archived";

/** nunio no longer acts for an Archived Course, so no Responsibility on it may run. */
const isCourseArchived = async (tx: Transaction, courseId: string | null) =>
  Boolean(
    courseId &&
      (await tx.course.findFirst({
        where: { id: courseId, archivedAt: { not: null } },
      })),
  );

/** Ongoing delegations the student owns: records plus the Schedules that start their Runs. */
export function createResponsibilities({
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
      throw new Error(
        "createResponsibilities needs schedules to change a Responsibility",
      );
    return schedules;
  };
  // Re-read committed authority under a lock so a delayed command cannot overwrite a newer Schedule state.
  const syncSchedule = (p: Principal, id: string) =>
    withOwner(db, p, async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "responsibility" WHERE "id" = ${id} FOR UPDATE`;
      const r = await tx.responsibility.findUnique({ where: { id } });
      if (r?.state === "paused") await scheduled().pause(id);
      else if (r?.state === "active") await scheduled().unpause(id);
      else if (r?.state === "ended") await scheduled().delete(id);
    });
  /** Moves a Course's Responsibilities in `from` to a new state, then syncs each one's Schedule after the commit. */
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
        await tx.responsibility.findMany({
          where: { courseId, state: from },
          select: { id: true },
        })
      ).map((r) => r.id);
      const data = to();
      await tx.responsibility.updateMany({ where: { id: { in: ids } }, data });
      if (data.state === "ended")
        await tx.grant.deleteMany({ where: { responsibilityId: { in: ids } } });
      return ids;
    });
    for (const id of ids) await syncSchedule(p, id);
  };
  return {
    async create(
      p: Principal,
      input: (
        | { preset: "keep_course_organized"; courseId: string }
        | { preset: "prepare_for_exam"; obligationId: string }
      ) & { budgetMicroUsd: number },
    ) {
      if (p.kind !== "student") return { status: "gone" } as const;
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
        await tx.responsibility.create({
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
            responsibilityId: id,
            kind,
            ...scope,
          })),
        });
        const timeZone =
          (await tx.planPreference.findFirst())?.timeZone ?? "Europe/Berlin";
        // Inside the transaction: if the Schedule cannot be created, no Responsibility is recorded.
        await scheduled().create({ responsibilityId: id, studentId, timeZone });
        return { status: "ok", id } as const;
      });
    },

    /** Takes no further Actions, including in a Run under way, while keeping its Grants. */
    async pause(p: Principal, id: string) {
      if (p.kind !== "student") return { status: "gone" } as const;
      const found = await withOwner(db, p, async (tx) => {
        await tx.responsibility.updateMany({
          where: { id, state: "active" },
          data: { state: "paused", pausedBy: "student" },
        });
        return (
          (await tx.responsibility.findUnique({ where: { id } }))?.state ===
          "paused"
        );
      });
      if (!found) return { status: "gone" } as const;
      // After the commit: the record is what the gate checks, so a Run firing meanwhile is refused anyway.
      await syncSchedule(p, id);
      return { status: "ok" } as const;
    },

    /** Only the student resumes a Paused Responsibility, whoever paused it, and not while its Course is Archived. */
    async resume(p: Principal, id: string) {
      if (p.kind !== "student") return { status: "gone" } as const;
      const found = await withOwner(db, p, async (tx) => {
        const r = await tx.responsibility.findUnique({ where: { id } });
        if (r && (await isCourseArchived(tx, r.courseId)))
          return "course_archived";
        await tx.responsibility.updateMany({
          where: { id, state: "paused" },
          data: { state: "active", pausedBy: null },
        });
        return (
          (await tx.responsibility.findUnique({ where: { id } }))?.state ===
          "active"
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
        await tx.responsibility.updateMany({
          where: { id, state: { not: "ended" } },
          data: { state: "ended", endedAt: clock.now() },
        });
        await tx.grant.deleteMany({ where: { responsibilityId: id } });
        return Boolean(await tx.responsibility.findUnique({ where: { id } }));
      });
      if (!found) return { status: "gone" } as const;
      await syncSchedule(p, id);
      return { status: "ok" } as const;
    },

    /** Pauses every active Responsibility on an Archived Course; only the student resumes them. */
    async pauseForCourse(p: Principal, courseId: string) {
      await changeForCourse(p, courseId, "active", () => ({
        state: "paused",
        pausedBy: "course_archived",
      }));
    },

    /** Ends every Responsibility on a Course being deleted; their Grants go and their history remains. */
    async endForCourse(p: Principal, courseId: string) {
      await changeForCourse(p, courseId, { not: "ended" }, () => ({
        state: "ended",
        endedAt: clock.now(),
      }));
    },

    /** The student's Responsibilities, newest first, Ended ones included: their history remains. */
    async list(p: Principal) {
      return withOwner(db, p, async (tx) =>
        (
          await tx.responsibility.findMany({ orderBy: { createdAt: "desc" } })
        ).map((r) => ({
          id: r.id,
          preset: r.preset as Preset,
          scope: scopeOf(r),
          state: r.state as "active" | "paused" | "ended",
          pausedBy: r.pausedBy as PausedBy | null,
        })),
      );
    },

    /** Its scope, state, Grants, and usage against its Budget; null when it is not the student's. */
    async view(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        const r = await tx.responsibility.findUnique({
          where: { id },
          include: { grants: true },
        });
        if (!r) return null;
        return {
          id: r.id,
          preset: r.preset as Preset,
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

    /** The scope of the Responsibility a Run belongs to; null for a Run without one. */
    async scopeOfRun(runId: string): Promise<ResponsibilityScope | null> {
      return withOwner(db, mint.fromRun(runId), async (tx) => {
        const run = await tx.run.findUnique({
          where: { id: runId },
          include: { responsibility: true },
        });
        return run?.responsibility ? scopeOf(run.responsibility) : null;
      });
    },

    /** Records a Run of an active Responsibility, as its Schedule fires; null when it is not active. */
    async startRun({
      studentId,
      responsibilityId,
      runId,
      workflowId,
    }: {
      studentId: string;
      responsibilityId: string;
      /** Stable across retries of the workflow's startup Activity. */
      runId: string;
      /** The workflow to signal once the student decides on one of the Run's Actions. */
      workflowId: string;
    }) {
      return withOwner(db, mint.fromSession({ studentId }), async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "responsibility" WHERE "id" = ${responsibilityId} FOR UPDATE`;
        const existing = await tx.run.findUnique({ where: { id: runId } });
        if (existing)
          return existing.responsibilityId === responsibilityId
            ? existing.id
            : null;
        const responsibility = await tx.responsibility.findUnique({
          where: { id: responsibilityId },
        });
        if (responsibility?.state !== "active") return null;
        const run = await tx.run.create({
          data: { id: runId, studentId, responsibilityId, workflowId },
        });
        return run.id;
      });
    },

    /**
     * Records a Run the student started, from a Chat or elsewhere: it has no Responsibility and so no Grants (ADR-0001).
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
        throw new Error("Only a student starts a Run without a Responsibility");
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
            run && !run.responsibilityId && run.chatId === (chatId ?? null)
              ? "ok"
              : "gone",
        };
      });
    },
  };
}
export type Responsibilities = ReturnType<typeof createResponsibilities>;
