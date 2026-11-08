import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { withOwner, type Principal, type Transaction } from "@nunio/delegation";
import type { Facts } from "@nunio/knowledge";
import { rebalance, type Move, type PlanState } from "./rebalance.js";

export type WorkRef = { kind: "obligation" | "task"; id: string };
type Actor = "nunio" | "student";
type Estimate = { minutes: number; estimatedBy: Actor; rationale: string | null };
type ObligationKind = "exam" | "assignment" | "presentation" | "thesis" | "registration" | "other";
type ReviewState = "unreviewed" | "confirmed" | "rejected";

/** The UTC offset of a time zone at an instant, in milliseconds. */
function offsetMs(ms: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(ms).map(part => [part.type, part.value]));
  return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!) - ms;
}

/**
 * A deadline's instant from its local date and time. A date without a time counts from the start of that day, so work
 * is planned before an exam day, not on it.
 */
export function deadline(date: string, time: string | null, timeZone: string) {
  const wall = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), ...(time ? [+time.slice(0, 2), +time.slice(3, 5)] : [0, 0]));
  // Correct twice: the offset at the guessed instant can differ from the offset at the answer across a DST change.
  const guess = wall - offsetMs(wall, timeZone);
  return new Date(wall - offsetMs(guess, timeZone));
}

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
        return { id: o.id, courseId: course.id, title: o.title, kind: o.kind as ObligationKind, state: o.state as ReviewState,
          due: o.due.date ? deadline(o.due.date, o.due.time, o.due.timeZone ?? "Europe/Berlin") : null,
          estimate: estimate ? { minutes: estimate.minutes, estimatedBy: estimate.estimatedBy as Actor, rationale: estimate.rationale } as Estimate : null };
      }));
  }
  /** Everything a Rebalance reads, gathered in one transaction. */
  async function current(p: Principal, tx: Transaction) {
    const preference = await tx.planPreference.findFirst();
    const items = await obligations(p, tx);
    const blocks = (await tx.studyBlock.findMany({ orderBy: { start: "asc" } })).map(block => ({
      id: block.id, work: (block.obligationId ? { kind: "obligation", id: block.obligationId } : { kind: "task", id: block.taskId! }) as WorkRef,
      start: block.start, end: block.end, placedBy: block.placedBy as Actor, locked: Boolean(block.lockedAt) }));
    const state: PlanState = {
      now: clock.now(), timeZone: preference?.timeZone ?? "Europe/Berlin",
      obligations: items.map(o => ({ id: o.id, due: o.due, estimateMinutes: o.estimate?.minutes ?? null, priority: 100 })),
      tasks: [], fixedEvents: [], protectedTime: [],
      studyBlocks: blocks.map(({ work, ...block }) => ({ ...block, workId: work.id })),
      preferences: { studyWindow: { fromMinute: preference?.studyFromMinute ?? 540, toMinute: preference?.studyToMinute ?? 1080 },
        maxMinutesPerDay: preference?.maxMinutesPerDay ?? 240 },
    };
    return { obligations: items, studyBlocks: blocks, proposal: rebalance(state) };
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

const same = (a: Date, b: Date) => a.getTime() === b.getTime();
function sameMove(a: Move, b: Move) {
  if (a.kind === "create" && b.kind === "create") return a.workId === b.workId && same(a.start, b.start) && same(a.end, b.end);
  if (a.kind === "move" && b.kind === "move") return a.blockId === b.blockId && same(a.to.start, b.to.start) && same(a.to.end, b.to.end);
  return false;
}
