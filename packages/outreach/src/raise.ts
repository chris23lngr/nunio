import { randomUUID } from "node:crypto";
import type { Transaction } from "@nunio/delegation";
import type { Cause } from "./causes.js";
import { keyOf } from "./causes.js";

export const channels = ["email", "push"] as const;

/**
 * Raises an Intervention for each cause with none open, and queues one message per channel announcing each it raised;
 * the outreach tick sends them outside Quiet Hours and within the daily limit. A cause raised meanwhile by someone else
 * is left to them, so only what was inserted here is announced.
 */
export async function raise(
  tx: Transaction,
  studentId: string,
  causes: readonly Cause[],
  at: Date,
) {
  if (!causes.length) return;
  const inserted = await tx.intervention.createManyAndReturn({
    data: causes.map((c) => ({
      id: randomUUID(),
      studentId,
      kind: c.kind,
      dedupeKey: keyOf(c),
      actionId: c.subject.kind === "action" ? c.subject.id : null,
      createdAt: at,
    })),
    skipDuplicates: true,
    select: { id: true },
  });
  await tx.delivery.createMany({
    data: channels.flatMap((channel) =>
      inserted.map((i) => ({
        id: randomUUID(),
        studentId,
        channel,
        interventionId: i.id,
        dueAt: at,
      })),
    ),
  });
}

/** An Action whose Approval is still open at `at`: unanswered, not withdrawn and not yet expired, which no timer marks. */
export const openApprovalAt = (at: Date) => ({
  status: "awaiting_approval" as const,
  approval: { is: { decision: null, expiresAt: { gt: at } } },
});

/**
 * Those of the student's Agent Runs, all or only `runIds`, that have ended with an Approval still open: unanswered,
 * not withdrawn and not yet expired, which no timer marks (ADR-0006).
 */
export async function runsAwaitingApproval(
  tx: Transaction,
  at: Date,
  runIds?: readonly string[],
): Promise<string[]> {
  const runs = await tx.run.findMany({
    where: {
      ...(runIds && { id: { in: [...runIds] } }),
      status: { in: ["done", "stopped", "failed"] },
      actions: { some: openApprovalAt(at) },
    },
    select: { id: true },
  });
  return runs.map((r) => r.id);
}

/** Raises the Intervention for an Agent's Run that has just ended, if it left Approvals open; safe to repeat. */
export async function raiseForEndedRun(
  tx: Transaction,
  { runId, studentId }: { runId: string; studentId: string },
  at: Date,
) {
  if ((await runsAwaitingApproval(tx, at, [runId])).length)
    await raise(
      tx,
      studentId,
      [{ kind: "run_approvals", subject: { kind: "run", id: runId } }],
      at,
    );
}
