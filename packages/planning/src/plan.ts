import { randomUUID } from "node:crypto";
import type { Estimator } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import { withOwner, type Delegation, type Principal, type Transaction } from "@nunio/delegation";
import { definitely, type Facts } from "@nunio/knowledge";
import { readCalendar } from "./calendar.js";
import { deadline } from "./time.js";
import { rebalance, type Interval, type Move, type PlanState } from "./rebalance.js";

export type WorkRef = { kind: "obligation" | "task"; id: string };
type Actor = "nunio" | "student";
type Estimate = { minutes: number; estimatedBy: Actor; rationale: string | null };
type ObligationKind = "exam" | "assignment" | "presentation" | "thesis" | "registration" | "other";
type ReviewState = "unreviewed" | "confirmed" | "rejected";

/** The student's Plan: Tasks, Estimates and Study Blocks, and a Rebalance proposal over them. */
export function createPlan({ db, facts, clock }: { db: PrismaClient; facts: Facts; clock: { now(): Date } }) {
  /** Every Obligation the student has not rejected, with its deadline and Estimate. */
  async function obligations(p: Principal, tx: Transaction) {
    const { courses } = await facts.review(p);
    const estimates = await tx.obligationEstimate.findMany();
    return courses.filter(course => course.status !== "rejected").flatMap(course => course.obligations
      .filter(o => o.state !== "rejected")
      .map(o => {
        const estimate = estimates.find(e => e.obligationId === o.id);
        return { id: o.id, courseId: course.id, course: course.title, title: o.title, kind: o.kind as ObligationKind, state: o.state as ReviewState,
          due: o.due.date ? deadline(o.due.date, o.due.time, o.due.timeZone ?? "Europe/Berlin") : null,
          estimate: estimate ? { minutes: estimate.minutes, estimatedBy: estimate.estimatedBy as Actor, rationale: estimate.rationale } as Estimate : null };
      }));
  }
  /** Everything a Rebalance reads, gathered in one transaction. */
  async function current(p: Principal, tx: Transaction) {
    const stored = await tx.planPreference.findFirst();
    const preferences = { timeZone: stored?.timeZone ?? defaults.timeZone, studyFromMinute: stored?.studyFromMinute ?? defaults.studyFromMinute,
      studyToMinute: stored?.studyToMinute ?? defaults.studyToMinute, maxMinutesPerDay: stored?.maxMinutesPerDay ?? defaults.maxMinutesPerDay };
    const protectedTime = (await tx.protectedTime.findMany({ orderBy: [{ weekday: "asc" }, { fromMinute: "asc" }] }))
      .map(({ id, weekday, fromMinute, toMinute }) => ({ id, weekday, fromMinute, toMinute }));
    const ranks = await tx.coursePriority.findMany();
    const fixedEvents = (await tx.fixedEvent.findMany({ orderBy: [{ start: "asc" }, { end: "asc" }] }))
      .map(({ id, title, start, end, importId }) => ({ id, title, start, end, importId }));
    const imports = (await tx.calendarImport.findMany({ orderBy: { importedAt: "asc" }, include: { _count: { select: { events: true } } } }))
      .map(({ id, name, _count }) => ({ id, name, events: _count.events }));
    const items = await obligations(p, tx);
    const blocks = (await tx.studyBlock.findMany({ orderBy: { start: "asc" } })).map(block => ({
      id: block.id, work: (block.obligationId ? { kind: "obligation", id: block.obligationId } : { kind: "task", id: block.taskId! }) as WorkRef,
      start: block.start, end: block.end, placedBy: block.placedBy as Actor, locked: Boolean(block.lockedAt) }));
    const tasks = (await tx.task.findMany({ orderBy: { createdAt: "asc" } })).map(task => ({
      id: task.id, title: task.title, obligationId: task.obligationId,
      estimate: task.estimateMinutes ? { minutes: task.estimateMinutes, estimatedBy: task.estimatedBy as Actor } : null,
      done: Boolean(task.doneAt) }));
    const now = clock.now();
    const latest = Math.max(now.getTime(), ...items.flatMap(o => o.due ? [o.due.getTime()] : []));
    const state: PlanState = {
      now, timeZone: preferences.timeZone,
      obligations: items.map(o => ({ id: o.id, due: o.due, estimateMinutes: o.estimate?.minutes ?? null,
        priority: ranks.find(rank => rank.courseId === o.courseId)?.rank ?? unranked })),
      tasks: tasks.map(task => ({ id: task.id, obligationId: task.obligationId, estimateMinutes: task.estimate?.minutes ?? null, done: task.done })),
      fixedEvents: fixedEvents.map(({ start, end }) => ({ start, end })),
      protectedTime: weekly(protectedTime, now, new Date(latest + dayMs), preferences.timeZone),
      studyBlocks: blocks.map(({ work, ...block }) => ({ ...block, workId: work.id })),
      preferences: { studyWindow: { fromMinute: preferences.studyFromMinute, toMinute: preferences.studyToMinute },
        maxMinutesPerDay: preferences.maxMinutesPerDay },
    };
    return { obligations: items, tasks, studyBlocks: blocks, fixedEvents, imports, limits: { preferences, protectedTime },
      proposal: rebalance(state) };
  }
  return {
    /** The Plan as it stands, and what a Rebalance would change now. */
    async view(p: Principal) {
      return withOwner(db, p, tx => current(p, tx));
    },
    /** Applies one proposed move as the student's own decision, only while it matches a fresh proposal. */
    async apply(p: Principal, move: Move) {
      return withOwner(db, p, async (tx, studentId) => {
        // Serializes a student's applies, so the same move cannot be applied twice concurrently.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${studentId}))`;
        const { obligations: items, proposal } = await current(p, tx);
        if (!proposal.moves.some(proposed => sameMove(proposed, move))) return { status: "stale" } as const;
        if (move.kind === "create") {
          const isObligation = items.some(o => o.id === move.workId);
          await tx.studyBlock.create({ data: { id: randomUUID(), studentId, start: move.start, end: move.end, placedBy: "nunio",
            ...(isObligation ? { obligationId: move.workId } : { taskId: move.workId }) } });
        } else {
          await tx.studyBlock.update({ where: { id: move.blockId }, data: { start: move.to.start, end: move.to.end } });
        }
        return { status: "ok" } as const;
      });
    },
    /** A Task toward one of the student's Obligations, or toward none. */
    async addTask(p: Principal, input: { title: string; obligationId: string | null }) {
      const title = input.title.trim();
      if (!title || title.length > 500) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        if (input.obligationId && !await tx.obligation.findUnique({ where: { id: input.obligationId } })) return { status: "gone" } as const;
        const task = await tx.task.create({ data: { id: randomUUID(), studentId, title, obligationId: input.obligationId } });
        return { status: "ok", id: task.id } as const;
      });
    },
    async completeTask(p: Principal, id: string, done: boolean) {
      return withOwner(db, p, async tx => {
        const { count } = await tx.task.updateMany({ where: { id }, data: { doneAt: done ? clock.now() : null } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** A Study Block the student places themselves; nunio moves it only with their Approval. */
    async placeBlock(p: Principal, input: { work: WorkRef } & Interval) {
      if (!validInterval(input)) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        const exists = input.work.kind === "obligation"
          ? await tx.obligation.findUnique({ where: { id: input.work.id } }) : await tx.task.findUnique({ where: { id: input.work.id } });
        if (!exists) return { status: "gone" } as const;
        const block = await tx.studyBlock.create({ data: { id: randomUUID(), studentId, start: input.start, end: input.end, placedBy: "student",
          ...(input.work.kind === "obligation" ? { obligationId: input.work.id } : { taskId: input.work.id }) } });
        return { status: "ok", id: block.id } as const;
      });
    },
    /** The student moving any block makes it theirs; moving does not Lock it. */
    async moveBlock(p: Principal, id: string, to: Interval) {
      if (!validInterval(to)) return { status: "invalid" } as const;
      return withOwner(db, p, async tx => {
        const { count } = await tx.studyBlock.updateMany({ where: { id }, data: { start: to.start, end: to.end, placedBy: "student" } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** A Locked block is never moved by nunio, not even by asking. */
    async lockBlock(p: Principal, id: string, locked: boolean) {
      return withOwner(db, p, async tx => {
        const { count } = await tx.studyBlock.updateMany({ where: { id }, data: { lockedAt: locked ? clock.now() : null } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    async removeBlock(p: Principal, id: string) {
      return withOwner(db, p, async tx => {
        const { count } = await tx.studyBlock.deleteMany({ where: { id } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** A Fixed Event the student enters by hand. */
    async addFixedEvent(p: Principal, input: { title: string } & Interval) {
      const title = input.title.trim();
      if (!title || title.length > 500 || !validInterval(input)) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        const event = await tx.fixedEvent.create({ data: { id: randomUUID(), studentId, title, start: input.start, end: input.end } });
        return { status: "ok", id: event.id } as const;
      });
    },
    async removeFixedEvent(p: Principal, id: string) {
      return withOwner(db, p, async tx => {
        const { count } = await tx.fixedEvent.deleteMany({ where: { id } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** Reads a calendar file's timed events for the coming year; recurrences are expanded, so importing again extends them. */
    async importCalendar(p: Principal, input: { name: string; ics: string }) {
      const name = input.name.trim().slice(0, 255);
      if (!name) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        const timeZone = (await tx.planPreference.findFirst())?.timeZone ?? defaults.timeZone;
        const now = clock.now();
        const reading = readCalendar(input.ics, { from: now, until: new Date(now.getTime() + 365 * dayMs), timeZone });
        if (reading.status === "invalid") return reading;
        const id = randomUUID();
        await tx.calendarImport.create({ data: { id, studentId, name } });
        await tx.fixedEvent.createMany({ data: reading.events.map(event => ({ id: randomUUID(), studentId, importId: id, ...event })) });
        return { status: "ok", id, events: reading.events.length, skipped: reading.skipped } as const;
      });
    },
    async removeImport(p: Principal, id: string) {
      return withOwner(db, p, async tx => {
        const { count } = await tx.calendarImport.deleteMany({ where: { id } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** Soft rules: breaking one needs Approval, so a Rebalance stays within them. */
    async setPreferences(p: Principal, input: { studyFromMinute: number; studyToMinute: number; maxMinutesPerDay: number }) {
      const { studyFromMinute, studyToMinute, maxMinutesPerDay } = input;
      if (![studyFromMinute, studyToMinute, maxMinutesPerDay].every(Number.isInteger) || studyFromMinute < 0 || studyToMinute > 1440
        || studyToMinute <= studyFromMinute || maxMinutesPerDay < 30 || maxMinutesPerDay > 1440) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        await tx.planPreference.upsert({ where: { studentId }, create: { studentId, ...input }, update: input });
        return { status: "ok" } as const;
      });
    },
    /** A weekly span nunio never schedules into, even with a deadline at risk. */
    async addProtectedTime(p: Principal, input: { weekday: number; fromMinute: number; toMinute: number }) {
      const { weekday, fromMinute, toMinute } = input;
      if (![weekday, fromMinute, toMinute].every(Number.isInteger) || weekday < 1 || weekday > 7 || fromMinute < 0 || toMinute > 1440
        || toMinute <= fromMinute) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        const row = await tx.protectedTime.create({ data: { id: randomUUID(), studentId, ...input } });
        return { status: "ok", id: row.id } as const;
      });
    },
    async removeProtectedTime(p: Principal, id: string) {
      return withOwner(db, p, async tx => {
        const { count } = await tx.protectedTime.deleteMany({ where: { id } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** Ranks the given Courses in order, most important first; Courses not listed are unranked. */
    async rankCourses(p: Principal, courseIds: string[]) {
      if (new Set(courseIds).size !== courseIds.length) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        if (await tx.course.count({ where: { id: { in: courseIds } } }) !== courseIds.length) return { status: "gone" } as const;
        await tx.coursePriority.deleteMany({});
        await tx.coursePriority.createMany({ data: courseIds.map((courseId, i) => ({ courseId, studentId, rank: i + 1 })) });
        return { status: "ok" } as const;
      });
    },
    /** Asks the model for Estimates of Obligations that have none, in one metered call. */
    async proposeEstimates(p: Principal, { estimator, delegation }: { estimator: Estimator; delegation: Delegation }) {
      const missing = (await withOwner(db, p, tx => obligations(p, tx))).filter(o => !o.estimate);
      if (!missing.length) return { status: "ok", proposed: 0 } as const;
      const items = missing.map(o => ({ kind: o.kind, title: o.title, course: o.course }));
      const proposed = await delegation.meter(p, { microUsd: estimator.estimateMicroUsd(items) },
        signal => definitely(() => estimator.estimate(items, { signal })));
      if (proposed.status === "refused") return proposed;
      const written = await withOwner(db, p, async (tx, studentId) => {
        let count = 0;
        for (const [i, estimate] of proposed.value.entries()) {
          const obligationId = missing[i]!.id;
          // The student may have estimated it meanwhile, or the Obligation may be gone; neither is overwritten.
          if (!estimate || await tx.obligationEstimate.findUnique({ where: { obligationId } })
            || !await tx.obligation.findUnique({ where: { id: obligationId } })) continue;
          await tx.obligationEstimate.create({ data: { obligationId, studentId, minutes: estimate.minutes, estimatedBy: "nunio",
            rationale: estimate.rationale } });
          count++;
        }
        return count;
      });
      return { status: "ok", proposed: written } as const;
    },
    /** The student's own Estimate, which a proposal never replaces. */
    async estimate(p: Principal, work: WorkRef, minutes: number) {
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1000 * 60) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        if (work.kind === "obligation") {
          if (!await tx.obligation.findUnique({ where: { id: work.id } })) return { status: "gone" } as const;
          await tx.obligationEstimate.upsert({ where: { obligationId: work.id },
            create: { obligationId: work.id, studentId, minutes, estimatedBy: "student" },
            update: { minutes, estimatedBy: "student", rationale: null } });
        } else {
          const { count } = await tx.task.updateMany({ where: { id: work.id }, data: { estimateMinutes: minutes, estimatedBy: "student" } });
          if (!count) return { status: "gone" } as const;
        }
        return { status: "ok" } as const;
      });
    },
  };
}
export type Plan = ReturnType<typeof createPlan>;

const defaults = { timeZone: "Europe/Berlin", studyFromMinute: 9 * 60, studyToMinute: 18 * 60, maxMinutesPerDay: 240 };
/** Courses the student has not ranked come after every ranked one. */
const unranked = 1000;
const dayMs = 24 * 60 * 60_000;
const isoWeekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Expands weekly rules into the concrete local spans they cover between two instants. */
function weekly(rules: { weekday: number; fromMinute: number; toMinute: number }[], from: Date, until: Date, timeZone: string): Interval[] {
  if (!rules.length) return [];
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  const spans: Interval[] = [];
  // Steps of 24 hours from local noon land on each local day once: a DST change shifts noon by an hour, never past midnight.
  const noon = deadline(day.format(from.getTime() - dayMs), "12:00", timeZone).getTime();
  for (let ms = noon; ms <= until.getTime() + dayMs; ms += dayMs) {
    const date = day.format(ms), next = day.format(ms + dayMs), iso = isoWeekdays.indexOf(weekday.format(ms)) + 1;
    for (const rule of rules.filter(r => r.weekday === iso)) {
      spans.push({ start: deadline(date, clock(rule.fromMinute), timeZone),
        end: rule.toMinute === 1440 ? deadline(next, null, timeZone) : deadline(date, clock(rule.toMinute), timeZone) });
    }
  }
  return spans;
}

/** A positive span of at most two weeks. */
const validInterval = ({ start, end }: Interval) => !Number.isNaN(start.getTime()) && end.getTime() > start.getTime()
  && end.getTime() - start.getTime() <= 14 * 24 * 60 * 60_000;
const same = (a: Date, b: Date) => a.getTime() === b.getTime();
function sameMove(a: Move, b: Move) {
  if (a.kind === "create" && b.kind === "create") return a.workId === b.workId && same(a.start, b.start) && same(a.end, b.end);
  if (a.kind === "move" && b.kind === "move") return a.blockId === b.blockId && same(a.to.start, b.to.start) && same(a.to.end, b.to.end);
  return false;
}
