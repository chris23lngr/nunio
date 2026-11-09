import { randomUUID } from "node:crypto";
import type { Estimator } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import type {
  ActionIntent,
  Delegation,
  Principal,
  Transaction,
} from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";
import type { Facts } from "@nunio/knowledge";
import { definitely } from "@nunio/knowledge";
import { readCalendar } from "./calendar.js";
import type { Interval, Move, PlanState } from "./rebalance.js";
import { rebalance } from "./rebalance.js";
import { deadline, hhmm } from "./time.js";

export type WorkRef = { kind: "obligation" | "task"; id: string };
/** One entry in the student's single ranking, most important first. */
export type PriorityRef = {
  kind: "course" | "project" | "obligation";
  id: string;
};
export type ProtectedSpan =
  | { weekday: number; fromMinute: number; toMinute: number }
  | Interval;
type Actor = "nunio" | "student";
type Estimate = {
  minutes: number;
  estimatedBy: Actor;
  rationale: string | null;
};
type ObligationKind =
  | "exam"
  | "assignment"
  | "presentation"
  | "thesis"
  | "registration"
  | "other";
type ReviewState = "unreviewed" | "confirmed" | "rejected";

const defaults = {
  timeZone: "Europe/Berlin",
  studyFromMinute: 9 * 60,
  studyToMinute: 18 * 60,
  maxMinutesPerDay: 240,
};
const dayMs = 24 * 60 * 60_000;
const isoWeekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** The study-block and Fixed Event bound; a one-off span of Protected Time, such as a semester break, may last a year. */
const maxBlockMs = 14 * dayMs,
  maxProtectedMs = 366 * dayMs;

