import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { Clock, Principal, Transaction } from "@nunio/delegation";
import { openApprovalAt, principal, withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import { createDerivedText } from "@nunio/knowledge";
import type { Kind, Subject } from "./causes.js";
import { causeOf } from "./causes.js";
import { noticeTextId } from "./notices.js";

export type InterventionView = {
  id: string;
  kind: Kind;
  subject: Subject;
  raisedAt: Date;
  state: "open" | "acknowledged" | "dismissed" | "lapsed";
  closedAt: Date | null;
  /** The Agent Run it is about, as it is now: its Agent and how many of its Approvals are open; null once deleted. */
  run: { agentId: string; agentName: string; openApprovals: number } | null;
};

/**
 * A Notice as the student reads it: "Nachricht von <Agent>" with the Agent's plain text, null once a Source the Run
 * had read is deleted. Its announcement is pending while a message about it may still go out, announced once one
 * did, and inbox_only when none will, such as when it was read first or the daily limit was reached.
 */
export type NoticeView = {
  id: string;
  agentId: string;
  agentName: string;
  runId: string;
  text: string | null;
  sentAt: Date;
  readAt: Date | null;
  announcement: "pending" | "announced" | "inbox_only";
};

/** What a Briefing bundled when it was made; it is never edited afterwards. */
export type BriefingView = {
  id: string;
  madeAt: Date;
  interventions: string[];
  approvals: string[];
  agents: string[];
};

export type OutreachSettings = {
  /** Minutes after local midnight in the Plan's time zone; null turns Briefings off. */
  briefingAtMinute: number | null;
  /** Whether nunio emails the student; the Inbox has everything either way. */
  email: boolean;
  /** Whether Briefings are emailed too; a one-click unsubscribe turns this off. */
  briefingEmail: boolean;
  /** When nothing goes out outside the app, in the Plan's time zone; may wrap midnight. */
  quietHours: { fromMinute: number; toMinute: number } | null;
  /** Announcements of Interventions and Notices per local day, email and push combined; Briefings do not count. */
  dailyLimit: number;
};

/** What a Briefing stores as its items. */
export type BriefingItems = Omit<BriefingView, "id" | "madeAt">;

const defaults: OutreachSettings = {
  briefingAtMinute: 7 * 60,
  email: true,
  briefingEmail: true,
  quietHours: null,
  dailyLimit: 3,
};
/** Quiet Hours are stored as two columns, both set or both null. */
const quietHoursOf = (columns: {
  quietFromMinute: number | null;
  quietToMinute: number | null;
}): OutreachSettings["quietHours"] =>
  columns.quietFromMinute === null || columns.quietToMinute === null
    ? null
    : { fromMinute: columns.quietFromMinute, toMinute: columns.quietToMinute };
const quietHoursColumns = (quietHours: OutreachSettings["quietHours"]) => ({
  quietFromMinute: quietHours?.fromMinute ?? null,
  quietToMinute: quietHours?.toMinute ?? null,
});

export const settingsOf = (
  stored: {
    briefingAtMinute: number | null;
    email: boolean;
    briefingEmail: boolean;
    quietFromMinute: number | null;
    quietToMinute: number | null;
    dailyLimit: number;
  } | null,
): OutreachSettings =>
  stored
    ? {
        briefingAtMinute: stored.briefingAtMinute,
        email: stored.email,
        briefingEmail: stored.briefingEmail,
        quietHours: quietHoursOf(stored),
        dailyLimit: stored.dailyLimit,
      }
    : defaults;

/** A device's subscription as the browser's PushSubscription.toJSON() gives it. */
export type PushSubscriptionJson = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
};

/** A device's subscription as the Pusher sends to it. */
export type StoredSubscription = Pick<
  PushSubscriptionJson,
  "endpoint" | "keys"
>;

