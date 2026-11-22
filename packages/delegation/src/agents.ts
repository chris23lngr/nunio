import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { budgetMonth, usedIn } from "./budget.js";
import type {
  AgentCapability,
  ApprovalMode,
  CapabilityId,
} from "./capabilities.js";
import {
  capabilityIds,
  checkCapabilities,
  grantedKinds,
} from "./capabilities.js";
import { runCaps } from "./decision.js";
import type { Clock } from "./gate.js";
import { openApprovalAt, withdrawApprovals } from "./gate.js";
import type { Kind } from "./kinds.js";
import { createModelCatalog } from "./model-catalog.js";
import type { Principal, Transaction } from "./principal.js";
import { principal as mint, withOwner } from "./principal.js";
import { agentTemplates, isTemplateId, templateIds } from "./templates.js";

/**
 * When an Agent's Schedule starts its Runs, in the Plan's time zone: Täglich, or on chosen Wochentage, at a minute of
 * the day (Uhrzeit). The only rhythms of v1.
 */
export type AgentTrigger =
  | { rhythm: "daily"; minute: number }
  /** ISO weekdays: 1 is Monday, 7 is Sunday. */
  | { rhythm: "weekdays"; weekdays: number[]; minute: number };

/** The trigger, Wochentage in order, if it is one of the v1 rhythms; otherwise null. The form and the builder hold to it. */
export function checkTrigger(trigger: AgentTrigger): AgentTrigger | null {
  const { minute } = trigger;
  if (!Number.isInteger(minute) || minute < 0 || minute >= 24 * 60) return null;
  if (trigger.rhythm === "daily")
    return "weekdays" in trigger ? null : { rhythm: "daily", minute };
  if (trigger.rhythm !== "weekdays" || !Array.isArray(trigger.weekdays))
    return null;
  const weekdays = [...new Set(trigger.weekdays)].sort((a, b) => a - b);
  if (
    !weekdays.length ||
    weekdays.length !== trigger.weekdays.length ||
    weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
  )
    return null;
  return { rhythm: "weekdays", weekdays, minute };
}

/** The trigger as stored on the Agent's row. */
const triggerOf = (r: {
  triggerRhythm: string;
  triggerWeekdays: number[];
  triggerMinute: number;
}): AgentTrigger =>
  r.triggerRhythm === "weekdays"
    ? {
        rhythm: "weekdays",
        weekdays: r.triggerWeekdays,
        minute: r.triggerMinute,
      }
    : { rhythm: "daily", minute: r.triggerMinute };
const triggerColumns = (trigger: AgentTrigger) => ({
  triggerRhythm: trigger.rhythm,
  triggerWeekdays: trigger.rhythm === "weekdays" ? trigger.weekdays : [],
  triggerMinute: trigger.minute,
});

/**
 * The Temporal Schedules that start an Agent's Runs (ADR-0006). A port, because `delegation` never imports
 * Temporal; each call must be idempotent, so a repeated pause or end is harmless.
 */
export interface Schedules {
  /** An Agent's Schedule, created or brought in line with its trigger, time zone and Paused state. */
  save(r: {
    agentId: string;
    studentId: string;
    timeZone: string;
    trigger: AgentTrigger;
    paused: boolean;
  }): Promise<void>;
  delete(agentId: string): Promise<void>;
}

/** The form an Agent is created and edited with: all of it is saved at once. */
export type AgentForm = {
  name: string;
  description: string;
  emoji: string;
  instructions: string;
  /** Its Courses, its scope: at least one. */
  courseIds: string[];
  /** Its Capabilities, each with its mode; null for one that is no Action. */
  capabilities: { id: string; mode: string | null }[];
  budgetMicroUsd: number;
  trigger: AgentTrigger;
  /** The Model its Runs run on: one Chat offers, or the one it already has. */
  modelKey: string;
};

/** The Plan's time zone, which an Agent's trigger is in. */
const timeZoneOf = async (tx: Transaction) =>
  (await tx.planPreference.findFirst())?.timeZone ?? "Europe/Berlin";

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

