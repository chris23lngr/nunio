import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type {
  Clock,
  Delegation,
  Principal,
  Responsibilities,
} from "@nunio/delegation";
import { principal, withOwner } from "@nunio/delegation";
import type { Facts } from "@nunio/knowledge";
import type { Plan } from "@nunio/planning";
import type { Kind, Subject } from "./causes.js";
import { causesOf, subjectOf } from "./causes.js";

export type InterventionView = {
  id: string;
  kind: Kind;
  subject: Subject;
  raisedAt: Date;
  state: "open" | "acknowledged" | "dismissed" | "lapsed";
  closedAt: Date | null;
};

/** What a Briefing bundled when it was made; it is never edited afterwards. */
export type BriefingView = {
  id: string;
  madeAt: Date;
  interventions: string[];
  approvals: string[];
  responsibilities: string[];
};

export type OutreachSettings = {
  /** Minutes after local midnight in the Plan's time zone; null turns Briefings off. */
  briefingAtMinute: number | null;
};

type Bundled = Omit<BriefingView, "id" | "madeAt">;
type PlanView = Awaited<ReturnType<Plan["view"]>>;

const defaultBriefingAtMinute = 7 * 60;

/** The date and minute of the day on the student's wall clock. */
function wallClock(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minute: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

export class NotOpenError extends Error {}
export class UnknownInterventionError extends Error {}

/** Interventions raised from their causes, Briefings, the Inbox, and how the student closes what is in it. */
export function createOutreach({
  db,
  clock,
  plan,
  facts,
  delegation,
  responsibilities,
}: {
  db: PrismaClient;
  clock: Clock;
  plan: Plan;
  facts: Facts;
  delegation: Delegation;
  responsibilities: Responsibilities;
}) {
  /** Raises an Intervention for each new cause, and ends the causes that no longer hold. */
  async function sync(p: Principal, { proposal }: PlanView) {
    const [review, expired, unconfirmed] = await Promise.all([
      facts.review(p),
      delegation.history(p, { status: "refused", limit: 500 }),
      delegation.history(p, { status: "unconfirmed", limit: 500 }),
    ]);
    const current = causesOf({
      shortfalls: proposal.shortfalls,
      review,
      actions: [...expired, ...unconfirmed],
    });
    const at = clock.now();
    await withOwner(db, p, async (tx, studentId) => {
      const live = await tx.intervention.findMany({
        where: { causeEndedAt: null },
        select: { id: true, dedupeKey: true, kind: true },
      });
      const liveKeys = new Set(live.map((r) => r.dedupeKey));
      const currentKeys = new Set(current.map((c) => c.key));
      await tx.intervention.createMany({
        data: current
          .filter((c) => !liveKeys.has(c.key))
          .map((c) => ({
            id: randomUUID(),
            studentId,
            kind: c.kind,
            dedupeKey: c.key,
            actionId: c.actionId,
            createdAt: at,
          })),
        skipDuplicates: true,
      });
      // An expired Approval stays expired, so its cause never ends by itself.
      const ended = live.filter(
        (r) => r.kind !== "approval_expired" && !currentKeys.has(r.dedupeKey),
      );
      if (ended.length)
        await tx.intervention.updateMany({
          where: { id: { in: ended.map((r) => r.id) } },
          data: { causeEndedAt: at },
        });
    });
  }

  /** Makes the day's Briefing once the student's Briefing time has passed; a day with nothing to bundle has none. */
  async function brief(p: Principal, view: PlanView) {
    const at = clock.now();
    const { date, minute } = wallClock(at, view.limits.preferences.timeZone);
    const settings = await withOwner(db, p, (tx) =>
      tx.outreachSettings.findFirst(),
    );
    const briefingAt = settings
      ? settings.briefingAtMinute
      : defaultBriefingAtMinute;
    if (briefingAt === null || minute < briefingAt) return;
    if (settings?.lastBriefingOn === date) return;
    const [approvals, delegated] = await Promise.all([
      delegation.history(p, { status: "awaiting_approval" }),
      responsibilities.list(p),
    ]);
    await withOwner(db, p, async (tx, studentId) => {
      const open = await tx.intervention.findMany({
        where: { acknowledgedAt: null, dismissedAt: null, causeEndedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const items: Bundled = {
        interventions: open.map((i) => i.id),
        approvals: approvals.map((a) => a.id),
        responsibilities: delegated
          .filter((r) => r.state === "active")
          .map((r) => r.id),
      };
      if (Object.values(items).some((ids) => ids.length))
        await tx.briefing.createMany({
          data: [
            {
              id: randomUUID(),
              studentId,
              localDate: date,
              createdAt: at,
              items,
            },
          ],
          skipDuplicates: true,
        });
      await tx.outreachSettings.upsert({
        where: { studentId },
        create: { studentId, lastBriefingOn: date },
        update: { lastBriefingOn: date },
      });
    });
  }

  return {
    /** Worker only: brings every active student's Interventions up to date with their causes, and makes due Briefings. */
    async tick(): Promise<void> {
      const students = await db.$queryRaw<
        { studentId: string }[]
      >`SELECT "studentId" FROM outreach_students()`;
      for (const { studentId } of students) {
        const p = principal.fromSession({ studentId });
        const view = await plan.view(p);
        await sync(p, view);
        await brief(p, view);
      }
    },
    async inbox(student: Principal): Promise<{
      interventions: InterventionView[];
      briefings: BriefingView[];
    }> {
      const [rows, briefings] = await withOwner(db, student, (tx) =>
        Promise.all([
          tx.intervention.findMany({ orderBy: { createdAt: "desc" } }),
          tx.briefing.findMany({ orderBy: { createdAt: "desc" }, take: 7 }),
        ]),
      );
      const views = rows.map(
        (r): InterventionView => ({
          id: r.id,
          kind: r.kind as InterventionView["kind"],
          subject: subjectOf(r.dedupeKey),
          raisedAt: r.createdAt,
          state: r.acknowledgedAt
            ? "acknowledged"
            : r.dismissedAt
              ? "dismissed"
              : r.causeEndedAt
                ? "lapsed"
                : "open",
          closedAt: r.acknowledgedAt ?? r.dismissedAt ?? r.causeEndedAt,
        }),
      );
      return {
        interventions: [
          ...views.filter((v) => v.state === "open"),
          ...views.filter((v) => v.state !== "open"),
        ],
        briefings: briefings.map((b) => ({
          id: b.id,
          madeAt: b.createdAt,
          ...(b.items as Bundled),
        })),
      };
    },
    async settings(student: Principal): Promise<OutreachSettings> {
      const stored = await withOwner(db, student, (tx) =>
        tx.outreachSettings.findFirst(),
      );
      return {
        briefingAtMinute: stored
          ? stored.briefingAtMinute
          : defaultBriefingAtMinute,
      };
    },
    /** A changed time applies from the next Briefing; one already made or skipped today stays so. */
    async updateSettings(
      student: Principal,
      patch: Partial<OutreachSettings>,
    ): Promise<OutreachSettings> {
      const stored = await withOwner(db, student, (tx, studentId) =>
        tx.outreachSettings.upsert({
          where: { studentId },
          create: { studentId, ...patch },
          update: patch,
        }),
      );
      return { briefingAtMinute: stored.briefingAtMinute };
    },
    async close(
      student: Principal,
      interventionId: string,
      as: "acknowledged" | "dismissed",
    ): Promise<void> {
      const at = clock.now();
      await withOwner(db, student, async (tx) => {
        const { count } = await tx.intervention.updateMany({
          where: {
            id: interventionId,
            acknowledgedAt: null,
            dismissedAt: null,
            causeEndedAt: null,
          },
          data:
            as === "acknowledged"
              ? { acknowledgedAt: at }
              : { dismissedAt: at },
        });
        if (count > 0) return;
        // Row-level security hides another student's Intervention, so it reads as unknown.
        const known = await tx.intervention.count({
          where: { id: interventionId },
        });
        throw known
          ? new NotOpenError(interventionId)
          : new UnknownInterventionError(interventionId);
      });
    },
  };
}

export type Outreach = ReturnType<typeof createOutreach>;
