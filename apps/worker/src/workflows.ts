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