/** The student's Plan: Tasks, Estimates and Study Blocks, the Limits and Priorities it keeps to, and a Rebalance proposal. */
export function createPlan({
  db,
  facts,
  clock,
}: {
  db: PrismaClient;
  facts: Facts;
  clock: { now(): Date };
}) {
  /** Every Obligation the student has not rejected, with its deadline and Estimate; unreviewed ones are planned but flagged by `state`. */
  async function obligations(p: Principal, tx: Transaction) {
    const { courses } = await facts.review(p);
    const estimates = await tx.obligationEstimate.findMany();
    return courses
      .filter((course) => course.status !== "rejected")
      .flatMap((course) =>
        course.obligations
          .filter((o) => o.state !== "rejected")
          .map((o) => {
            const estimate = estimates.find((e) => e.obligationId === o.id);
            return {
              id: o.id,
              courseId: course.id,
              course: course.title,
              title: o.title,
              kind: o.kind as ObligationKind,
              state: o.state as ReviewState,
              due: o.due.date
                ? deadline(
                    o.due.date,
                    o.due.time,
                    o.due.timeZone ?? defaults.timeZone,
                  )
                : null,
              estimate: estimate
                ? ({
                    minutes: estimate.minutes,
                    estimatedBy: estimate.estimatedBy as Actor,
                    rationale: estimate.rationale,
                  } as Estimate)
                : null,
            };
          }),
      );
  }
  async function tasksOf(tx: Transaction) {
    return (await tx.task.findMany({ orderBy: { createdAt: "asc" } })).map(
      (task) => ({
        id: task.id,
        title: task.title,
        obligationId: task.obligationId,
        estimate: task.estimateMinutes
          ? {
              minutes: task.estimateMinutes,
              estimatedBy: task.estimatedBy as Actor,
              rationale: task.estimateRationale,
            }
          : null,
        maxMinutesPerDay: task.maxMinutesPerDay,
        done: Boolean(task.doneAt),
      }),
    );
  }
  /** The Plan as stored, and the Rebalance proposal over it, gathered in one transaction. */
  async function planView(p: Principal, tx: Transaction) {
    const stored = await tx.planPreference.findFirst();
    const preferences = {
      timeZone: stored?.timeZone ?? defaults.timeZone,
      studyFromMinute: stored?.studyFromMinute ?? defaults.studyFromMinute,
      studyToMinute: stored?.studyToMinute ?? defaults.studyToMinute,
      maxMinutesPerDay: stored?.maxMinutesPerDay ?? defaults.maxMinutesPerDay,
    };
    const courseLimits = await tx.coursePreference.findMany();
    const protectedTime = (
      await tx.protectedTime.findMany({
        orderBy: [{ weekday: "asc" }, { fromMinute: "asc" }, { start: "asc" }],
      })
    ).map((row): { id: string } & ProtectedSpan =>
      row.start && row.end
        ? { id: row.id, start: row.start, end: row.end }
        : {
            id: row.id,
            weekday: row.weekday!,
            fromMinute: row.fromMinute!,
            toMinute: row.toMinute!,
          },
    );
    const ranking = (
      await tx.priority.findMany({ orderBy: { rank: "asc" } })
    ).map((row): PriorityRef & { rank: number } => ({
      kind: row.courseId ? "course" : row.projectId ? "project" : "obligation",
      id: (row.courseId ?? row.projectId ?? row.obligationId)!,
      rank: row.rank,
    }));
    const projects = await tx.project.findMany({
      where: { obligationId: { not: null } },
      select: { id: true, obligationId: true },
    });
    const fixedEvents = (
      await tx.fixedEvent.findMany({
        orderBy: [{ start: "asc" }, { end: "asc" }],
      })
    ).map(({ id, title, start, end, calendarId }) => ({
      id,
      title,
      start,
      end,
      calendarId,
    }));
    const calendars = (
      await tx.calendarSource.findMany({
        orderBy: { addedAt: "asc" },
        include: { _count: { select: { events: true } } },
      })
    ).map(({ id, name, _count }) => ({ id, name, events: _count.events }));
    const items = await obligations(p, tx);
    const tasks = await tasksOf(tx);
    const blocks = (
      await tx.studyBlock.findMany({ orderBy: { start: "asc" } })
    ).map((block) => ({
      id: block.id,
      work: (block.obligationId
        ? { kind: "obligation", id: block.obligationId }
        : { kind: "task", id: block.taskId! }) as WorkRef,
      start: block.start,
      end: block.end,
      placedBy: block.placedBy as Actor,
      locked: Boolean(block.lockedAt),
    }));

    const rankOf = (kind: PriorityRef["kind"], id: string) =>
      ranking.find((r) => r.kind === kind && r.id === id)?.rank;
    /** An Obligation's own rank, else the best rank of a Project toward it, else its Course's; unranked work comes last. */
    const priorityOf = (o: (typeof items)[number]) => {
      const project = Math.min(
        Infinity,
        ...projects
          .filter((pr) => pr.obligationId === o.id)
          .map((pr) => rankOf("project", pr.id) ?? Infinity),
      );
      return (
        rankOf("obligation", o.id) ??
        (Number.isFinite(project)
          ? project
          : (rankOf("course", o.courseId) ?? Infinity))
      );
    };
    const courseLimit = (courseId: string | undefined) =>
      courseLimits.find((limit) => limit.courseId === courseId)
        ?.maxMinutesPerDay ?? null;
    const now = clock.now();
    const latest = Math.max(
      now.getTime(),
      ...items.flatMap((o) => (o.due ? [o.due.getTime()] : [])),
    );
    const state: PlanState = {
      now,
      timeZone: preferences.timeZone,
      obligations: items.map((o) => ({
        id: o.id,
        due: o.due,
        estimateMinutes: o.estimate?.minutes ?? null,
        priority: priorityOf(o),
        dailyLimitMinutes: courseLimit(o.courseId),
      })),
      // A Task's own daily limit wins over its Course's.
      tasks: tasks.map((task) => ({
        id: task.id,
        obligationId: task.obligationId,
        estimateMinutes: task.estimate?.minutes ?? null,
        done: task.done,
        dailyLimitMinutes:
          task.maxMinutesPerDay ??
          courseLimit(items.find((o) => o.id === task.obligationId)?.courseId),
      })),
      fixedEvents: fixedEvents.map(({ start, end }) => ({ start, end })),
      protectedTime: [
        ...weekly(
          protectedTime.flatMap((span) => ("weekday" in span ? [span] : [])),
          now,
          new Date(latest + dayMs),
          preferences.timeZone,
        ),
        ...protectedTime.flatMap((span) =>
          "start" in span ? [{ start: span.start, end: span.end }] : [],
        ),
      ],
      studyBlocks: blocks.map(({ work, ...block }) => ({
        ...block,
        workId: work.id,
      })),
      preferences: {
        studyWindow: {
          fromMinute: preferences.studyFromMinute,
          toMinute: preferences.studyToMinute,
        },
        maxMinutesPerDay: preferences.maxMinutesPerDay,
      },
    };
    return {
      obligations: items,
      tasks,
      studyBlocks: blocks,
      fixedEvents,
      calendars,
      priorities: ranking.map(({ kind, id }) => ({ kind, id })),
      limits: {
        preferences,
        courses: courseLimits.map(({ courseId, maxMinutesPerDay }) => ({
          courseId,
          maxMinutesPerDay,
        })),
        protectedTime,
      },
      proposal: rebalance(state),
    };
  }
  const workExists = async (tx: Transaction, work: WorkRef) =>
    Boolean(
      work.kind === "obligation"
        ? await tx.obligation.findUnique({ where: { id: work.id } })
        : await tx.task.findUnique({ where: { id: work.id } }),
    );

  return {
    /** The Plan as it stands, and what a Rebalance would change now. */
    async view(p: Principal) {
      return withOwner(db, p, (tx) => planView(p, tx));
    },
    /**
     * "Keep this course organized": the Rebalance moves for one Course's Obligations and their Tasks, as Actions for the
     * gate, which decides which of them need the student's Approval.
     */
    async intentsFor(p: Principal, courseId: string): Promise<ActionIntent[]> {
      const {
        obligations: items,
        tasks,
        proposal,
      } = await withOwner(db, p, (tx) => planView(p, tx));
      const inCourse = new Set(
        items.filter((o) => o.courseId === courseId).map((o) => o.id),
      );
      for (const task of tasks)
        if (task.obligationId && inCourse.has(task.obligationId))
          inCourse.add(task.id);
      return proposal.moves
        .filter((move) => inCourse.has(move.workId))
        .map(
          (move): ActionIntent =>
            move.kind === "create"
              ? {
                  kind: "studyBlock.create",
                  workId: move.workId,
                  start: move.start,
                  end: move.end,
                }
              : {
                  kind: "studyBlock.move",
                  studyBlockId: move.blockId,
                  start: move.to.start,
                  end: move.to.end,
                },
        );
    },
    /** Applies one proposed move as the student's own decision, only while it matches a fresh proposal. */
    async apply(p: Principal, move: Move) {
      return withOwner(db, p, async (tx, studentId) => {
        // Serializes a student's applies, so the same move cannot be applied twice concurrently.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${studentId}))`;
        const { obligations: items, proposal } = await planView(p, tx);
        if (!proposal.moves.some((proposed) => sameMove(proposed, move)))
          return { status: "stale" } as const;
        if (move.kind === "create") {
          const work: WorkRef = {
            kind: items.some((o) => o.id === move.workId)
              ? "obligation"
              : "task",
            id: move.workId,
          };
          await tx.studyBlock.create({
            data: {
              id: randomUUID(),
              studentId,
              start: move.start,
              end: move.end,
              placedBy: "nunio",
              ...columnsOf(work),
            },
          });
        } else {
          await tx.studyBlock.update({
            where: { id: move.blockId },
            data: { start: move.to.start, end: move.to.end },
          });
        }
        return { status: "ok" } as const;
      });
    },
    /** A Task toward one of the student's Obligations, or toward none. */
    async addTask(
      p: Principal,
      input: { title: string; obligationId: string | null },
    ) {
      const title = titleOf(input.title);
      if (!title) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        if (
          input.obligationId &&
          !(await workExists(tx, {
            kind: "obligation",
            id: input.obligationId,
          }))
        )
          return { status: "gone" } as const;
        const task = await tx.task.create({
          data: {
            id: randomUUID(),
            studentId,
            title,
            obligationId: input.obligationId,
          },
        });
        return { status: "ok", id: task.id } as const;
      });
    },
    async completeTask(p: Principal, id: string, done: boolean) {
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.task.updateMany({
          where: { id },
          data: { doneAt: done ? clock.now() : null },
        });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** A Study Block the student places themselves; nunio moves it only with their Approval. */
    async placeBlock(p: Principal, input: { work: WorkRef } & Interval) {
      if (!validInterval(input, maxBlockMs))
        return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        if (!(await workExists(tx, input.work)))
          return { status: "gone" } as const;
        const block = await tx.studyBlock.create({
          data: {
            id: randomUUID(),
            studentId,
            start: input.start,
            end: input.end,
            placedBy: "student",
            ...columnsOf(input.work),
          },
        });
        return { status: "ok", id: block.id } as const;
      });
    },
    /** The student moving any block makes it theirs; moving does not Lock it. */
    async moveBlock(p: Principal, id: string, to: Interval) {
      if (!validInterval(to, maxBlockMs)) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.studyBlock.updateMany({
          where: { id },
          data: { start: to.start, end: to.end, placedBy: "student" },
        });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** A Locked block is never moved by nunio, not even by asking. */
    async lockBlock(p: Principal, id: string, locked: boolean) {
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.studyBlock.updateMany({
          where: { id },
          data: { lockedAt: locked ? clock.now() : null },
        });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    async removeBlock(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.studyBlock.deleteMany({ where: { id } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** A Fixed Event the student enters by hand. */
    async addFixedEvent(p: Principal, input: { title: string } & Interval) {
      const title = titleOf(input.title);
      if (!title || !validInterval(input, maxBlockMs))
        return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        const event = await tx.fixedEvent.create({
          data: {
            id: randomUUID(),
            studentId,
            title,
            start: input.start,
            end: input.end,
          },
        });
        return { status: "ok", id: event.id } as const;
      });
    },
    async removeFixedEvent(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.fixedEvent.deleteMany({ where: { id } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** Adds a calendar file as a Source of Fixed Events for the coming year; recurrences are expanded, so adding it again extends them. */
    async addCalendar(p: Principal, input: { name: string; ics: string }) {
      const name = titleOf(input.name, 255);
      if (!name) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        const timeZone =
          (await tx.planPreference.findFirst())?.timeZone ?? defaults.timeZone;
        const now = clock.now();
        const reading = readCalendar(input.ics, {
          from: now,
          until: new Date(now.getTime() + 365 * dayMs),
          timeZone,
        });
        if (reading.status === "invalid") return reading;
        const id = randomUUID();
        await tx.calendarSource.create({ data: { id, studentId, name } });
        await tx.fixedEvent.createMany({
          data: reading.events.map((event) => ({
            id: randomUUID(),
            studentId,
            calendarId: id,
            ...event,
          })),
        });
        return {
          status: "ok",
          id,
          events: reading.events.length,
          skipped: reading.skipped,
        } as const;
      });
    },
    /** Deletes a calendar Source and, immediately, every Fixed Event read from it. */
    async removeCalendar(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.calendarSource.deleteMany({ where: { id } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** Soft rules: breaking one needs Approval, so a Rebalance stays within them. */
    async setPreferences(
      p: Principal,
      input: {
        studyFromMinute: number;
        studyToMinute: number;
        maxMinutesPerDay: number;
      },
    ) {
      const { studyFromMinute, studyToMinute, maxMinutesPerDay } = input;
      if (
        ![studyFromMinute, studyToMinute].every(Number.isInteger) ||
        studyFromMinute < 0 ||
        studyToMinute > 1440 ||
        studyToMinute <= studyFromMinute ||
        !validLimit(maxMinutesPerDay)
      )
        return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        await tx.planPreference.upsert({
          where: { studentId },
          create: { studentId, ...input },
          update: input,
        });
        return { status: "ok" } as const;
      });
    },
    /** A Course's own daily limit, which wins over the global one for its work; null removes it. */
    async setCourseLimit(
      p: Principal,
      courseId: string,
      maxMinutesPerDay: number | null,
    ) {
      if (maxMinutesPerDay !== null && !validLimit(maxMinutesPerDay))
        return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        if (
          !(await tx.course.findFirst({
            where: { id: courseId, status: { not: "merged" } },
          }))
        )
          return { status: "gone" } as const;
        if (maxMinutesPerDay === null)
          await tx.coursePreference.deleteMany({ where: { courseId } });
        else
          await tx.coursePreference.upsert({
            where: { courseId },
            create: { courseId, studentId, maxMinutesPerDay },
            update: { maxMinutesPerDay },
          });
        return { status: "ok" } as const;
      });
    },
    /** A Task's own daily limit, which wins over its Course's; null removes it. */
    async setTaskLimit(
      p: Principal,
      taskId: string,
      maxMinutesPerDay: number | null,
    ) {
      if (maxMinutesPerDay !== null && !validLimit(maxMinutesPerDay))
        return { status: "invalid" } as const;
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.task.updateMany({
          where: { id: taskId },
          data: { maxMinutesPerDay },
        });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** Time nunio never schedules into, even with a deadline at risk: weekly, or once, such as a trip. */
    async addProtectedTime(p: Principal, input: ProtectedSpan) {
      const valid =
        "weekday" in input
          ? [input.weekday, input.fromMinute, input.toMinute].every(
              Number.isInteger,
            ) &&
            input.weekday >= 1 &&
            input.weekday <= 7 &&
            input.fromMinute >= 0 &&
            input.toMinute <= 1440 &&
            input.toMinute > input.fromMinute
          : validInterval(input, maxProtectedMs);
      if (!valid) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        const data =
          "weekday" in input
            ? {
                weekday: input.weekday,
                fromMinute: input.fromMinute,
                toMinute: input.toMinute,
              }
            : { start: input.start, end: input.end };
        const row = await tx.protectedTime.create({
          data: { id: randomUUID(), studentId, ...data },
        });
        return { status: "ok", id: row.id } as const;
      });
    },
    async removeProtectedTime(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.protectedTime.deleteMany({ where: { id } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** Replaces the student's single ranking of Courses, Projects and Obligations, most important first. */
    async setPriorities(p: Principal, refs: PriorityRef[]) {
      if (
        new Set(refs.map((ref) => `${ref.kind}:${ref.id}`)).size !== refs.length
      )
        return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        const ids = (kind: PriorityRef["kind"]) =>
          refs.filter((ref) => ref.kind === kind).map((ref) => ref.id);
        // RLS hides another student's rows, so a foreign ID counts as gone like a deleted one.
        const owned =
          (await tx.course.count({
            where: { id: { in: ids("course") }, status: { not: "merged" } },
          })) === ids("course").length &&
          (await tx.project.count({
            where: { id: { in: ids("project") } },
          })) === ids("project").length &&
          (await tx.obligation.count({
            where: { id: { in: ids("obligation") } },
          })) === ids("obligation").length;
        if (!owned) return { status: "gone" } as const;
        await tx.priority.deleteMany({});
        await tx.priority.createMany({
          data: refs.map((ref, i) => ({
            id: randomUUID(),
            studentId,
            rank: i + 1,
            [`${ref.kind}Id`]: ref.id,
          })),
        });
        return { status: "ok" } as const;
      });
    },
    /** Asks the model for Estimates of Obligations and open Tasks that have none, in one metered call. */
    async proposeEstimates(
      p: Principal,
      {
        estimator,
        delegation,
      }: { estimator: Estimator; delegation: Delegation },
    ) {
      const { items, tasks } = await withOwner(db, p, async (tx) => ({
        items: await obligations(p, tx),
        tasks: await tasksOf(tx),
      }));
      const missing = [
        ...items
          .filter((o) => !o.estimate)
          .map((o) => ({
            work: { kind: "obligation", id: o.id } as WorkRef,
            request: { kind: o.kind, title: o.title, course: o.course },
          })),
        ...tasks
          .filter((task) => !task.estimate && !task.done)
          .map((task) => ({
            work: { kind: "task", id: task.id } as WorkRef,
            request: {
              kind: "task" as const,
              title: task.title,
              course:
                items.find((o) => o.id === task.obligationId)?.course ?? null,
            },
          })),
      ];
      if (!missing.length) return { status: "ok", proposed: 0 } as const;
      const requests = missing.map((m) => m.request);
      const proposed = await delegation.meter(
        p,
        { microUsd: estimator.estimateMicroUsd(requests) },
        (signal) => definitely(() => estimator.estimate(requests, { signal })),
      );
      if (proposed.status === "refused") return proposed;
      const written = await withOwner(db, p, async (tx, studentId) => {
        let count = 0;
        for (const [i, estimate] of proposed.value.entries()) {
          const { work } = missing[i]!;
          if (!estimate) continue;
          // The student may have estimated it meanwhile, or the work may be gone; neither is overwritten.
          if (work.kind === "obligation") {
            if (
              (await tx.obligationEstimate.findUnique({
                where: { obligationId: work.id },
              })) ||
              !(await workExists(tx, work))
            )
              continue;
            await tx.obligationEstimate.create({
              data: {
                obligationId: work.id,
                studentId,
                minutes: estimate.minutes,
                estimatedBy: "nunio",
                rationale: estimate.rationale,
              },
            });
          } else {
            const { count: updated } = await tx.task.updateMany({
              where: { id: work.id, estimateMinutes: null },
              data: {
                estimateMinutes: estimate.minutes,
                estimatedBy: "nunio",
                estimateRationale: estimate.rationale,
              },
            });
            if (!updated) continue;
          }
          count++;
        }
        return count;
      });
      return { status: "ok", proposed: written } as const;
    },
    /** The student's own Estimate, which a proposal never replaces. */
    async estimate(p: Principal, work: WorkRef, minutes: number) {
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1000 * 60)
        return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        if (work.kind === "obligation") {
          if (!(await workExists(tx, work))) return { status: "gone" } as const;
          await tx.obligationEstimate.upsert({
            where: { obligationId: work.id },
            create: {
              obligationId: work.id,
              studentId,
              minutes,
              estimatedBy: "student",
            },
            update: { minutes, estimatedBy: "student", rationale: null },
          });
        } else {
          const { count } = await tx.task.updateMany({
            where: { id: work.id },
            data: {
              estimateMinutes: minutes,
              estimatedBy: "student",
              estimateRationale: null,
            },
          });
          if (!count) return { status: "gone" } as const;
        }
        return { status: "ok" } as const;
      });
    },
  };
}
export type Plan = ReturnType<typeof createPlan>;

