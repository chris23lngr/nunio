import { randomUUID } from "node:crypto";
import type { Estimator, SeriesAssigner } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import type {
  ActionIntent,
  Delegation,
  Principal,
  ResponsibilityScope,
  Transaction,
} from "@nunio/delegation";
import { principal, withOwner } from "@nunio/delegation";
import type { Facts } from "@nunio/knowledge";
import { definitely } from "@nunio/knowledge";
import { readCalendar } from "./calendar.js";
import type { Interval, Move, PlanState } from "./rebalance.js";
import { addMinutes, local, rebalance } from "./rebalance.js";
import { deadline, hhmm } from "./time.js";

export type WorkRef = { kind: "obligation" | "task"; id: string };
/** One entry in the student's single ranking, most important first. */
export type PriorityRef = {
  kind: "course" | "project" | "obligation";
  id: string;
};
/** A Study Block nunio might propose: a new one for some work, or an existing one somewhere else. */
export type BlockProposal =
  | ({ kind: "create"; work: WorkRef } & Interval)
  | ({ kind: "move"; blockId: string } & Interval);
/** Why a proposed Study Block cannot be proposed at all. */
export type BlockRefusal =
  | "invalid"
  | "gone"
  | "past"
  | "protected_time"
  | "fixed_event"
  | "study_block"
  | "locked";