/**
 * Why an Agent is Paused: by the student, by exhausting its Budget, by all its Courses being Archived, by losing its
 * last Course, or by nunio when it made the Agent from one of the student's earlier delegations (decision #160).
 */
export type PausedBy =
  | "student"
  | "budget"
  | "course_archived"
  | "no_course"
  | "conversion";

/**
 * Why an Agent with these Courses has none left to act for: all are Archived, `archiving` counting as Archived
 * already, or it has none. Null while one is in scope.
 */
function outOfCourses(
  courses: {
    courseId: string;
    course: { status: string; archivedAt: Date | null };
  }[],
  archiving?: string,
): "course_archived" | "no_course" | null {
  const accepted = courses.filter((c) => c.course.status === "accepted");
  if (accepted.some((c) => !c.course.archivedAt && c.courseId !== archiving))
    return null;
  return accepted.length ? "course_archived" : "no_course";
}

/**
 * The one badge an Agent's row shows: Pausiert, Freigabe benötigt (one of its Runs has an open Approval), Läuft
 * gerade (one of its Runs is under way) or Beendet; null when none applies. An Ended Agent reads Beendet even while
 * one of its Runs is still asking or under way: it can no longer act on either.
 */
export type AgentBadge = "paused" | "approval_needed" | "running" | "ended";

function badgeOf(
  state: "active" | "paused" | "ended",
  asking: boolean,
  running: boolean,
): AgentBadge | null {
  if (state === "paused") return "paused";
  if (state === "ended") return "ended";
  if (asking) return "approval_needed";
  return running ? "running" : null;
}

const badgeRank = (badge: AgentBadge | null) =>
  badge === "ended"
    ? 4
    : badge === null
      ? 3
      : (["paused", "approval_needed", "running"] as const).indexOf(badge);

/** An Agent's Runs under way, each with the workflow that runs it. */
const runsUnderWay = async (tx: Transaction, agentId: string) =>
  (
    await tx.run.findMany({
      where: { agentId, status: "running" },
      select: { id: true, workflowId: true },
    })
  ).flatMap((r) =>
    r.workflowId ? [{ runId: r.id, workflowId: r.workflowId }] : [],
  );

/** A Run under way this long may have lost its workflow, such as one terminated, so Temporal is asked about it. */
const staleRunMs = 10 * 60_000;

