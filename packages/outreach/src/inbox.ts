import type { PrismaClient } from "@nunio/db";
import type { Clock, Principal } from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";

export type InterventionView = {
  id: string;
  kind: "approval_expired" | "unconfirmed";
  actionId: string | null;
  raisedAt: Date;
  state: "open" | "acknowledged" | "dismissed";
  closedAt: Date | null;
};

export class NotOpenError extends Error {}
export class UnknownInterventionError extends Error {}

/** The Inbox and how the student closes what is in it. */
export function createOutreach({
  db,
  clock,
}: {
  db: PrismaClient;
  clock: Clock;
}) {
  return {
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
          actionId: r.actionId,
          raisedAt: r.createdAt,
          state: r.acknowledgedAt
            ? "acknowledged"
            : r.dismissedAt
              ? "dismissed"
              : "open",
          closedAt: r.acknowledgedAt ?? r.dismissedAt,
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