/** A Preference a proposed Study Block would break, which the student sees before approving it. */
export type BlockNote = "outside_study_window" | "daily_limit" | "work_limit";
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
/** Where an Event Series stands with its Course; only a confirmed one's events are Course Events (ADR-0021). */
export type SeriesState = "undecided" | "proposed" | "confirmed" | "rejected";
/** What a Routine's Task does for its Course Event. */
export type TaskRole = "preparation" | "follow_up";

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
  /**
   * Every Obligation the student has not rejected, outside Archived Courses, with its deadline and Estimate; unreviewed
   * ones are planned but flagged by `state`.
   */
  async function obligations(p: Principal, tx: Transaction) {
    const { courses } = await facts.review(p);
    const estimates = await tx.obligationEstimate.findMany();
    return courses
      .filter((course) => course.status !== "rejected" && !course.archived)
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
              /** Reported as Submitted: shown, but no longer planned. */
              reportedSubmittedAt: o.reportedSubmittedAt,
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
  /** Courses nunio plans for: not rejected, merged or Archived. */
  const activeCourses = (tx: Transaction) =>
    tx.course.findMany({
      where: { status: { in: ["proposed", "accepted"] }, archivedAt: null },
      select: { id: true, title: true, code: true },
      orderBy: [{ title: "asc" }, { id: "asc" }],
    });
  /** The student's Tasks, leaving out those in a Course nunio no longer plans for. */
  async function tasksOf(tx: Transaction) {
    const courses = await activeCourses(tx);
    const rows = await tx.task.findMany({ orderBy: { createdAt: "asc" } });
    return rows.flatMap((task) => {
      const course = task.courseId
        ? courses.find((c) => c.id === task.courseId)
        : null;
      if (course === undefined) return [];
      return [
        {
          id: task.id,
          title: task.title,
          obligationId: task.obligationId,
          /** The Task's own Course, which only a Task toward no Obligation has. */
          courseId: task.courseId,
          course: course?.title ?? null,
          estimate: task.estimateMinutes
            ? {
                minutes: task.estimateMinutes,
                estimatedBy: task.estimatedBy as Actor,
                rationale: task.estimateRationale,
              }
            : null,
          maxMinutesPerDay: task.maxMinutesPerDay,
          done: Boolean(task.doneAt),
          /** For a Routine's Task: the Course Event it is for, and whether it prepares for it or follows up on it. */
          fixedEventId: task.fixedEventId,
          role: task.role as TaskRole | null,
        },
      ];
    });
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
    const eventRows = await tx.fixedEvent.findMany({
      orderBy: [{ start: "asc" }, { end: "asc" }],
    });
    const eventSeries = (
      await tx.eventSeries.findMany({
        orderBy: [{ title: "asc" }, { id: "asc" }],
      })
    ).map(({ id, calendarId, title, courseId, confirmedAt, rejectedAt }) => ({
      id,
      calendarId,
      title,
      courseId,
      state: (rejectedAt
        ? "rejected"
        : !courseId
          ? "undecided"
          : confirmedAt
            ? "confirmed"
            : "proposed") as SeriesState,
    }));
    const fixedEvents = eventRows.map(
      ({ id, title, start, end, calendarId, seriesId, detachedAt }) => {
        const series = eventSeries.find((s) => s.id === seriesId);
        return {
          id,
          title,
          start,
          end,
          calendarId,
          seriesId,
          /** Its Course, which only a Course Event has: one of a confirmed series the student did not take out. */
          courseId:
            series?.state === "confirmed" && !detachedAt
              ? series.courseId
              : null,
        };
      },
    );
    const calendars = (
      await tx.calendarSource.findMany({
        orderBy: { addedAt: "asc" },
        include: { _count: { select: { events: true } } },
      })
    ).map(({ id, name, _count }) => ({ id, name, events: _count.events }));
    const items = await obligations(p, tx);
    const tasks = (await tasksOf(tx)).map((task) => ({
      ...task,
      /** When a Routine's Task is to be done, from its Course Event and that event's neighbors (ADR-0021). */
      window: windowOf(task, eventRows),
    }));
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
    // Work the student reported as handed in needs no more time, and so causes no Shortfall.
    const planned = items.filter((o) => !o.reportedSubmittedAt);
    const state: PlanState = {
      now,
      timeZone: preferences.timeZone,
      obligations: planned.map((o) => ({
        id: o.id,
        due: o.due,
        estimateMinutes: o.estimate?.minutes ?? null,
        priority: priorityOf(o),
        dailyLimitMinutes: courseLimit(o.courseId),
      })),
      // A Task's own daily limit wins over its Course's.
      tasks: tasks
        .filter(
          (task) =>
            !items.some(
              (o) => o.id === task.obligationId && o.reportedSubmittedAt,
            ),
        )
        .map((task) => ({
          id: task.id,
          obligationId: task.obligationId,
          estimateMinutes: task.estimate?.minutes ?? null,
          done: task.done,
          dailyLimitMinutes:
            task.maxMinutesPerDay ??
            courseLimit(
              task.courseId ??
                items.find((o) => o.id === task.obligationId)?.courseId,
            ),
          earliest: task.window?.start ?? null,
          due: task.window?.end ?? null,
          priority: task.courseId
            ? (rankOf("course", task.courseId) ?? Infinity)
            : Infinity,
          routine: task.role
            ? (eventRows.find((e) => e.id === task.fixedEventId)?.seriesId ??
              null)
            : null,
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
      eventSeries,
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
  /** A work's own daily limit: a Task's, else its Course's; null when it has none. */
  async function workLimit(tx: Transaction, work: WorkRef) {
    const task =
      work.kind === "task"
        ? await tx.task.findUnique({ where: { id: work.id } })
        : null;
    if (task?.maxMinutesPerDay) return task.maxMinutesPerDay;
    const obligationId =
      work.kind === "obligation" ? work.id : task?.obligationId;
    const obligation = obligationId
      ? await tx.obligation.findUnique({ where: { id: obligationId } })
      : null;
    const courseId = obligation?.courseId ?? task?.courseId;
    if (!courseId) return null;
    return (
      (await tx.coursePreference.findUnique({ where: { courseId } }))
        ?.maxMinutesPerDay ?? null
    );
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
     * Checks a Study Block nunio might propose (ADR-0019) against the Plan's hard rules, which refuse it, and its
     * Preferences, which it may break only with the student's Approval and so only notes.
     */
    async check(
      p: Principal,
      proposal: BlockProposal,
    ): Promise<
      | { status: "refused"; reasons: BlockRefusal[] }
      | { status: "ok"; notes: BlockNote[] }
    > {
      if (!validInterval(proposal, maxBlockMs))
        return { status: "refused", reasons: ["invalid"] };
      return withOwner(db, p, async (tx) => {
        const block =
          proposal.kind === "move"
            ? await tx.studyBlock.findUnique({
                where: { id: proposal.blockId },
              })
            : null;
        if (
          proposal.kind === "move"
            ? !block
            : !(await workExists(tx, proposal.work))
        )
          return { status: "refused", reasons: ["gone"] };
        const stored = await tx.planPreference.findFirst();
        const timeZone = stored?.timeZone ?? defaults.timeZone;
        const during = {
          start: { lt: proposal.end },
          end: { gt: proposal.start },
        };
        const spans = await tx.protectedTime.findMany();
        const protectedTime = [
          ...weekly(
            spans.flatMap((span) =>
              span.weekday === null
                ? []
                : [
                    {
                      weekday: span.weekday,
                      fromMinute: span.fromMinute!,
                      toMinute: span.toMinute!,
                    },
                  ],
            ),
            proposal.start,
            proposal.end,
            timeZone,
          ),
          ...spans.flatMap((span) =>
            span.start && span.end
              ? [{ start: span.start, end: span.end }]
              : [],
          ),
        ];
        const reasons: BlockRefusal[] = [];
        if (proposal.start < clock.now()) reasons.push("past");
        if (
          protectedTime.some(
            (span) => span.start < proposal.end && span.end > proposal.start,
          )
        )
          reasons.push("protected_time");
        if (await tx.fixedEvent.count({ where: during }))
          reasons.push("fixed_event");
        if (
          await tx.studyBlock.count({
            where: { ...during, ...(block ? { id: { not: block.id } } : {}) },
          })
        )
          reasons.push("study_block");
        if (block?.lockedAt) reasons.push("locked");
        if (reasons.length) return { status: "refused", reasons };

        const notes: BlockNote[] = [];
        const first = local(proposal.start.getTime(), timeZone);
        const last = local(proposal.end.getTime() - 60_000, timeZone);
        if (
          first.date !== last.date ||
          first.minute <
            (stored?.studyFromMinute ?? defaults.studyFromMinute) ||
          last.minute + 1 > (stored?.studyToMinute ?? defaults.studyToMinute)
        )
          notes.push("outside_study_window");
        // Minutes per local day: the proposal's, and those already planned around it.
        const proposed = new Map<string, number>();
        addMinutes(proposed, proposal, timeZone);
        const nearby = await tx.studyBlock.findMany({
          where: {
            start: { lt: new Date(proposal.end.getTime() + dayMs) },
            end: { gt: new Date(proposal.start.getTime() - dayMs) },
            ...(block ? { id: { not: block.id } } : {}),
          },
        });
        const over = (blocks: Interval[], limit: number) => {
          const used = new Map<string, number>();
          for (const b of blocks) addMinutes(used, b, timeZone);
          return [...proposed].some(
            ([date, minutes]) => (used.get(date) ?? 0) + minutes > limit,
          );
        };
        if (over(nearby, stored?.maxMinutesPerDay ?? defaults.maxMinutesPerDay))
          notes.push("daily_limit");
        const work: WorkRef =
          proposal.kind === "create"
            ? proposal.work
            : block!.obligationId
              ? { kind: "obligation", id: block!.obligationId }
              : { kind: "task", id: block!.taskId! };
        const limit = await workLimit(tx, work);
        if (
          limit !== null &&
          over(
            nearby.filter(
              (b) =>
                (work.kind === "obligation" ? b.obligationId : b.taskId) ===
                work.id,
            ),
            limit,
          )
        )
          notes.push("work_limit");
        return { status: "ok", notes };
      });
    },
    /** The time zone the student's days, deadlines and Study Blocks are read in. */
    async timeZone(p: Principal) {
      return withOwner(
        db,
        p,
        async (tx) =>
          (await tx.planPreference.findFirst())?.timeZone ?? defaults.timeZone,
      );
    },
    /**
     * The Rebalance moves for one Course's Obligations, or one exam, and their Tasks, as Actions for the
     * gate, which decides which of them need the student's Approval.
     */
    async intentsFor(
      p: Principal,
      scope: ResponsibilityScope,
    ): Promise<ActionIntent[]> {
      const {
        obligations: items,
        tasks,
        proposal,
      } = await withOwner(db, p, (tx) => planView(p, tx));
      const inScope = new Set(
        items
          .filter((o) =>
            "courseId" in scope
              ? o.courseId === scope.courseId
              : o.id === scope.obligationId,
          )
          .map((o) => o.id),
      );
      for (const task of tasks)
        if (
          (task.obligationId && inScope.has(task.obligationId)) ||
          ("courseId" in scope && task.courseId === scope.courseId)
        )
          inScope.add(task.id);
      return proposal.moves
        .filter((move) => inScope.has(move.workId))
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
    /** A Task toward one of the student's Obligations, or toward none, then optionally in one of their Courses. */
    async addTask(
      p: Principal,
      input: {
        title: string;
        obligationId: string | null;
        courseId?: string | null;
      },
    ) {
      const title = titleOf(input.title);
      const courseId = input.courseId ?? null;
      // A Task toward an Obligation is in the Obligation's Course.
      if (!title || (input.obligationId && courseId))
        return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        if (
          input.obligationId &&
          !(await workExists(tx, {
            kind: "obligation",
            id: input.obligationId,
          }))
        )
          return { status: "gone" } as const;
        if (
          courseId &&
          !(await activeCourses(tx)).some((course) => course.id === courseId)
        )
          return { status: "gone" } as const;
        const task = await tx.task.create({
          data: {
            id: randomUUID(),
            studentId,
            title,
            obligationId: input.obligationId,
            courseId,
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
    /** Takes one Fixed Event out of its series' Course, so it is no Course Event, as for a cancelled lecture slot. */
    async detachEvent(p: Principal, id: string) {
      const detached = await withOwner(db, p, async (tx) => {
        const { count } = await tx.fixedEvent.updateMany({
          where: { id, seriesId: { not: null } },
          data: { detachedAt: clock.now() },
        });
        return { status: count ? "ok" : "gone" } as const;
      });
      // It is no Course Event any more, so its Routine's Tasks follow.
      if (detached.status === "ok") await this.applyRoutines(p);
      return detached;
    },
    async removeFixedEvent(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.fixedEvent.deleteMany({ where: { id } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /**
     * Adds a calendar file as a Source of Fixed Events for the coming year, expanding recurrences. A file sharing event
     * UIDs with a calendar the student added before updates that calendar instead, keeping its events' IDs (ADR-0021).
     */
    async addCalendar(p: Principal, input: { name: string; ics: string }) {
      const name = titleOf(input.name, 255);
      if (!name) return { status: "invalid" } as const;
      const added = await withOwner(db, p, async (tx, studentId) => {
        const timeZone =
          (await tx.planPreference.findFirst())?.timeZone ?? defaults.timeZone;
        const now = clock.now();
        const until = new Date(now.getTime() + 365 * dayMs);
        const reading = readCalendar(input.ics, { from: now, until, timeZone });
        if (reading.status === "invalid") return reading;
        const uids = [
          ...new Set(reading.events.flatMap((e) => (e.uid ? [e.uid] : []))),
        ];
        // The calendar sharing the most UIDs with the file is the one added before.
        const [match] = uids.length
          ? await tx.fixedEvent.groupBy({
              by: ["calendarId"],
              where: { calendarId: { not: null }, uid: { in: uids } },
              _count: { _all: true },
              orderBy: { _count: { calendarId: "desc" } },
              take: 1,
            })
          : [];
        const id = match?.calendarId ?? randomUUID();
        if (!match)
          await tx.calendarSource.create({ data: { id, studentId, name } });
        const keyOf = (event: {
          uid: string | null;
          recurrenceId: Date | null;
        }) => `${event.uid} ${event.recurrenceId?.toISOString() ?? ""}`;
        // Only events the file could still list: past ones stay as they were.
        const existing = new Map(
          (
            await tx.fixedEvent.findMany({
              where: { calendarId: id, start: { lt: until }, end: { gt: now } },
            })
          ).map((event) => [keyOf(event), event.id]),
        );
        // Each title is one Event Series, which keeps its ID while the calendar lists it.
        const series = new Map(
          (await tx.eventSeries.findMany({ where: { calendarId: id } })).map(
            (s) => [s.title, s.id],
          ),
        );
        const fresh = [...new Set(reading.events.map((e) => e.title))]
          .filter((title) => !series.has(title))
          .map((title) => ({
            id: randomUUID(),
            studentId,
            calendarId: id,
            title,
          }));
        await tx.eventSeries.createMany({ data: fresh });
        for (const s of fresh) series.set(s.title, s.id);
        const added = [];
        for (const event of reading.events) {
          const known = event.uid ? existing.get(keyOf(event)) : undefined;
          const seriesId = series.get(event.title)!;
          if (known === undefined) {
            added.push({
              id: randomUUID(),
              studentId,
              calendarId: id,
              seriesId,
              ...event,
            });
            continue;
          }
          existing.delete(keyOf(event));
          await tx.fixedEvent.update({
            where: { id: known },
            data: {
              title: event.title,
              start: event.start,
              end: event.end,
              seriesId,
            },
          });
        }
        // What the file no longer lists was cancelled or removed.
        await tx.fixedEvent.deleteMany({
          where: { id: { in: [...existing.values()] } },
        });
        await tx.fixedEvent.createMany({ data: added });
        await tx.eventSeries.deleteMany({
          where: { calendarId: id, events: { none: {} } },
        });
        return {
          status: "ok",
          id,
          events: reading.events.length,
          skipped: reading.skipped,
        } as const;
      });
      // Moved, new and cancelled Course Events change what the Routines call for.
      if (added.status === "ok") await this.applyRoutines(p);
      return added;
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
    /**
     * Asks the model, in one metered call, which of the student's Courses each undecided Event Series belongs to,
     * sending only its title and times and the Courses under handles (ADR-0021). A proposal waits for the student.
     */
    async proposeSeriesCourses(
      p: Principal,
      {
        assigner,
        delegation,
      }: { assigner: SeriesAssigner; delegation: Delegation },
    ) {
      const { series, courses } = await withOwner(db, p, async (tx) => {
        const timeZone =
          (await tx.planPreference.findFirst())?.timeZone ?? defaults.timeZone;
        const undecided = await tx.eventSeries.findMany({
          where: { courseId: null, rejectedAt: null },
          orderBy: [{ title: "asc" }, { id: "asc" }],
          include: { events: { orderBy: { start: "asc" } } },
        });
        return {
          series: undecided.map((s) => ({
            id: s.id,
            request: {
              title: s.title,
              times: [
                ...new Set(s.events.map((e) => slotOf(e, timeZone))),
              ].slice(0, 5),
              events: s.events.length,
            },
          })),
          courses: (await activeCourses(tx)).map((course, i) => ({
            id: course.id,
            handle: `K${i + 1}`,
            title: course.title,
            code: course.code,
          })),
        };
      });
      if (!series.length || !courses.length)
        return { status: "ok", proposed: 0 } as const;
      const input = {
        series: series.map((s) => s.request),
        courses: courses.map(({ id: _, ...course }) => course),
      };
      const proposed = await delegation.meter(
        p,
        { microUsd: assigner.assignMicroUsd(input) },
        (signal) => definitely(() => assigner.assign(input, { signal })),
      );
      if (proposed.status === "refused") return proposed;
      const written = await withOwner(db, p, async (tx) => {
        const active = new Set((await activeCourses(tx)).map((c) => c.id));
        let count = 0;
        for (const [i, handle] of proposed.value.entries()) {
          const courseId = courses.find((c) => c.handle === handle)?.id;
          if (!courseId || !active.has(courseId)) continue;
          // The student may have decided meanwhile; that decision stands.
          const { count: updated } = await tx.eventSeries.updateMany({
            where: { id: series[i]!.id, courseId: null, rejectedAt: null },
            data: { courseId, confirmedAt: null },
          });
          count += updated;
        }
        return count;
      });
      return { status: "ok", proposed: written } as const;
    },
    /**
     * The student's decision on an Event Series' Course: a Course, which confirms it whoever proposed it, or none,
     * after which nunio proposes none for it again.
     */
    async decideSeries(
      p: Principal,
      id: string,
      decision: { courseId: string } | { reject: true },
    ) {
      const decided = await withOwner(db, p, async (tx) => {
        if ("reject" in decision) {
          const { count } = await tx.eventSeries.updateMany({
            where: { id },
            data: {
              courseId: null,
              confirmedAt: null,
              rejectedAt: clock.now(),
            },
          });
          return { status: count ? "ok" : "gone" } as const;
        }
        if (!(await activeCourses(tx)).some((c) => c.id === decision.courseId))
          return { status: "gone" } as const;
        const { count } = await tx.eventSeries.updateMany({
          where: { id },
          data: {
            courseId: decision.courseId,
            confirmedAt: clock.now(),
            rejectedAt: null,
          },
        });
        return { status: count ? "ok" : "gone" } as const;
      });
      // Its events become, or stop being, Course Events, which its Routine follows.
      if (decided.status === "ok") await this.applyRoutines(p);
      return decided;
    },
    /** The student's Routine for an Event Series: minutes to prepare for and to follow up on each of its Course Events. */
    async setRoutine(
      p: Principal,
      seriesId: string,
      input: { preparationMinutes: number; followUpMinutes: number },
    ) {
      const { preparationMinutes, followUpMinutes } = input;
      if (
        ![preparationMinutes, followUpMinutes].every(
          (m) => Number.isInteger(m) && m >= 0 && m <= 1440,
        )
      )
        return { status: "invalid" } as const;
      const status = await withOwner(db, p, async (tx, studentId) => {
        if (!(await tx.eventSeries.findUnique({ where: { id: seriesId } })))
          return "gone" as const;
        const before = await tx.routine.findUnique({ where: { seriesId } });
        await tx.routine.upsert({
          where: { seriesId },
          create: { seriesId, studentId, ...input },
          update: input,
        });
        if (!before) return "ok" as const;
        // Only open Tasks nothing has happened to follow the change, and never an Estimate the student changed on one.
        const minutes = {
          preparation: [before.preparationMinutes, preparationMinutes],
          follow_up: [before.followUpMinutes, followUpMinutes],
        } as const;
        const tasks = await tx.task.findMany({
          where: {
            fixedEvent: { seriesId },
            doneAt: null,
            studyBlocks: { none: { start: { lt: clock.now() } } },
          },
        });
        for (const task of tasks) {
          const [old, now] = minutes[task.role!];
          if (task.estimateMinutes !== old || old === now) continue;
          if (now === 0) await tx.task.delete({ where: { id: task.id } });
          else
            await tx.task.update({
              where: { id: task.id },
              data: { estimateMinutes: now },
            });
        }
        return "ok" as const;
      });
      if (status === "ok") await this.applyRoutines(p);
      return { status } as const;
    },
    /**
     * Adds the Preparations and Follow-ups the student's Routines call for (ADR-0021): for each Course Event of a
     * confirmed series that starts in the next 14 days, and for a past one whose Follow-up window is still open. Adding
     * them is the student's own planning, not an Action; running it again adds nothing twice.
     */
    async applyRoutines(p: Principal) {
      return withOwner(db, p, async (tx, studentId) => {
        const now = clock.now();
        const horizon = now.getTime() + 14 * dayMs;
        const active = new Set((await activeCourses(tx)).map((c) => c.id));
        const routines = await tx.routine.findMany({
          include: { series: true },
        });
        const events = await tx.fixedEvent.findMany({
          where: { seriesId: { in: routines.map((r) => r.seriesId) } },
          orderBy: [{ start: "asc" }, { end: "asc" }],
        });
        // A Task whose event is no longer a Course Event goes if nothing happened to it; otherwise it stays, without it.
        /** A Course Event whose Routine is not skipped at the time it begins. */
        const due = (event: (typeof events)[number]) => {
          const routine = routines.find((r) => r.seriesId === event.seriesId);
          const series = routine?.series;
          return Boolean(
            !event.detachedAt &&
              series?.confirmedAt &&
              series.courseId &&
              active.has(series.courseId) &&
              !(routine?.skippedUntil && event.start < routine.skippedUntil),
          );
        };
        const courseEvents = new Set(
          events.filter(due).map((event) => event.id),
        );
        const stale = await tx.task.findMany({
          where: {
            role: { not: null },
            OR: [
              { fixedEventId: null },
              { fixedEventId: { notIn: [...courseEvents] } },
            ],
          },
          include: { studyBlocks: true },
        });
        const touched = (task: (typeof stale)[number]) =>
          task.doneAt ||
          task.studyBlocks.some((b) => b.start < now || b.lockedAt);
        for (const task of stale) {
          if (touched(task))
            await tx.task.update({
              where: { id: task.id },
              data: { fixedEventId: null, role: null },
            });
          else await tx.task.delete({ where: { id: task.id } });
        }
        // Preparing once the lecture has begun is pointless, so an untouched Preparation goes then; a Follow-up stays.
        const begun = events
          .filter((event) => event.start <= now)
          .map((event) => event.id);
        for (const task of await tx.task.findMany({
          where: { role: "preparation", fixedEventId: { in: begun } },
          include: { studyBlocks: true },
        }))
          if (!touched(task)) await tx.task.delete({ where: { id: task.id } });
        const existing = new Set(
          (
            await tx.task.findMany({
              where: { fixedEventId: { in: events.map((e) => e.id) } },
            })
          ).map((t) => `${t.fixedEventId} ${t.role}`),
        );
        const added = [];
        for (const {
          series,
          preparationMinutes,
          followUpMinutes,
        } of routines) {
          const courseId = series.courseId;
          if (!series.confirmedAt || !courseId || !active.has(courseId))
            continue;
          for (const event of events) {
            if (event.seriesId !== series.id || !courseEvents.has(event.id))
              continue;
            if (event.start.getTime() > horizon) continue;
            const wanted = [
              {
                role: "preparation" as const,
                label: "Vorbereitung",
                minutes: preparationMinutes,
              },
              {
                role: "follow_up" as const,
                label: "Nachbereitung",
                minutes: followUpMinutes,
              },
            ];
            for (const { role, label, minutes } of wanted) {
              if (!minutes || existing.has(`${event.id} ${role}`)) continue;
              const window = windowOf({ fixedEventId: event.id, role }, events);
              if (!window || window.end <= now) continue;
              added.push({
                id: randomUUID(),
                studentId,
                courseId,
                fixedEventId: event.id,
                role,
                title: `${label}: ${series.title}`,
                estimateMinutes: minutes,
                estimatedBy: "student" as const,
              });
            }
          }
        }
        await tx.task.createMany({ data: added });
        return { status: "ok", added: added.length } as const;
      });
    },
    /**
     * Skips a Routine until an instant, as a Shortfall's tradeoff offers: Course Events that begin before then get no
     * Preparation or Follow-up, and their untouched ones go. The student's choice, so no Approval.
     */
    async skipRoutine(p: Principal, seriesId: string, until: Date) {
      if (Number.isNaN(until.getTime())) return { status: "invalid" } as const;
      const skipped = await withOwner(db, p, async (tx) => {
        const { count } = await tx.routine.updateMany({
          where: { seriesId },
          data: { skippedUntil: until },
        });
        return { status: count ? "ok" : "gone" } as const;
      });
      if (skipped.status === "ok") await this.applyRoutines(p);
      return skipped;
    },
    /** Started daily by the worker: applies the Routines of every student who has one, so the 14 days roll on. */
    async tickRoutines() {
      const students = await db.$queryRaw<
        { studentId: string }[]
      >`SELECT "studentId" FROM routine_students()`;
      for (const { studentId } of students) {
        // One student's failure leaves their Routines to the next tick, not the others'.
        try {
          await this.applyRoutines(principal.fromSession({ studentId }));
        } catch (error) {
          console.error("Routine tick failed for a student", error);
        }
      }
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
                items.find((o) => o.id === task.obligationId)?.course ??
                task.course,
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

/** How far before the first Course Event of a series it is prepared for, and after the last followed up on. */
const openWindowMs = 7 * dayMs;
type EventRow = {
  id: string;
  seriesId: string | null;
  detachedAt: Date | null;
} & Interval;
/**
 * The window of a Routine's Task: a Preparation from the end of the previous Course Event of its series to the start
 * of its own; a Follow-up from its end to the start of the next. Without a neighbor, a week.
 */
function windowOf(
  task: { fixedEventId: string | null; role: string | null },
  events: readonly EventRow[],
): Interval | null {
  const event = events.find((e) => e.id === task.fixedEventId);
  if (!event || !task.role) return null;
  const series = events.filter(
    (e) => e.seriesId === event.seriesId && !e.detachedAt && e.id !== event.id,
  );
  if (task.role === "preparation") {
    const previous = series.filter((e) => e.start < event.start).at(-1);
    return {
      start: previous?.end ?? new Date(event.start.getTime() - openWindowMs),
      end: event.start,
    };
  }
  const next = series.find((e) => e.start > event.start);
  return {
    start: event.end,
    end: next?.start ?? new Date(event.end.getTime() + openWindowMs),
  };
}

/** When an event takes place in the student's week, such as "Mon 10:00–12:00". */
function slotOf({ start, end }: Interval, timeZone: string) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(start);
  const time = (instant: Date) =>
    hhmm(local(instant.getTime(), timeZone).minute);
  return `${weekday} ${time(start)}–${time(end)}`;
}

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
