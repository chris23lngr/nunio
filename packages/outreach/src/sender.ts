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
import { causesOf, keyOf } from "./causes.js";
import type {
  BriefingItems,
  OutreachSettings,
  StoredSubscription,
} from "./outreach.js";
import {
  openIntervention,
  pushSubscriptionOf,
  settingsOf,
  unsubscribeToken,
} from "./outreach.js";

type PlanView = Awaited<ReturnType<Plan["view"]>>;

/** Whether `minute` of the day falls in Quiet Hours, which may wrap midnight. */
const inQuietHours = (
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

/** When the student's local day containing `at` began, in their time zone; DST days are 23 or 25 hours long. */
function startOfDay(at: Date, timeZone: string): Date {
  /** How far the wall clock is ahead of UTC at `instant`. */
  const offsetAt = (instant: number) => {
    const { date, minute } = wallClock(new Date(instant), timeZone);
    return (
      Date.parse(`${date}T00:00Z`) +
      minute * 60_000 -
      (instant - (instant % 60_000))
    );
  };
  const midnightAsUtc = Date.parse(`${wallClock(at, timeZone).date}T00:00Z`);
  // Twice, in case the offset at midnight differs from the one at the first guess.
  const guess = midnightAsUtc - offsetAt(midnightAsUtc);
  return new Date(midnightAsUtc - offsetAt(guess));
}

/** Sends one email; true external, so it is injected. */
export interface Mailer {
  send(
    to: string,
    message: {
      subject: string;
      text: string;
      headers?: Record<string, string>;
    },
  ): Promise<void>;
}

/** Sends one empty push to one device; true external, so it is injected. */
export interface Pusher {
  send(
    subscription: StoredSubscription,
    options: { ttlSeconds: number; urgency: "low" | "normal" },
  ): Promise<"sent" | "gone">;
}

const channels = ["email", "push"] as const;
type Channel = (typeof channels)[number];
/** Long enough to reach a phone that was off overnight, never the library's four weeks. */
const pushTtlSeconds = 12 * 60 * 60;

/** The worker's side of Outreach: raises Interventions from their causes, makes Briefings, and sends what is due. */
export function createOutreachSender({
  db,
  clock,
  plan,
  facts,
  delegation,
  responsibilities,
  mailer,
  pusher,
  inboxUrl,
  unsubscribe,
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
  /** Signs the one-click link that stops Briefing emails (RFC 8058); the API verifies it with the same secret. */
  unsubscribe: { secret: string; url: string };
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
      const currentKeys = new Set(current.map(keyOf));
      const raised = current
        .filter((c) => !liveKeys.has(keyOf(c)))
        .map((c) => ({
          id: randomUUID(),
          studentId,
          kind: c.kind,
          dedupeKey: keyOf(c),
          actionId: c.subject.kind === "action" ? c.subject.id : null,
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
        where: openIntervention,
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const items: BriefingItems = {
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
    const { timeZone } = view.limits.preferences;
    const { minute } = wallClock(at, timeZone);
    const settings = settingsOf(
      await withOwner(db, p, (tx) => tx.outreachSettings.findFirst()),
    );
    // Nothing leaves the app in Quiet Hours; what is due waits for the first tick after them.
    if (inQuietHours(minute, settings.quietHours)) return;
    const pending = await withOwner(db, p, async (tx, studentId) => {
      const queued = await tx.delivery.findMany({
        where: { sentAt: null, droppedAt: null, dueAt: { lte: at } },
      });
      const open = new Set(
        (
          await tx.intervention.findMany({
            where: {
              id: { in: queued.flatMap((d) => d.interventionId ?? []) },
              ...openIntervention,
            },
            select: { id: true },
          })
        ).map((i) => i.id),
      );
      const { email, briefingEmail, dailyLimit } = settings;
      // A tick's announcements share one sentAt across channels, so each counts once.
      const midnight = startOfDay(at, timeZone);
      const announcedToday = (
        await tx.delivery.findMany({
          where: { interventionId: { not: null }, sentAt: { gte: midnight } },
          distinct: ["sentAt"],
          select: { sentAt: true },
        })
      ).length;
      const subscriptions = (await tx.pushSubscription.findMany()).map(
        pushSubscriptionOf,
      );
      const reasonOf = (d: (typeof queued)[number]) => {
        // A message about an Intervention that closed meanwhile no longer applies.
        if (d.interventionId && !open.has(d.interventionId)) return "closed";
        if (
          d.channel === "email"
            ? !email || (d.briefingId !== null && !briefingEmail)
            : !subscriptions.length
        )
          return "disabled";
        // Past the limit, an Intervention waits in the Inbox and the next Briefing instead.
        if (d.interventionId && announcedToday >= dailyLimit) return "limit";
        return "send";
      };
      const byReason: Record<ReturnType<typeof reasonOf>, typeof queued> = {
        send: [],
        closed: [],
        disabled: [],
        limit: [],
      };
      for (const d of queued) byReason[reasonOf(d)].push(d);
      for (const reason of ["closed", "disabled", "limit"] as const)
        if (byReason[reason].length)
          await tx.delivery.updateMany({
            where: { id: { in: byReason[reason].map((d) => d.id) } },
            data: { droppedAt: at, dropReason: reason },
          });
      return {
        due: byReason.send,
        to: (await tx.user.findUniqueOrThrow({ where: { id: studentId } }))
          .email,
        subscriptions,
        studentId,
      };
    });
    for (const channel of channels) {
      // One channel failing leaves its messages due; the others still go out.
      try {
        await sendChannel(p, channel, at, {
          ...pending,
          due: pending.due.filter((d) => d.channel === channel),
        });
      } catch (error) {
        console.error(`Outreach ${channel} failed for a student`, error);
      }
    }
  }

  /** Sends one channel's due messages: one for the Interventions it announces, one for a Briefing. */
  async function sendChannel(
    p: Principal,
    channel: Channel,
    at: Date,
    {
      due,
      to,
      subscriptions,
      studentId,
    }: {
      studentId: string;
      due: {
        id: string;
        interventionId: string | null;
        briefingId: string | null;
      }[];
      to: string;
      subscriptions: ({ id: string } & StoredSubscription)[];
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
          headers: {
            "List-Unsubscribe": `<${unsubscribe.url}?s=${studentId}&t=${unsubscribeToken(unsubscribe.secret, studentId)}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        },
        "low",
      ],
    ] as const) {
      if (!batch.length) continue;
      if (channel === "email") await mailer.send(to, message);
      else
        for (const s of subscriptions) {
          const outcome = await pusher.send(s, {
            ttlSeconds: pushTtlSeconds,
            urgency,
          });
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
    /** Every five minutes: brings every active student's Interventions up to date with their causes, makes due Briefings, and sends what is due. */
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
  };
}

export type OutreachSender = ReturnType<typeof createOutreachSender>;
