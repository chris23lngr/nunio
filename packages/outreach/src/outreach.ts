import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { Clock, Delegation, Principal } from "@nunio/delegation";
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

export class NotOpenError extends Error {}
export class UnknownInterventionError extends Error {}

/** Interventions raised from their causes, the Inbox, and how the student closes what is in it. */
export function createOutreach({
  db,
  clock,
  plan,
  facts,
  delegation,
}: {
  db: PrismaClient;
  clock: Clock;
  plan: Plan;
  facts: Facts;
  delegation: Delegation;
}) {
  /** Raises an Intervention for each new cause, and ends the causes that no longer hold. */
  async function sync(p: Principal) {
    const [{ proposal }, review, expired, unconfirmed] = await Promise.all([
      plan.view(p),
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

  return {
    /** Worker only: brings every active student's Interventions up to date with their causes. */
    async tick(): Promise<void> {
      const students = await db.$queryRaw<
        { studentId: string }[]
      >`SELECT "studentId" FROM outreach_students()`;
      for (const { studentId } of students)
        await sync(principal.fromSession({ studentId }));
    },
    async inbox(
      student: Principal,
    ): Promise<{ interventions: InterventionView[] }> {
      const rows = await withOwner(db, student, (tx) =>
        tx.intervention.findMany({ orderBy: { createdAt: "desc" } }),
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
      };
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
