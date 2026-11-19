import type { PrismaClient } from "@nunio/db";
import type {
  BrokenPreference,
  Principal,
  Refusal,
  Transaction,
} from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import { createDerivedText } from "@nunio/knowledge";

/** What one model step read: the Plan, the Facts of these Courses, and these Sources. */
export type ReadEvent = {
  step: number;
  plan: boolean;
  courseIds: string[];
  sourceIds: string[];
};

/**
 * What became of one Action call: the gate's outcome for the Action it asked for, or a refusal without one when the call
 * named nothing the Run had read (`invalid`). A Preference it broke under Immer erlaubt is noted.
 */
export type ActionEvent = {
  step: number;
  call: number;
  /** The Capability whose tool the model called. */
  capability: string;
  /** Null when no Action was asked. */
  actionId: string | null;
  outcome: "done" | "awaiting_approval" | "refused" | "failed" | "unconfirmed";
  refusal: Refusal | "invalid" | null;
  brokenPreferences: BrokenPreference[];
};

/** Adds Activity events to a Run's Verlauf; one already written under its key stays as it was. */
export async function recordEvents(
  tx: Transaction,
  run: { runId: string; studentId: string },
  events: (
    | { key: string; type: "read"; detail: ReadEvent }
    | { key: string; type: "action"; detail: ActionEvent }
  )[],
) {
  if (!events.length) return;
  await tx.runEvent.createMany({
    data: events.map((event) => ({
      ...run,
      key: event.key,
      type: event.type,
      detail: event.detail as object,
    })),
    skipDuplicates: true,
  });
}

/** A Run in an Agent's list: its status, how it started and ended, and how many of its Approvals are still open. */
export type ActivityRun = {
  id: string;
  status: "running" | "done" | "stopped" | "failed";
  trigger: "schedule" | "manual";
  startedAt: Date;
  endedAt: Date | null;
  stopReason: string | null;
  /** Its Approvals still open and unexpired, which make it "Freigabe benötigt". */
  openApprovals: number;
};

/** One entry of a Run's Verlauf, with the Courses and Sources it names looked up now: null once deleted. */
export type VerlaufEntry =
  | { type: "start"; at: Date; trigger: ActivityRun["trigger"] }
  | {
      type: "read";
      at: Date;
      step: number;
      plan: boolean;
      courses: { id: string; title: string | null }[];
      sources: { id: string; title: string | null }[];
    }
  | {
      type: "action";
      at: Date;
      step: number;
      capability: string;
      /** The Action as the gate recorded it; null when none was asked. */
      action: { kind: string; args: unknown } | null;
      outcome: ActionEvent["outcome"];
      refusal: ActionEvent["refusal"];
      brokenPreferences: BrokenPreference[];
    }
  | {
      type: "end";
      at: Date;
      status: Exclude<ActivityRun["status"], "running">;
      reason: string | null;
    };

export type ActivityCursor = { startedAt: Date; id: string };

/**
 * An Agent's Activity as the student reads it (#149): its Runs newest first, and each Run's cost, summary and Verlauf.
 * The Verlauf is built from structured events and the Run's own record, never from what the model wrote.
 */