export function createAgents({
  db,
  schedules,
  clock,
  runAlive,
}: {
  db: PrismaClient;
  /** Needed only to create, save, pause, resume, end or delete; the worker only starts Runs. */
  schedules?: Schedules;
  clock: Clock;
  /**
   * Whether the workflow of a Run still runs, asked on Temporal: a port, as `delegation` never imports Temporal.
   * Without it, a Run whose workflow is gone stays under way.
   */
  runAlive?: (workflowId: string) => Promise<boolean>;
}) {
  const catalog = createModelCatalog({ db, clock });
  /** Whether the Agent may run on the Model: one Chat offers now, or `kept`, the one it has, offered or not. */
  const checkModel = async (modelKey: string, kept?: string | null) =>
    modelKey === kept ||
    (await catalog.chatModels()).some((model) => model.key === modelKey);
  const scheduled = () => {
    if (!schedules)
      throw new Error("createAgents needs schedules to change an Agent");
    return schedules;
  };
  /**
   * Records that a Run under way has failed outside its workflow: one the student started never got under way, or its
   * workflow no longer runs. It no longer blocks the next, and its transcript is dropped as at any Run's end.
   */
  const failRun = (p: Principal, runId: string) =>
    withOwner(db, p, async (tx) => {
      const ended = await tx.run.updateMany({
        where: { id: runId, status: "running" },
        data: { status: "failed", endedAt: clock.now() },
      });
      if (ended.count)
        await tx.runStep.updateMany({
          where: { runId },
          data: { transcriptContent: null, transcriptKey: null },
        });
    });
  /**
   * Ends as failed each of `agentId`'s Runs under way a while whose workflow no longer runs, so it holds up no other Run
   * and reads no longer "Läuft gerade" (#174). If Temporal cannot be asked, it stays under way.
   */
  const failDeadRuns = async (p: Principal, agentId: string) => {
    if (!runAlive) return;
    const stale = await withOwner(db, p, (tx) =>
      tx.run.findMany({
        where: {
          agentId,
          status: "running",
          workflowId: { not: null },
          startedAt: { lt: new Date(clock.now().getTime() - staleRunMs) },
        },
        select: { id: true, workflowId: true },
      }),
    );
    for (const run of stale) {
      try {
        if (await runAlive(run.workflowId!)) continue;
      } catch (error) {
        console.error("Could not ask Temporal about an Agent's Run", error);
        continue;
      }
      await failRun(p, run.id);
    }
  };
  /**
   * Withdraws the Agent's open Approvals before its lock is taken: deciding and performing lock an Action and then its
   * Agent, so locking them in that order never deadlocks with them.
   */
  const withdrawBeforeLock = (tx: Transaction, studentId: string, id: string) =>
    withdrawApprovals(tx, { studentId, agentId: id }, clock.now());
  /** For each Agent, or only `agentId`, the oldest of its Runs with an Approval still open. */
  const oldestAsking = async (tx: Transaction, agentId?: string) => {
    const map = new Map<string, string>();
    for (const run of await tx.run.findMany({
      where: {
        agentId: agentId ?? { not: null },
        actions: { some: openApprovalAt(clock.now()) },
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { id: true, agentId: true },
    }))
      map.set(run.agentId!, run.id);
    return map;
  };
  /** Brings an Agent's Schedule in line with its row, read under its lock: gone once it is Ended. */
  const saveSchedule = async (
    tx: Transaction,
    r: {
      id: string;
      studentId: string;
      state: string;
      triggerRhythm: string;
      triggerWeekdays: number[];
      triggerMinute: number;
    },
  ) => {
    if (r.state === "ended") return scheduled().delete(r.id);
    await scheduled().save({
      agentId: r.id,
      studentId: r.studentId,
      timeZone: await timeZoneOf(tx),
      trigger: triggerOf(r),
      paused: r.state === "paused",
    });
  };
  // Re-read committed authority under a lock so a delayed command cannot overwrite a newer Schedule state.
  const syncSchedule = (p: Principal, id: string) =>
    withOwner(db, p, async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${id} FOR UPDATE`;
      const r = await tx.agent.findUnique({ where: { id } });
      if (r) await saveSchedule(tx, r);
    });
  /**
   * Brings the student's Agents in line with their Courses (#145): an entry on a merged Course moves to the
   * Course it went into, one on a Rejected Course or on `dropping` goes, and an active Agent left with no Course to act
   * for is Paused, `course_archived` when all its Courses are Archived (`archiving` counting as Archived already) and
   * `no_course` when it has none. Its open Approvals are withdrawn and, after the commit, its Schedule paused. Only the
   * student resumes it. Safe to repeat.
   */
  const settleCourses = async (
    p: Principal,
    { archiving, dropping }: { archiving?: string; dropping?: string } = {},
  ) => {
    if (p.kind !== "student") return;
    const paused = await withOwner(db, p, async (tx, studentId) => {
      await tx.agentCourse.deleteMany({
        where: {
          OR: [
            { course: { status: "rejected" } },
            ...(dropping ? [{ courseId: dropping }] : []),
          ],
        },
      });
      const merged = await tx.agentCourse.findMany({
        where: { course: { status: "merged" } },
        include: { course: true },
      });
      await tx.agentCourse.createMany({
        data: merged.flatMap(({ agentId, course }) =>
          course.mergedIntoId
            ? [{ agentId, courseId: course.mergedIntoId, studentId }]
            : [],
        ),
        skipDuplicates: true,
      });
      await tx.agentCourse.deleteMany({
        where: { course: { status: "merged" } },
      });
      const idle = async (ids?: string[]) =>
        (
          await tx.agent.findMany({
            where: { state: "active", id: { in: ids } },
            include: { courses: { include: { course: true } } },
          })
        ).flatMap((r) => {
          const pausedBy = outOfCourses(r.courses, archiving);
          return pausedBy ? [{ id: r.id, pausedBy }] : [];
        });
      const found = await idle();
      if (!found.length) return [];
      for (const { id } of found) await withdrawBeforeLock(tx, studentId, id);
      const ids = found.map((r) => r.id);
      await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ANY(${ids}) ORDER BY "id" FOR UPDATE`;
      // Again under the Agents' locks, for a Course added or an Approval asked meanwhile.
      const pausing = await idle(ids);
      for (const { id, pausedBy } of pausing) {
        await tx.agent.update({
          where: { id },
          data: { state: "paused", pausedBy },
        });
        await withdrawApprovals(tx, { studentId, agentId: id }, clock.now());
      }
      return pausing.map((r) => r.id);
    });
    for (const id of paused) await syncSchedule(p, id);
  };
  return {
    /**
     * An Agent from its form, with its Grants and the Schedule of its trigger. If the Schedule cannot be saved, no Agent
     * is recorded.
     */
    async create(
      p: Principal,
      input: AgentForm & { templateId?: string | null },
    ) {
      if (p.kind !== "student") return { status: "gone" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        const held = checkCapabilities(input.capabilities);
        const trigger = checkTrigger(input.trigger);
        const templateId = input.templateId ?? null;
        if (
          !held ||
          !trigger ||
          (templateId !== null && !isTemplateId(templateId))
        )
          return { status: "invalid" } as const;
        if (!(await checkModel(input.modelKey)))
          return { status: "model_unavailable" } as const;
        const courseIds = await checkCourses(tx, input.courseIds);
        if (typeof courseIds === "string")
          return { status: courseIds } as const;
        const id = randomUUID();
        const {
          courseIds: _,
          capabilities: __,
          trigger: ___,
          templateId: ____,
          ...fields
        } = input;
        const agent = await tx.agent.create({
          data: {
            id,
            studentId,
            templateId,
            ...fields,
            ...triggerColumns(trigger),
          },
        });
        await tx.agentCourse.createMany({
          data: courseIds.map((courseId) => ({
            agentId: id,
            courseId,
            studentId,
          })),
        });
        await saveCapabilities(tx, agent, held);
        await saveSchedule(tx, agent);
        return { status: "ok", id } as const;
      });
    },

    /**
     * Saves an Agent's whole form; its next Run reads it, and its Schedule follows its trigger. Its Courses may keep one
     * that was Archived since, pausing it once all are, and it may keep a Model Chat no longer offers.
     */
    async update(p: Principal, id: string, form: AgentForm) {
      if (p.kind !== "student") return { status: "gone" } as const;
      const result = await withOwner(db, p, async (tx, studentId) => {
        // Serialises saves, and the gate's read of the Grants, on the Agent.
        await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${id} FOR UPDATE`;
        const r = await tx.agent.findUnique({
          where: { id },
          include: { courses: true },
        });
        if (!r) return { status: "gone" } as const;
        const held = checkCapabilities(form.capabilities);
        const trigger = checkTrigger(form.trigger);
        if (!held || !trigger) return { status: "invalid" } as const;
        if (!(await checkModel(form.modelKey, r.modelKey)))
          return { status: "model_unavailable" } as const;
        const courseIds = await checkCourses(
          tx,
          form.courseIds,
          r.courses.map((c) => c.courseId),
        );
        if (typeof courseIds === "string")
          return { status: courseIds } as const;
        const {
          courseIds: _,
          capabilities: __,
          trigger: ___,
          ...fields
        } = form;
        const saved = await tx.agent.update({
          where: { id },
          data: { ...fields, ...triggerColumns(trigger) },
        });
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
        // Under the Agent's lock, so a concurrent Pause or End saves its Schedule after this one.
        await saveSchedule(tx, saved);
        return { status: "ok" } as const;
      });
      // Kept Courses may all be Archived: it then has none left to act for.
      if (result.status === "ok") await settleCourses(p);
      return result;
    },

    /**
     * Brings the Schedule of every Agent not Ended in line with its trigger, as the worker starts: one whose Schedule is
     * missing or out of date gets it, and their IDs are returned, so the worker deletes any other Agent's Schedule.
     * Safe to repeat. One Agent's failure leaves the others' to go on, and then it rejects, so the worker does not start
     * while an Agent may have no Schedule.
     */
    async saveSchedules() {
      const found = await db.$queryRaw<
        { agentId: string; studentId: string }[]
      >`SELECT "agentId", "studentId" FROM scheduled_agents()`;
      const failed: unknown[] = [];
      for (const { agentId, studentId } of found) {
        try {
          await syncSchedule(mint.fromSession({ studentId }), agentId);
        } catch (error) {
          console.error("Could not save an Agent's Schedule", error);
          failed.push(error);
        }
      }
      if (failed.length)
        throw new AggregateError(
          failed,
          `Could not save ${failed.length} Agents' Schedules`,
        );
      return found.map((r) => r.agentId);
    },

    /**
     * Takes no further Actions, including in a Run under way, while keeping its Grants; its open Approvals are withdrawn
     * for good. Returns its Runs under way, for the caller to stop at once.
     */
    async pause(p: Principal, id: string) {
      if (p.kind !== "student") return { status: "gone" } as const;
      const runs = await withOwner(db, p, async (tx, studentId) => {
        await withdrawBeforeLock(tx, studentId, id);
        await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${id} FOR UPDATE`;
        await tx.agent.updateMany({
          where: { id, state: "active" },
          data: { state: "paused", pausedBy: "student" },
        });
        if ((await tx.agent.findUnique({ where: { id } }))?.state !== "paused")
          return null;
        // Again under the Agent's lock, for one asked meanwhile.
        await withdrawApprovals(tx, { studentId, agentId: id }, clock.now());
        return runsUnderWay(tx, id);
      });
      if (!runs) return { status: "gone" } as const;
      // After the commit: the record is what the gate checks, so a Run firing meanwhile is refused anyway.
      await syncSchedule(p, id);
      return { status: "ok", runs } as const;
    },

    /**
     * Pauses the Schedule of an Agent its Budget Paused, as a Run of it ends: `meter` pauses the Agent in the worker,
     * where nothing pauses its Schedule. Does nothing for any other Agent; safe to repeat.
     */
    async syncBudgetPause(p: Principal, id: string) {
      const r = await withOwner(db, p, (tx) =>
        tx.agent.findUnique({ where: { id } }),
      );
      if (r?.state === "paused" && r.pausedBy === "budget")
        await syncSchedule(p, id);
    },

    /**
     * Only the student resumes a Paused Agent, whoever paused it, and only while it has a Course to act for: not while
     * all its Courses are Archived, nor while it has none.
     */
    async resume(p: Principal, id: string) {
      if (p.kind !== "student") return { status: "gone" } as const;
      const found = await withOwner(db, p, async (tx) => {
        const r = await tx.agent.findUnique({
          where: { id },
          include: { courses: { include: { course: true } } },
        });
        const out = r?.state === "paused" && outOfCourses(r.courses);
        if (out) return out;
        await tx.agent.updateMany({
          where: { id, state: "paused" },
          data: { state: "active", pausedBy: null },
        });
        return (
          (await tx.agent.findUnique({ where: { id } }))?.state === "active"
        );
      });
      if (found === "course_archived" || found === "no_course")
        return { status: found } as const;
      if (!found) return { status: "gone" } as const;
      await syncSchedule(p, id);
      return { status: "ok" } as const;
    },

    /**
     * Stops for good: its Grants and open Approvals are gone and its history remains. Returns its Runs under way, for
     * the caller to stop at once.
     */
    async end(p: Principal, id: string) {
      if (p.kind !== "student") return { status: "gone" } as const;
      const runs = await withOwner(db, p, async (tx, studentId) => {
        await withdrawBeforeLock(tx, studentId, id);
        await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${id} FOR UPDATE`;
        await tx.agent.updateMany({
          where: { id, state: { not: "ended" } },
          data: { state: "ended", endedAt: clock.now() },
        });
        if (!(await tx.agent.findUnique({ where: { id } }))) return null;
        await tx.grant.deleteMany({ where: { agentId: id } });
        // Again under the Agent's lock, for one asked meanwhile.
        await withdrawApprovals(tx, { studentId, agentId: id }, clock.now());
        return runsUnderWay(tx, id);
      });
      if (!runs) return { status: "gone" } as const;
      await syncSchedule(p, id);
      return { status: "ok", runs } as const;
    },

    /**
     * Removes the Agent for good, with its Grants, Courses, Capabilities and Activity (its Runs and their Actions), and
     * its Schedule. If the Schedule cannot be deleted, nothing is. Returns the workflows of its Runs under way, for the
     * caller to cancel.
     */
    async delete(p: Principal, id: string) {
      if (p.kind !== "student") return { status: "gone" } as const;
      return withOwner(db, p, async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${id} FOR UPDATE`;
        if (!(await tx.agent.findUnique({ where: { id } })))
          return { status: "gone" } as const;
        const workflows = (
          await tx.run.findMany({
            where: {
              agentId: id,
              workflowId: { not: null },
              status: "running",
            },
            select: { workflowId: true },
          })
        ).map((r) => r.workflowId!);
        await tx.agent.delete({ where: { id } });
        // Inside the transaction: if the Schedule cannot be deleted, the Agent stays and can be deleted again.
        await scheduled().delete(id);
        return { status: "ok", workflows } as const;
      });
    },

    /**
     * As a Course is being Archived: an Agent on it is Paused only once all its Courses are Archived; until then it
     * keeps working for the others. Only the student resumes it.
     */
    pauseForCourse: (p: Principal, courseId: string) =>
      settleCourses(p, { archiving: courseId }),

    /** As a Course is being deleted: it leaves every Agent's Courses, and one left with none is Paused (ADR-0015). */
    dropCourse: (p: Principal, courseId: string) =>
      settleCourses(p, { dropping: courseId }),

    /**
     * Once a Course is Rejected or merged: it leaves every Agent's Courses, a merged one for the Course it went into,
     * and an Agent left with no Course to act for is Paused.
     */
    followCourses: (p: Principal) => settleCourses(p),

    /**
     * The student's Agents, Ended ones included: their history remains. Each has its badge, and the list puts what
     * needs the student first: Paused, then Freigabe benötigt, then running, then those without a badge, then Ended;
     * newest first within each. It never asks Temporal, as Home and Inbox read it: a Run whose workflow is gone reads as
     * running until the Agent is opened or its Schedule next fires.
     */
    async list(p: Principal) {
      return withOwner(db, p, async (tx) => {
        const agents = await tx.agent.findMany({
          orderBy: { createdAt: "desc" },
        });
        const asking = await oldestAsking(tx);
        const running = new Set(
          (
            await tx.run.findMany({
              where: { agentId: { not: null }, status: "running" },
              select: { agentId: true },
            })
          ).map((run) => run.agentId),
        );
        return agents
          .map((r) => {
            const state = r.state as "active" | "paused" | "ended";
            return {
              id: r.id,
              name: r.name,
              description: r.description,
              emoji: r.emoji,
              state,
              pausedBy: r.pausedBy as PausedBy | null,
              badge: badgeOf(state, asking.has(r.id), running.has(r.id)),
              /** The oldest of its Runs still awaiting Approval, which Freigaben bestätigen opens; null when none. */
              approvalRunId: asking.get(r.id) ?? null,
            };
          })
          .sort((a, b) => badgeRank(a.badge) - badgeRank(b.badge));
      });
    },

    /**
     * The curated Templates in code, each with how many distinct other students have an Agent saved from it (Ended
     * included; deleted Agents leave the count). Reads only aggregate counts via the SECURITY DEFINER SQL function.
     */
    async templates(p: Principal) {
      if (p.kind !== "student") return [];
      const counts = await withOwner(
        db,
        p,
        (tx) =>
          tx.$queryRaw<{ templateId: string; othersCount: number }[]>`
            SELECT "templateId", "othersCount" FROM template_other_users()
          `,
      );
      const byId = new Map(counts.map((c) => [c.templateId, c.othersCount]));
      return templateIds.map((id) => ({
        ...agentTemplates[id],
        id,
        othersCount: byId.get(id) ?? 0,
      }));
    },

    /** Its form, state, Grants, and usage against its Budget; null when it is not the student's. */
    async view(p: Principal, id: string) {
      await failDeadRuns(p, id);
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
        const running = await tx.run.findFirst({
          where: { agentId: id, status: "running" },
          select: { id: true },
        });
        const asking = await oldestAsking(tx, id);
        return {
          id: r.id,
          templateId: r.templateId,
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
              .map((c) => ({
                id: capability,
                mode: c.mode as ApprovalMode | null,
              })),
          ),
          trigger: triggerOf(r),
          modelKey: r.modelKey,
          state: r.state as "active" | "paused" | "ended",
          pausedBy: r.pausedBy as PausedBy | null,
          /** One of its Runs is under way. */
          running: Boolean(running),
          /** The oldest of its Runs still awaiting Approval, which Freigaben bestätigen opens; null when none. */
          approvalRunId: asking.get(id) ?? null,
          grants: r.grants.map((g) => ({ kind: g.kind as Kind })),
          /** This month's: what it used is counted from 00:00 on the 1st in the Plan's time zone. */
          budget: {
            limitMicroUsd: Number(r.budgetMicroUsd),
            usedMicroUsd: Number(usedIn(r, await budgetMonth(tx, clock.now()))),
            heldMicroUsd: Number(r.heldMicroUsd),
          },
        };
      });
    },

    /**
     * Records a Run of an active Agent as its Schedule fires, or takes up the one the student started now, and
     * snapshots the Agent's configuration for it. Null when the Agent is not active, or when its other Run is still
     * running: one Run at a time.
     */
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
      /** The workflow running it, which the API stops or cancels. */
      workflowId: string;
    }) {
      const p = mint.fromSession({ studentId });
      // A Run whose workflow is gone would otherwise skip every later one.
      await failDeadRuns(p, agentId);
      return withOwner(db, p, async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${agentId} FOR UPDATE`;
        const existing = await tx.run.findUnique({ where: { id: runId } });
        const agent = await tx.agent.findUnique({
          where: { id: agentId },
          include: { capabilities: true },
        });
        const snapshot = agent && {
          instructions: agent.instructions,
          capabilities: capabilityIds.flatMap((capability) =>
            agent.capabilities
              .filter((c) => c.capability === capability)
              .map((c) => ({ id: capability, mode: c.mode })),
          ),
          modelKey: agent.modelKey,
        };
        if (existing) {
          if (existing.agentId !== agentId) return null;
          // A Run the student started now begins with the configuration saved as it starts.
          if (
            snapshot &&
            existing.status === "running" &&
            existing.instructions === null
          )
            await tx.run.update({ where: { id: runId }, data: snapshot });
          return existing.id;
        }
        if (agent?.state !== "active") return null;
        if (await tx.run.findFirst({ where: { agentId, status: "running" } }))
          return null;
        const run = await tx.run.create({
          data: {
            id: runId,
            studentId,
            agentId,
            workflowId,
            status: "running",
            trigger: "schedule",
            ...snapshot,
          },
        });
        return run.id;
      });
    },

    /**
     * Records a Run of an Agent that the student starts now, for the caller to start its workflow. Refused while one of
     * its Runs is running, or while it is Paused or Ended.
     */
    async requestRun(
      p: Principal,
      id: string,
    ): Promise<
      | { status: "ok"; runId: string; workflowId: string }
      | { status: "gone" | "running" | "paused" | "ended" }
    > {
      if (p.kind !== "student") return { status: "gone" };
      return withOwner(db, p, async (tx, studentId) => {
        await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${id} FOR UPDATE`;
        const agent = await tx.agent.findUnique({ where: { id } });
        if (!agent) return { status: "gone" };
        if (agent.state !== "active") return { status: agent.state };
        if (
          await tx.run.findFirst({ where: { agentId: id, status: "running" } })
        )
          return { status: "running" };
        const runId = randomUUID();
        const workflowId = `agentRun/${runId}`;
        await tx.run.create({
          data: {
            id: runId,
            studentId,
            agentId: id,
            workflowId,
            status: "running",
            trigger: "manual",
          },
        });
        return { status: "ok", runId, workflowId };
      });
    },

    failRun,

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

    /**
     * Records the Artifact Run an Agent's Run starts under one of its Capabilities, charged to that Run, for work of
     * `courseIds`: only while the Run is under way, its Agent active and still holding the Capability, each Course one
     * of its current, accepted, unarchived Courses (ADR-0001: an Archived Course is only read), and at most one per
     * Run (ADR-0026). The Artifact Run has no Agent of its own. Idempotent on `runId`.
     */
    async startArtifactRun(
      agentRunId: string,
      {
        runId,
        workflowId,
        capability,
        courseIds,
      }: {
        runId: string;
        workflowId: string;
        capability: CapabilityId;
        courseIds: string[];
      },
    ): Promise<
      | { status: "ok" }
      | {
          status: "refused";
          reason:
            | "run_ended"
            | "paused"
            | "ended"
            | "no_capability"
            | "out_of_scope"
            | "run_cap";
        }
    > {
      return withOwner(db, mint.fromRun(agentRunId), async (tx, studentId) => {
        // Serialised with the Run's other starts and with ending it.
        await tx.$executeRaw`SELECT 1 FROM "run" WHERE "id" = ${agentRunId} FOR UPDATE`;
        const existing = await tx.run.findUnique({ where: { id: runId } });
        if (existing) {
          if (existing.startedByRunId !== agentRunId)
            throw new Error(`Run ${runId} is not started by ${agentRunId}`);
          return { status: "ok" };
        }
        const run = await tx.run.findUniqueOrThrow({
          where: { id: agentRunId },
          include: {
            agent: {
              include: {
                capabilities: true,
                courses: { include: { course: true } },
              },
            },
          },
        });
        type Reason =
          | "run_ended"
          | "paused"
          | "ended"
          | "no_capability"
          | "out_of_scope"
          | "run_cap";
        const refuse = (reason: Reason) =>
          ({ status: "refused", reason }) as const;
        if (run.status !== "running" || !run.agent) return refuse("run_ended");
        if (run.agent.state !== "active") return refuse(run.agent.state);
        if (!run.agent.capabilities.some((c) => c.capability === capability))
          return refuse("no_capability");
        const scope = run.agent.courses
          .filter(
            ({ course }) => course.status === "accepted" && !course.archivedAt,
          )
          .map(({ courseId }) => courseId);
        if (!courseIds.length || courseIds.some((id) => !scope.includes(id)))
          return refuse("out_of_scope");
        const started = await tx.run.count({
          where: { startedByRunId: agentRunId },
        });
        if (started >= runCaps.artifactRuns) return refuse("run_cap");
        await tx.run.create({
          data: {
            id: runId,
            studentId,
            workflowId,
            startedByRunId: agentRunId,
          },
        });
        return { status: "ok" };
      });
    },
  };
}
export type Agents = ReturnType<typeof createAgents>;
