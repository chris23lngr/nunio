import type { PrismaClient } from "@nunio/db";
import type { Agents, Clock, Delegation, Principal } from "@nunio/delegation";
import { principal, withOwner } from "@nunio/delegation";
import type { Facts } from "@nunio/knowledge";
import type { Plan } from "@nunio/planning";
import { causesOf, keyOf } from "./causes.js";
import type { OutreachSettings, StoredSubscription } from "./outreach.js";
import {
  openIntervention,
  outreachSettingsSelect,
  pushSubscriptionOf,
  settingsOf,
} from "./outreach.js";
import { channels, raise, runsAwaitingApproval } from "./raise.js";

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

type Channel = (typeof channels)[number];
/** Long enough to reach a phone that was off overnight, never the library's four weeks. */
const pushTtlSeconds = 12 * 60 * 60;

/** The worker's side of Outreach: raises Interventions from their causes and sends what is due. */
export function createOutreachSender({
  db,
  clock,
  plan,
  facts,
  delegation,
  agents,
  mailer,
  pusher,
  inboxUrl,
}: {
  db: PrismaClient;
  clock: Clock;
  plan: Plan;
  facts: Facts;
  delegation: Delegation;
  agents: Agents;
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
    const pausedForArchivedCourse = (await agents.list(p))
      .filter((r) => r.pausedBy === "course_archived")
      .map((r) => r.id);
    const at = clock.now();
    await withOwner(db, p, async (tx, studentId) => {
      const live = await tx.intervention.findMany({
        where: { causeEndedAt: null },
        select: { id: true, dedupeKey: true, kind: true },
      });
      // Read after `live`, so a Run that ends meanwhile is either in both or its Intervention is in neither.
      const current = causesOf({
        shortfalls: proposal.shortfalls,
        review,
        actions: [...expired, ...unconfirmed],
        pausedForArchivedCourse,
        runsAwaitingApproval: await runsAwaitingApproval(tx, at),
      });
      const liveKeys = new Set(live.map((r) => r.dedupeKey));
      const currentKeys = new Set(current.map(keyOf));
      // A Run may raise the same cause meanwhile; only what is inserted here is announced.
      await raise(
        tx,
        studentId,
        current.filter((c) => !liveKeys.has(keyOf(c))),
        at,
      );
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

  /** Sends what is due on each channel; every message is content-free and points to the Inbox. */
  async function deliver(p: Principal, view: PlanView) {
    const at = clock.now();
    const { timeZone } = view.limits.preferences;
    const { minute } = wallClock(at, timeZone);
    const settings = settingsOf(
      await withOwner(db, p, (tx) =>
        tx.outreachSettings.findFirst({ select: outreachSettingsSelect }),
      ),
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
      // A Notice is announced only while unread; one deleted with its Agent is not announced either.
      const unread = new Set(
        (
          await tx.notice.findMany({
            where: {
              id: { in: queued.flatMap((d) => d.noticeId ?? []) },
              readAt: null,
            },
            select: { id: true },
          })
        ).map((n) => n.id),
      );
      const sentToday = await tx.delivery.findMany({
        where: {
          OR: [
            { interventionId: { not: null } },
            { noticeId: { not: null } },
            { briefingId: { not: null } },
          ],
          sentAt: { gte: startOfDay(at, timeZone) },
        },
        select: {
          interventionId: true,
          noticeId: true,
          briefingId: true,
          sentAt: true,
        },
        orderBy: { sentAt: "asc" },
      });
      // Only Agent Briefings (agentId non-null) are announced; retired nunio Briefings stay readable in the Inbox only.
      const briefingIds = [
        ...new Set([
          ...queued.flatMap((d) => d.briefingId ?? []),
          ...sentToday.flatMap((d) => d.briefingId ?? []),
        ]),
      ];
      const agentBriefings = new Set(
        (briefingIds.length
          ? await tx.briefing.findMany({
              where: { id: { in: briefingIds }, agentId: { not: null } },
              select: { id: true },
            })
          : []
        ).map((b) => b.id),
      );
      const { email, dailyLimit } = settings;
      /** What a message announces that counts against the daily limit: an Intervention, Notice or Agent Briefing. */
      const announced = (d: {
        interventionId: string | null;
        noticeId: string | null;
        briefingId: string | null;
      }) =>
        d.interventionId
          ? { batch: "intervention", id: d.interventionId }
          : d.noticeId
            ? { batch: "notice", id: d.noticeId }
            : d.briefingId && agentBriefings.has(d.briefingId)
              ? { batch: "briefing", id: d.briefingId }
              : null;
      // An Intervention, Notice or Agent Briefing counts with the first message that announced it, however often
      // another channel is retried; a tick's messages of one batch share one sentAt, so each counts once.
      const firstAnnounced = new Map<string, string>();
      for (const d of sentToday) {
        const item = announced(d);
        if (item && d.sentAt && !firstAnnounced.has(item.id))
          firstAnnounced.set(
            item.id,
            `${item.batch}:${d.sentAt.toISOString()}`,
          );
      }
      let announcedToday = new Set(firstAnnounced.values()).size;
      /** The batches that announce something new in this tick, each one more message toward the limit. */
      const opened = new Set<string>();
      const subscriptions = (await tx.pushSubscription.findMany()).map(
        pushSubscriptionOf,
      );
      const reasonOf = (d: (typeof queued)[number]) => {
        // A message about an Intervention that closed, a Notice read, or a deleted/retired Briefing no longer applies.
        if (d.interventionId && !open.has(d.interventionId)) return "closed";
        if (d.noticeId && !unread.has(d.noticeId)) return "closed";
        if (d.briefingId && !agentBriefings.has(d.briefingId)) return "closed";
        if (d.channel === "email" ? !email : !subscriptions.length)
          return "disabled";
        // Past the limit, a new Intervention, Notice or Agent Briefing stays in the Inbox instead.
        const item = announced(d);
        if (item && !firstAnnounced.has(item.id) && !opened.has(item.batch)) {
          if (announcedToday >= dailyLimit) return "limit";
          opened.add(item.batch);
          announcedToday += 1;
        }
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

  /** Sends one channel's due messages: Interventions, Notices, and Agent Briefings. */
  async function sendChannel(
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
        noticeId: string | null;
        briefingId: string | null;
      }[];
      to: string;
      subscriptions: ({ id: string } & StoredSubscription)[];
    },
  ) {
    const announcing = due.filter((d) => d.interventionId);
    const noticing = due.filter((d) => d.noticeId);
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
      // Neither the Agent's text nor its name: both may hold the student's content (ADR-0014).
      [
        noticing,
        {
          subject:
            noticing.length === 1
              ? "nunio: 1 neue Nachricht von einem Agenten"
              : `nunio: ${noticing.length} neue Nachrichten von Agenten`,
          text: `Lies sie in deiner Inbox:\n\n${inboxUrl}`,
        },
        "normal",
      ],
      // Agent Briefings follow Notice rules: content-free, no Agent name, no unsubscribe header (ADR-0014).
      [
        briefing,
        {
          subject:
            briefing.length === 1
              ? "nunio: 1 neues Briefing"
              : `nunio: ${briefing.length} neue Briefings`,
          text: `${briefing.length === 1 ? "Lies es" : "Lies sie"} in deiner Inbox:\n\n${inboxUrl}`,
        },
        "normal",
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
    /** Every five minutes: brings every active student's Interventions up to date with their causes and sends what is due. */
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
          await deliver(p, view);
        } catch (error) {
          console.error("Outreach tick failed for a student", error);
        }
      }
    },
  };
}

export type OutreachSender = ReturnType<typeof createOutreachSender>;
