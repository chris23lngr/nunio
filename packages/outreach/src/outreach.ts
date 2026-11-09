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
  /** Whether nunio emails the student; the Inbox has everything either way. */
  email: boolean;
};

type Bundled = Omit<BriefingView, "id" | "madeAt">;
type PlanView = Awaited<ReturnType<Plan["view"]>>;

const defaults: OutreachSettings = { briefingAtMinute: 7 * 60, email: true };
const settingsOf = (
  stored: { briefingAtMinute: number | null; email: boolean } | null,
): OutreachSettings =>
  stored
    ? { briefingAtMinute: stored.briefingAtMinute, email: stored.email }
    : defaults;

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

/** Sends one email; true external, so it is injected. */
export interface Mailer {
  send(to: string, message: { subject: string; text: string }): Promise<void>;
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
  mailer,
  inboxUrl,
}: {
  db: PrismaClient;
  clock: Clock;
  plan: Plan;
  facts: Facts;
  delegation: Delegation;
  responsibilities: Responsibilities;
  mailer: Mailer;
  /** The only link a message outside the app carries. */
  inboxUrl: string;
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
      const raised = current
        .filter((c) => !liveKeys.has(c.key))
        .map((c) => ({
          id: randomUUID(),
          studentId,
          kind: c.kind,
          dedupeKey: c.key,
          actionId: c.actionId,
          createdAt: at,
        }));
      await tx.intervention.createMany({ data: raised, skipDuplicates: true });
      await tx.delivery.createMany({
        data: raised.map((i) => ({
          id: randomUUID(),
          studentId,
          channel: "email",
          interventionId: i.id,
          dueAt: at,
        })),
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
    const briefingAt = settingsOf(settings).briefingAtMinute;
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
      const id = randomUUID();
      const made =
        Object.values(items).some((ids) => ids.length) &&
        (
          await tx.briefing.createMany({
            data: [{ id, studentId, localDate: date, createdAt: at, items }],
            skipDuplicates: true,
          })
        ).count > 0;
      if (made)
        await tx.delivery.create({
          data: {
            id: randomUUID(),
            studentId,
            channel: "email",
            briefingId: id,
            dueAt: at,
          },
        });
      await tx.outreachSettings.upsert({
        where: { studentId },
        create: { studentId, lastBriefingOn: date },
        update: { lastBriefingOn: date },
      });
    });
  }

  /** Sends what is due as one content-free email that points to the Inbox. */
  async function deliver(p: Principal) {
    const at = clock.now();
    const { due, to } = await withOwner(db, p, async (tx, studentId) => {
      const queued = await tx.delivery.findMany({
        where: { sentAt: null, droppedAt: null, dueAt: { lte: at } },
      });
      const open = new Set(
        (
          await tx.intervention.findMany({
            where: {
              id: { in: queued.flatMap((d) => d.interventionId ?? []) },
              acknowledgedAt: null,
              dismissedAt: null,
              causeEndedAt: null,
            },
            select: { id: true },
          })
        ).map((i) => i.id),
      );
      const { email } = settingsOf(await tx.outreachSettings.findFirst());
      // A message about an Intervention that closed meanwhile no longer applies.
      const closed = queued.filter(
        (d) => d.interventionId && !open.has(d.interventionId),
      );
      const disabled = email ? [] : queued.filter((d) => !closed.includes(d));
      for (const [reason, dropped] of [
        ["closed", closed],
        ["disabled", disabled],
      ] as const)
        if (dropped.length)
          await tx.delivery.updateMany({
            where: { id: { in: dropped.map((d) => d.id) } },
            data: { droppedAt: at, dropReason: reason },
          });
      return {
        due: email ? queued.filter((d) => !closed.includes(d)) : [],
        to: (await tx.user.findUniqueOrThrow({ where: { id: studentId } }))
          .email,
      };
    });
    const announcing = due.filter((d) => d.interventionId);
    const briefing = due.filter((d) => d.briefingId);
    for (const [batch, message] of [
      [
        announcing,
        {
          subject: `nunio: ${announcing.length} ${announcing.length === 1 ? "item needs" : "items need"} your attention`,
          text: `Open your Inbox to see what needs your attention:\n\n${inboxUrl}`,
        },
      ],
      [
        briefing,
        {
          subject: "Your nunio Briefing is ready",
          text: `Your Briefing is in your Inbox:\n\n${inboxUrl}`,
        },
      ],
    ] as const) {
      if (!batch.length) continue;
      await mailer.send(to, message);
      await withOwner(db, p, (tx) =>
        tx.delivery.updateMany({
          where: { id: { in: batch.map((d) => d.id) } },
          data: { sentAt: at },
        }),
      );
    }
  }

  return {
    /** Worker only: brings every active student's Interventions up to date with their causes, and makes due Briefings. */
    async tick(): Promise<void> {
      const students = await db.$queryRaw<
        { studentId: string }[]
      >`SELECT "studentId" FROM outreach_students()`;
      for (const { studentId } of students) {
        const p = principal.fromSession({ studentId });
        // One student's failure leaves their work to the next tick, not the others'.
        try {
          const view = await plan.view(p);
          await sync(p, view);
          await brief(p, view);
          await deliver(p);
        } catch (error) {
          console.error("Outreach tick failed for a student", error);
        }
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
      return settingsOf(
        await withOwner(db, student, (tx) => tx.outreachSettings.findFirst()),
      );
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
      return settingsOf(stored);
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