export function createActivity({
  db,
  keys,
  clock,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  clock: { now(): Date };
}) {
  const derived = createDerivedText(keys);
  const openApprovals = async (tx: Transaction, runIds: string[]) => {
    const open = await tx.approval.findMany({
      where: {
        decision: null,
        expiresAt: { gt: clock.now() },
        action: { runId: { in: runIds }, status: "awaiting_approval" },
      },
      select: { action: { select: { runId: true } } },
    });
    return (runId: string) =>
      open.filter(({ action }) => action.runId === runId).length;
  };
  const shown = (
    run: {
      id: string;
      status: string | null;
      trigger: string | null;
      startedAt: Date;
      endedAt: Date | null;
      stopReason: string | null;
    },
    open: (runId: string) => number,
  ): ActivityRun => ({
    id: run.id,
    status: run.status as ActivityRun["status"],
    trigger: run.trigger as ActivityRun["trigger"],
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    stopReason: run.stopReason,
    openApprovals: open(run.id),
  });
  return {
    /** The Agent's Runs, newest first, `limit` at a time; null when the Agent is not the student's. */
    async runs(
      p: Principal,
      agentId: string,
      page: { limit: number; cursor?: ActivityCursor },
    ) {
      const after = page.cursor;
      return withOwner(db, p, async (tx) => {
        if (!(await tx.agent.findUnique({ where: { id: agentId } })))
          return null;
        const runs = await tx.run.findMany({
          // A preset's Runs record no status; they are not part of Activity.
          where: {
            agentId,
            status: { not: null },
            ...(after && {
              OR: [
                { startedAt: { lt: after.startedAt } },
                { startedAt: after.startedAt, id: { lt: after.id } },
              ],
            }),
          },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: page.limit + 1,
        });
        const listed = runs.slice(0, page.limit);
        const open = await openApprovals(
          tx,
          listed.map((run) => run.id),
        );
        const last = listed.at(-1);
        return {
          runs: listed.map((run) => shown(run, open)),
          nextCursor:
            runs.length > page.limit && last
              ? { startedAt: last.startedAt, id: last.id }
              : null,
        };
      });
    },

    /**
     * One of the Agent's Runs: its cost (settled usage plus what its calls in flight hold) against the Agent's Budget,
     * its summary, null once a Source it was drawn from is deleted, and its Verlauf. Null when it is not the student's.
     */
    async run(p: Principal, agentId: string, runId: string) {
      return withOwner(db, p, async (tx) => {
        const run = await tx.run.findUnique({
          where: { id: runId },
          include: {
            agent: { select: { budgetMicroUsd: true } },
            events: { orderBy: { id: "asc" } },
          },
        });
        if (!run?.status || run.agentId !== agentId || !run.agent) return null;
        const reservations = await tx.usageReservation.findMany({
          where: { runId },
          select: {
            status: true,
            estimateMicroUsd: true,
            actualMicroUsd: true,
          },
        });
        const cost = reservations.reduce(
          (sum, r) =>
            sum +
            (r.status === "settled"
              ? (r.actualMicroUsd ?? 0n)
              : r.status === "released"
                ? 0n
                : r.estimateMicroUsd),
          0n,
        );
        const summary = run.summaryContent
          ? await derived.open(tx, `${runId}:summary`, {
              content: run.summaryContent,
              contentKey: run.summaryKey,
              derivedFrom: run.derivedFrom,
            })
          : null;
        const reads = run.events
          .filter((event) => event.type === "read")
          .map((event) => event.detail as ReadEvent);
        const calls = run.events
          .filter((event) => event.type === "action")
          .map((event) => event.detail as ActionEvent);
        const [courses, sources, actions] = await Promise.all([
          tx.course.findMany({
            where: { id: { in: reads.flatMap((read) => read.courseIds) } },
            select: { id: true, title: true },
          }),
          tx.source.findMany({
            where: {
              id: { in: reads.flatMap((read) => read.sourceIds) },
              deletedAt: null,
            },
            select: { id: true, title: true },
          }),
          tx.action.findMany({
            where: {
              id: {
                in: calls.flatMap((call) =>
                  call.actionId ? [call.actionId] : [],
                ),
              },
            },
            select: { id: true, kind: true, args: true },
          }),
        ]);
        const titled = (ids: string[], rows: { id: string; title: string }[]) =>
          ids.map((id) => ({
            id,
            title: rows.find((row) => row.id === id)?.title ?? null,
          }));
        const verlauf: VerlaufEntry[] = [
          {
            type: "start",
            at: run.startedAt,
            trigger: run.trigger as ActivityRun["trigger"],
          },
          ...run.events.map((event): VerlaufEntry => {
            if (event.type === "read") {
              const read = event.detail as ReadEvent;
              return {
                type: "read",
                at: event.at,
                step: read.step,
                plan: read.plan,
                courses: titled(read.courseIds, courses),
                sources: titled(read.sourceIds, sources),
              };
            }
            const call = event.detail as ActionEvent;
            const action = actions.find((a) => a.id === call.actionId);
            return {
              type: "action",
              at: event.at,
              step: call.step,
              capability: call.capability,
              action: action ? { kind: action.kind, args: action.args } : null,
              outcome: call.outcome,
              refusal: call.refusal,
              brokenPreferences: call.brokenPreferences,
            };
          }),
          ...(run.status !== "running" && run.endedAt
            ? [
                {
                  type: "end" as const,
                  at: run.endedAt,
                  status: run.status as Exclude<
                    ActivityRun["status"],
                    "running"
                  >,
                  reason: run.stopReason,
                },
              ]
            : []),
        ];
        return {
          ...shown(run, await openApprovals(tx, [runId])),
          costMicroUsd: Number(cost),
          budgetMicroUsd: Number(run.agent.budgetMicroUsd),
          summary,
          verlauf,
        };
      });
    },
  };
}
export type Activity = ReturnType<typeof createActivity>;
