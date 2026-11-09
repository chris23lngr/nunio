// Source ingestion and deletion workflows, plus the spike d checks. Workflow code is deterministic:
// no I/O here, only Activities (durable-ai.md).
import {
  condition,
  defineSignal,
  patched,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import type { Activities } from "./activities.js";
import type { RunActivities, RunRef } from "./run-activities.js";
import type { SourceActivities, SourceRef } from "./source-activities.js";

const { hold, checkParser: parserHealth } = proxyActivities<Activities>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 3 },
});

/** The student's decision on the one exact Action the Run asked about. */
export const approvalSignal = defineSignal<[decision: string]>("approval");

/** Waits durably, across worker restarts and deploys, until the Approval signal arrives. */
export async function awaitApproval(): Promise<string> {
  let decision: string | undefined;
  setHandler(approvalSignal, (value) => {
    decision = value;
  });
  await condition(() => decision !== undefined);
  return decision!;
}

/** Runs one Activity for `ms`; used to observe draining on shutdown. */
export async function holdActivity(ms: number): Promise<number> {
  return hold(ms);
}

/** Asks the parser for its health through an Activity (spike g). */
export async function checkParser(): Promise<{ status: string }> {
  return parserHealth();
}

// Ingestion is not retried wholesale: a crashed model call may already have incurred usage.
// A founder investigates failed/interrupted ingestions and held reservations until Phase 9 reconciliation.
const { processSource } = proxyActivities<SourceActivities>({
  startToCloseTimeout: "15 minutes",
  heartbeatTimeout: "30 seconds",
  retry: { maximumAttempts: 1 },
});
const { purgeSource } = proxyActivities<SourceActivities>({
  startToCloseTimeout: "2 minutes",
  retry: { initialInterval: "5 seconds", maximumInterval: "5 minutes" },
});
// Extraction may also incur model usage, so it gets the same single attempt; the student re-extracts.
const { extractFacts } = proxyActivities<SourceActivities>({
  startToCloseTimeout: "15 minutes",
  heartbeatTimeout: "30 seconds",
  retry: { maximumAttempts: 1 },
});
export async function ingestSource(input: SourceRef) {
  const ingestion = await processSource(input);
  if (!patched("extract-after-ingest") || ingestion.status !== "ready")
    return ingestion;
  return { ...ingestion, extraction: await extractFacts(input) };
}
/** "Read again": extraction alone, started by the student and metered again. */
export async function extractSource(input: SourceRef) {
  return extractFacts(input);
}
export async function deleteSource(
  input: SourceRef & { cleanupAfter: string },
) {
  await purgeSource({ studentId: input.studentId, sourceId: input.sourceId });
  const delay = new Date(input.cleanupAfter).getTime() - Date.now();
  if (delay > 0) await sleep(delay);
  await purgeSource({ studentId: input.studentId, sourceId: input.sourceId });
}

// A Responsibility's Run (ADR-0006): one bounded workflow, started by its Schedule. Domain outcomes come back as values
// from the gate, so a refused Action is never retried; a thrown Activity error is infrastructure, safe to retry by key.
const {
  startRun,
  proposeActions,
  performAction,
  raiseIntervention,
  reconcileActions: reconcile,
} = proxyActivities<RunActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 10,
    nonRetryableErrorTypes: ["InvalidIntentError", "KeyConflictError"],
  },
});
/**
 * Wakes a Run once the student decided on one of its Actions. It carries no authority: the decision is recorded through
 * the gate's `decide`, and the Run only asks the gate again.
 */
export const approvalDecidedSignal =
  defineSignal<[actionId: string]>("approvalDecided");

export async function responsibilityRun(ref: RunRef) {
  const runId = await startRun(ref);
  if (!runId) return { status: "skipped" as const };
  const consumeWakes = patched("consume-approval-wakes");
  const wakes = new Map<string, number>();
  setHandler(approvalDecidedSignal, (actionId) => {
    wakes.set(actionId, (wakes.get(actionId) ?? 0) + 1);
  });
  const intents = await proposeActions(runId);
  for (const [i, intent] of intents.entries()) {
    const step = { runId, key: `${runId}:${i + 1}`, intent };
    let outcome = await performAction(step);
    while (outcome.status === "awaiting_approval") {
      const { actionId } = outcome;
      const seen = consumeWakes ? 0 : (wakes.get(actionId) ?? 0);
      // Waits for a decision or until the request expires, whichever comes first; the gate then decides again.
      await condition(
        () => (wakes.get(actionId) ?? 0) > seen,
        Math.max(new Date(outcome.expiresAt).getTime() - Date.now(), 1),
      );
      if (consumeWakes) wakes.delete(actionId);
      outcome = await performAction(step);
    }
    if (outcome.status === "refused" && outcome.reason === "approval_expired") {
      await raiseIntervention({
        runId,
        actionId: outcome.actionId,
        kind: "approval_expired",
      });
    }
    // Only the student resolves an Unconfirmed Action; the Run neither retries it nor acts on top of it.
    if (outcome.status === "unconfirmed") {
      await raiseIntervention({
        runId,
        actionId: outcome.actionId,
        kind: "unconfirmed",
      });
      return { status: "stopped" as const, reason: "unconfirmed" as const };
    }
    // A Paused or Ended Responsibility takes no further Action, including in this Run.
    if (
      outcome.status === "refused" &&
      (outcome.reason === "paused" || outcome.reason === "ended")
    ) {
      return { status: "stopped" as const, reason: outcome.reason };
    }
  }
  return { status: "done" as const };
}

/** Started by the reconcile Schedule: asks executors about stale in-flight dispatches, never retrying blindly. */
export async function reconcileActions() {
  return reconcile();
}

// The next tick retries whatever this one could not finish.
const { tickOutreach } = proxyActivities<{ tickOutreach(): Promise<void> }>({
  startToCloseTimeout: "4 minutes",
  retry: { maximumAttempts: 1 },
});

/** Started by the outreach Schedule: brings every student's Interventions up to date with their causes. */
export async function outreachTick() {
  await tickOutreach();
}
