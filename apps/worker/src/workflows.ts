// Spike d workflows. Workflow code is deterministic: no I/O here, only Activities (durable-ai.md).
import { condition, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";
import type { Activities } from "./activities.js";

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