/** A push subscription's row, and back; the keys are stored as their own columns. */
const pushSubscriptionColumns = (subscription: PushSubscriptionJson) => ({
  endpoint: subscription.endpoint,
  p256dh: subscription.keys.p256dh,
  auth: subscription.keys.auth,
  expirationTime:
    subscription.expirationTime === null
      ? null
      : new Date(subscription.expirationTime),
});
export const pushSubscriptionOf = (row: {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): { id: string } & StoredSubscription => ({
  id: row.id,
  endpoint: row.endpoint,
  keys: { p256dh: row.p256dh, auth: row.auth },
});

/** An Intervention nobody has closed: not acknowledged, not dismissed, and its cause still holds. */
export const openIntervention = {
  acknowledgedAt: null,
  dismissedAt: null,
  causeEndedAt: null,
} as const;

/** The token in the one-click link that stops a student's Briefing emails. */
export const unsubscribeToken = (secret: string, studentId: string) =>
  createHmac("sha256", secret).update(studentId).digest("hex");

export class NotOpenError extends Error {
  override name = "NotOpenError";
}
export class InvalidUnsubscribeError extends Error {
  override name = "InvalidUnsubscribeError";
}
export class UnknownInterventionError extends Error {
  override name = "UnknownInterventionError";
}
export class UnknownNoticeError extends Error {
  override name = "UnknownNoticeError";
}

/** The Inbox, Outreach settings and push subscriptions: what the API reads and changes for a student. */
export function createOutreach({
  db,
  keys,
  clock,
  vapidPublicKey,
  unsubscribeSecret,
}: {
  db: PrismaClient;
  /** Opens a Notice's text, sealed under the Sources its Run had read. */
  keys: SourceKeys;
  clock: Clock;
  /** The public key the browser subscribes with; the worker signs pushes with its private half. */
  vapidPublicKey: string;
  /** Verifies the one-click link that stops Briefing emails; the worker signs it with the same secret. */
  unsubscribeSecret: string;
}) {
  const derived = createDerivedText(keys);
  /** The student's Notices, newest first, with their Agent and how they were announced. */
  async function noticesOf(tx: Transaction): Promise<NoticeView[]> {
    const rows = await tx.notice.findMany({
      orderBy: { createdAt: "desc" },
      include: { agent: { select: { name: true } } },
    });
    const deliveries = await tx.delivery.findMany({
      where: { noticeId: { in: rows.map((r) => r.id) } },
      select: { noticeId: true, sentAt: true, droppedAt: true },
    });
    return Promise.all(
      rows.map(async (row): Promise<NoticeView> => {
        const of = deliveries.filter((d) => d.noticeId === row.id);
        return {
          id: row.id,
          agentId: row.agentId,
          agentName: row.agent.name,
          runId: row.runId,
          text: await derived.open(tx, noticeTextId(row.runId), {
            content: row.textContent,
            contentKey: row.textKey,
            derivedFrom: row.derivedFrom,
          }),
          sentAt: row.createdAt,
          readAt: row.readAt,
          announcement: of.some((d) => d.sentAt)
            ? "announced"
            : !row.readAt && of.some((d) => !d.droppedAt)
              ? "pending"
              : "inbox_only",
        };
      }),
    );
  }
  return {
    async inbox(student: Principal): Promise<{
      interventions: InterventionView[];
      notices: NoticeView[];
      briefings: BriefingView[];
    }> {
      const at = clock.now();
      const [rows, briefings, runs, notices] = await withOwner(
        db,
        student,
        async (tx) => {
          const aboutRuns = (
            await tx.intervention.findMany({
              where: { kind: "run_approvals" },
              select: { id: true, dedupeKey: true, causeEndedAt: true },
            })
          ).map((r) => ({ ...r, runId: causeOf(r.dedupeKey).subject.id }));
          const runs = await tx.run.findMany({
            where: { id: { in: aboutRuns.map((r) => r.runId) } },
            select: {
              id: true,
              agent: { select: { id: true, name: true } },
              actions: { where: openApprovalAt(at), select: { id: true } },
            },
          });
          // A Run's Intervention lapses lazily, once none of its Approvals is open; no timer marks it (ADR-0006).
          const lapsed = aboutRuns.filter(
            (r) =>
              !r.causeEndedAt &&
              !runs.some((run) => run.id === r.runId && run.actions.length),
          );
          if (lapsed.length)
            await tx.intervention.updateMany({
              where: { id: { in: lapsed.map((r) => r.id) } },
              data: { causeEndedAt: at },
            });
          return Promise.all([
            tx.intervention.findMany({ orderBy: { createdAt: "desc" } }),
            tx.briefing.findMany({ orderBy: { createdAt: "desc" }, take: 7 }),
            runs,
            noticesOf(tx),
          ]);
        },
      );
      const runOf = (subject: Subject): InterventionView["run"] => {
        const run =
          subject.kind === "run"
            ? runs.find((r) => r.id === subject.id)
            : undefined;
        return run?.agent
          ? {
              agentId: run.agent.id,
              agentName: run.agent.name,
              openApprovals: run.actions.length,
            }
          : null;
      };
      const views = rows.map((r): InterventionView => {
        const cause = causeOf(r.dedupeKey);
        return {
          id: r.id,
          ...cause,
          run: runOf(cause.subject),
          raisedAt: r.createdAt,
          state: r.acknowledgedAt
            ? "acknowledged"
            : r.dismissedAt
              ? "dismissed"
              : r.causeEndedAt
                ? "lapsed"
                : "open",
          closedAt: r.acknowledgedAt ?? r.dismissedAt ?? r.causeEndedAt,
        };
      });
      return {
        interventions: [
          ...views.filter((v) => v.state === "open"),
          ...views.filter((v) => v.state !== "open"),
        ],
        notices,
        briefings: briefings.map((b) => ({
          id: b.id,
          madeAt: b.createdAt,
          ...(b.items as BriefingItems),
        })),
      };
    },
    /** The public VAPID key a browser subscribes with. */
    pushKey: vapidPublicKey,
    /** Opts one device in to push; subscribing the same device again changes nothing. */
    async subscribe(student: Principal, subscription: PushSubscriptionJson) {
      await withOwner(db, student, (tx, studentId) =>
        tx.pushSubscription.createMany({
          data: [
            {
              id: randomUUID(),
              studentId,
              ...pushSubscriptionColumns(subscription),
              vapidKeyId: vapidPublicKey,
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
        ...(quietHours !== undefined && quietHoursColumns(quietHours)),
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
    /** The one-click unsubscribe: stops Briefing emails for the student the link was signed for. */
    async stopBriefingEmail(studentId: string, token: string): Promise<void> {
      const expected = Buffer.from(
        unsubscribeToken(unsubscribeSecret, studentId),
      );
      const given = Buffer.from(token);
      if (expected.length !== given.length || !timingSafeEqual(expected, given))
        throw new InvalidUnsubscribeError();
      await withOwner(db, principal.fromSession({ studentId }), (tx, owner) =>
        tx.outreachSettings.upsert({
          where: { studentId: owner },
          create: { studentId: owner, briefingEmail: false },
          update: { briefingEmail: false },
        }),
      );
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
            ...openIntervention,
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
    /** The student opened a Notice; it stays read, and a message about it not yet sent no longer goes out. */
    async readNotice(student: Principal, noticeId: string): Promise<void> {
      const at = clock.now();
      await withOwner(db, student, async (tx) => {
        // Row-level security hides another student's Notice, so it reads as unknown.
        if (!(await tx.notice.count({ where: { id: noticeId } })))
          throw new UnknownNoticeError(noticeId);
        await tx.notice.updateMany({
          where: { id: noticeId, readAt: null },
          data: { readAt: at },
        });
      });
    },
  };
}

export type Outreach = ReturnType<typeof createOutreach>;
