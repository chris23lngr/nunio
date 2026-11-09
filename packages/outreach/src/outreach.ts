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
  /** When nothing goes out outside the app, in the Plan's time zone; may wrap midnight. */
  quietHours: { fromMinute: number; toMinute: number } | null;
  /** Announcements of Interventions per local day, email and push combined; Briefings do not count. */
  dailyLimit: number;
};

type Bundled = Omit<BriefingView, "id" | "madeAt">;
type PlanView = Awaited<ReturnType<Plan["view"]>>;

const defaults: OutreachSettings = {
  briefingAtMinute: 7 * 60,
  email: true,
  quietHours: null,
  dailyLimit: 3,
};
const settingsOf = (
  stored: {
    briefingAtMinute: number | null;
    email: boolean;
    quietFromMinute: number | null;
    quietToMinute: number | null;
    dailyLimit: number;
  } | null,
): OutreachSettings =>
  stored
    ? {
        briefingAtMinute: stored.briefingAtMinute,
        email: stored.email,
        quietHours:
          stored.quietFromMinute === null || stored.quietToMinute === null
            ? null
            : {
                fromMinute: stored.quietFromMinute,
                toMinute: stored.quietToMinute,
              },
        dailyLimit: stored.dailyLimit,
      }
    : defaults;

/** Whether `minute` of the day falls in Quiet Hours, which may wrap midnight. */
const quiet = (
  minute: number,
  hours: OutreachSettings["quietHours"],
): boolean =>
  hours !== null &&
  (hours.fromMinute <= hours.toMinute
    ? minute >= hours.fromMinute && minute < hours.toMinute
    : minute >= hours.fromMinute || minute < hours.toMinute);

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

/** Sends one empty push to one device; true external, so it is injected. */
export interface Pusher {
  /** The public VAPID key it signs with, stored with each subscription. */
  keyId: string;
  send(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    options: { ttlSeconds: number; urgency: "low" | "normal" },
  ): Promise<"sent" | "gone">;
}

/** A device's subscription as the browser's PushSubscription.toJSON() gives it. */
export type PushSubscriptionJson = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
};