/** The study-block column a piece of work is stored under. */
const columnsOf = (work: WorkRef) =>
  work.kind === "obligation" ? { obligationId: work.id } : { taskId: work.id };
/** A trimmed, non-empty title within its bound, or null. */
const titleOf = (raw: string, max = 500) => {
  const title = raw.trim();
  return title && title.length <= max ? title : null;
};
const validLimit = (minutes: number) =>
  Number.isInteger(minutes) && minutes >= 30 && minutes <= 1440;
const validInterval = ({ start, end }: Interval, maxMs: number) =>
  !Number.isNaN(start.getTime()) &&
  end.getTime() > start.getTime() &&
  end.getTime() - start.getTime() <= maxMs;

/** Expands weekly rules into the concrete local spans they cover between two instants. */
function weekly(
  rules: { weekday: number; fromMinute: number; toMinute: number }[],
  from: Date,
  until: Date,
  timeZone: string,
): Interval[] {
  if (!rules.length) return [];
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  });
  const spans: Interval[] = [];
  // Steps of 24 hours from local noon land on each local day once: a DST change shifts noon by an hour, never past midnight.
  const noon = deadline(
    day.format(from.getTime() - dayMs),
    "12:00",
    timeZone,
  ).getTime();
  for (let ms = noon; ms <= until.getTime() + dayMs; ms += dayMs) {
    const date = day.format(ms),
      next = day.format(ms + dayMs),
      iso = isoWeekdays.indexOf(weekday.format(ms)) + 1;
    for (const rule of rules.filter((r) => r.weekday === iso)) {
      spans.push({
        start: deadline(date, hhmm(rule.fromMinute), timeZone),
        end:
          rule.toMinute === 1440
            ? deadline(next, null, timeZone)
            : deadline(date, hhmm(rule.toMinute), timeZone),
      });
    }
  }
  return spans;
}

const same = (a: Date, b: Date) => a.getTime() === b.getTime();
function sameMove(a: Move, b: Move) {
  if (a.kind === "create" && b.kind === "create")
    return (
      a.workId === b.workId && same(a.start, b.start) && same(a.end, b.end)
    );
  if (a.kind === "move" && b.kind === "move")
    return (
      a.blockId === b.blockId &&
      same(a.to.start, b.to.start) &&
      same(a.to.end, b.to.end)
    );
  return false;
}
