import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { Clock, Principal } from "@nunio/delegation";
import { principal, withOwner } from "@nunio/delegation";
import type { Kind, Subject } from "./causes.js";
import { causeOf } from "./causes.js";

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
  /** Whether Briefings are emailed too; a one-click unsubscribe turns this off. */
  briefingEmail: boolean;
  /** When nothing goes out outside the app, in the Plan's time zone; may wrap midnight. */
  quietHours: { fromMinute: number; toMinute: number } | null;
  /** Announcements of Interventions per local day, email and push combined; Briefings do not count. */
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

/** The Inbox, Outreach settings and push subscriptions: what the API reads and changes for a student. */
export function createOutreach({
  db,
  clock,
  vapidPublicKey,
  unsubscribeSecret,
}: {
  db: PrismaClient;
  clock: Clock;
  /** The public key the browser subscribes with; the worker signs pushes with its private half. */
  vapidPublicKey: string;
  /** Verifies the one-click link that stops Briefing emails; the worker signs it with the same secret. */
  unsubscribeSecret: string;
}) {
  return {
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
          ...causeOf(r.dedupeKey),
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
  };
}

export type Outreach = ReturnType<typeof createOutreach>;