const channels = ["email", "push"] as const;
type Channel = (typeof channels)[number];
/** Long enough to reach a phone that was off overnight, never the library's four weeks. */
const pushTtlSeconds = 12 * 60 * 60;

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
  pusher,
  inboxUrl,
}: {
  db: PrismaClient;
  clock: Clock;
  plan: Plan;
  facts: Facts;
  delegation: Delegation;
  responsibilities: Responsibilities;
  mailer: Mailer;
  pusher: Pusher;
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
        data: channels.flatMap((channel) =>
          raised.map((i) => ({
            id: randomUUID(),
            studentId,
            channel,
            interventionId: i.id,
            dueAt: at,
          })),
        ),
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
        await tx.delivery.createMany({
          data: channels.map((channel) => ({
            id: randomUUID(),
            studentId,
            channel,
            briefingId: id,
            dueAt: at,
          })),
        });
      await tx.outreachSettings.upsert({
        where: { studentId },
        create: { studentId, lastBriefingOn: date },
        update: { lastBriefingOn: date },
      });
    });
  }

  /** Sends what is due on each channel; every message is content-free and points to the Inbox. */
  async function deliver(p: Principal, view: PlanView) {
    const at = clock.now();
    const { minute } = wallClock(at, view.limits.preferences.timeZone);
    const settings = settingsOf(
      await withOwner(db, p, (tx) => tx.outreachSettings.findFirst()),
    );
    // Nothing leaves the app in Quiet Hours; what is due waits for the first tick after them.
    if (quiet(minute, settings.quietHours)) return;
    const pending = await withOwner(db, p, async (tx, studentId) => {
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
      const { email, dailyLimit } = settings;
      // A tick's announcements share one sentAt across channels, so each counts once.
      const midnight = new Date(
        at.getTime() - minute * 60_000 - (at.getTime() % 60_000),
      );
      const announcedToday = (
        await tx.delivery.findMany({
          where: { interventionId: { not: null }, sentAt: { gte: midnight } },
          distinct: ["sentAt"],
          select: { sentAt: true },
        })
      ).length;
      const subscriptions = await tx.pushSubscription.findMany();
      // A message about an Intervention that closed meanwhile no longer applies.
      const closed = queued.filter(
        (d) => d.interventionId && !open.has(d.interventionId),
      );
      const disabled = queued.filter(
        (d) =>
          !closed.includes(d) &&
          (d.channel === "email" ? !email : !subscriptions.length),
      );
      // Past the limit, an Intervention waits in the Inbox and the next Briefing instead.
      const limited =
        announcedToday < dailyLimit
          ? []
          : queued.filter(
              (d) =>
                d.interventionId &&
                !closed.includes(d) &&
                !disabled.includes(d),
            );
      for (const [reason, dropped] of [
        ["closed", closed],
        ["disabled", disabled],
        ["limit", limited],
      ] as const)
        if (dropped.length)
          await tx.delivery.updateMany({
            where: { id: { in: dropped.map((d) => d.id) } },
            data: { droppedAt: at, dropReason: reason },
          });
      return {
        due: queued.filter(
          (d) =>
            !closed.includes(d) &&
            !disabled.includes(d) &&
            !limited.includes(d),
        ),
        to: (await tx.user.findUniqueOrThrow({ where: { id: studentId } }))
          .email,
        subscriptions,
      };
    });
    for (const channel of channels) {
      // One channel failing leaves its messages due; the others still go out.
      try {
        await send(p, channel, at, {
          ...pending,
          due: pending.due.filter((d) => d.channel === channel),
        });
      } catch (error) {
        console.error(`Outreach ${channel} failed for a student`, error);
      }
    }
  }

  async function send(
    p: Principal,
    channel: Channel,
    at: Date,
    {
      due,
      to,
      subscriptions,
    }: {
      due: {
        id: string;
        interventionId: string | null;
        briefingId: string | null;
      }[];
      to: string;
      subscriptions: {
        id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
      }[];
    },
  ) {
    const announcing = due.filter((d) => d.interventionId);
    const briefing = due.filter((d) => d.briefingId);
    for (const [batch, message, urgency] of [
      [
        announcing,
        {
          subject: `nunio: ${announcing.length} ${announcing.length === 1 ? "item needs" : "items need"} your attention`,
          text: `Open your Inbox to see what needs your attention:\n\n${inboxUrl}`,
        },
        "normal",
      ],
      [
        briefing,
        {
          subject: "Your nunio Briefing is ready",
          text: `Your Briefing is in your Inbox:\n\n${inboxUrl}`,
        },
        "low",
      ],
    ] as const) {
      if (!batch.length) continue;
      if (channel === "email") await mailer.send(to, message);
      else
        for (const s of subscriptions) {
          const outcome = await pusher.send(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            { ttlSeconds: pushTtlSeconds, urgency },
          );
          if (outcome === "gone")
            await withOwner(db, p, (tx) =>
              tx.pushSubscription.deleteMany({ where: { id: s.id } }),
            );
        }
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
          await deliver(p, view);
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
    /** The public VAPID key a browser subscribes with. */
    pushKey: pusher.keyId,
    /** Opts one device in to push; subscribing the same device again changes nothing. */
    async subscribe(student: Principal, subscription: PushSubscriptionJson) {
      await withOwner(db, student, (tx, studentId) =>
        tx.pushSubscription.createMany({
          data: [
            {
              id: randomUUID(),
              studentId,
              endpoint: subscription.endpoint,
              p256dh: subscription.keys.p256dh,
              auth: subscription.keys.auth,
              expirationTime:
                subscription.expirationTime === null
                  ? null
                  : new Date(subscription.expirationTime),
              vapidKeyId: pusher.keyId,
            },
          ],
          skipDuplicates: true,
        }),
      );
    },
    async unsubscribe(student: Principal, endpoint: string) {
      await withOwner(db, student, (tx) =>
        tx.pushSubscription.deleteMany({ where: { endpoint } }),
      );
    },
    async settings(student: Principal): Promise<OutreachSettings> {
      return settingsOf(
        await withOwner(db, student, (tx) => tx.outreachSettings.findFirst()),
      );
    },
    /** A changed time applies from the next Briefing; one already made or skipped today stays so. */
    async updateSettings(
      student: Principal,
      { quietHours, ...patch }: Partial<OutreachSettings>,
    ): Promise<OutreachSettings> {
      const columns = {
        ...patch,
        ...(quietHours !== undefined && {
          quietFromMinute: quietHours?.fromMinute ?? null,
          quietToMinute: quietHours?.toMinute ?? null,
        }),
      };
      const stored = await withOwner(db, student, (tx, studentId) =>
        tx.outreachSettings.upsert({
          where: { studentId },
          create: { studentId, ...columns },
          update: columns,
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
