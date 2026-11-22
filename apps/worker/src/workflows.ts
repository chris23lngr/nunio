// Source ingestion and deletion workflows, plus the spike d checks. Workflow code is deterministic:
// no I/O here, only Activities (durable-ai.md).

import type { RunEnd } from "@nunio/chat";
import {
  CancellationScope,
  condition,
  defineSignal,
  isCancellation,
  patched,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import type { Activities } from "./activities.js";
import type {
  AgentRunActivities,
  AgentRunRef,
} from "./agent-run-activities.js";
import type { RunActivities } from "./run-activities.js";
import type {
  CourseRef,
  SourceActivities,
  SourceRef,
} from "./source-activities.js";

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
// 30 minutes fits a 100-page deck whose every page needs both retries (~20 min of page readings, four at a
// time, plus parsing and embedding); heartbeats still catch a lost worker within 30 seconds.
const { processSource } = proxyActivities<SourceActivities>({
  startToCloseTimeout: "30 minutes",
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
// Grouping is metered too (ADR-0024). It never fails the Source: a failed pass leaves the Topics where they
// were, and the next extraction or merge tries again.
const { groupSourceTopics, groupCourseTopics } =
  proxyActivities<SourceActivities>({
    startToCloseTimeout: "5 minutes",
    retry: { maximumAttempts: 1 },
  });
async function extractAndGroup(input: SourceRef) {
  const extraction = await extractFacts(input);
  if (patched("group-after-extract") && extraction.status === "done")
    await groupSourceTopics(input).catch(() => undefined);
  return extraction;
}
export async function ingestSource(input: SourceRef) {
  const ingestion = await processSource(input);
  if (!patched("extract-after-ingest") || ingestion.status !== "ready")
    return ingestion;
  return { ...ingestion, extraction: await extractAndGroup(input) };
}
/** "Read again": extraction alone, started by the student and metered again. */
export async function extractSource(input: SourceRef) {
  return extractAndGroup(input);
}
/** After Courses merge, the target's Topics without an Area are placed. */
export async function groupCourse(input: CourseRef) {
  return groupCourseTopics(input);
}
export async function deleteSource(
  input: SourceRef & { cleanupAfter: string },
) {
  await purgeSource({ studentId: input.studentId, sourceId: input.sourceId });
  const delay = new Date(input.cleanupAfter).getTime() - Date.now();
  if (delay > 0) await sleep(delay);
  await purgeSource({ studentId: input.studentId, sourceId: input.sourceId });
}

// Recovers dispatches a dead API or worker left in flight; a thrown Activity error is infrastructure, safe to retry.
const { reconcileActions: reconcile } = proxyActivities<RunActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 10,
  },
});

// An Agent's Run (ADR-0006, #141): one bounded workflow, one Activity per model step. Messages and material
// never cross into workflow history; the steps are persisted in Postgres. Starting and ending are safe to retry.
const { startAgentRun, finishAgentRun } = proxyActivities<AgentRunActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 10,
  },
});
// A step is paid, but claimed per (runId, n) before its model call: a retry calls the model again only after an
// attempt whose call certainly cost nothing, never after one whose call may have been sent.
const { agentStep } = proxyActivities<AgentRunActivities>({
  startToCloseTimeout: "5 minutes",
  retry: { initialInterval: "5 seconds", maximumAttempts: 3 },
});
// A step's Actions go through the gate under `runId:step:call`, so a retry returns what it recorded and never acts twice.
const { agentActions } = proxyActivities<AgentRunActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    initialInterval: "5 seconds",
    maximumInterval: "1 minute",
    maximumAttempts: 10,
    nonRetryableErrorTypes: ["InvalidIntentError", "KeyConflictError"],
  },
});

/**
 * Stops an Agent's Run at once, as the student Paused or Ended its Agent: the step or Actions under way are abandoned
 * and the Run ends stopped with why. It carries no authority; the database already refuses the next step and Action.
 */
export const stopAgentRunSignal =
  defineSignal<[reason: "paused" | "ended"]>("stopAgentRun");

/**
 * Runs the Agent's model step by step until it answers, performing each step's Action calls through the gate before the
 * next; the step cap lives with the steps, whose last must answer.
 * A refused step, such as a Paused Agent or an exhausted Budget, stops the Run; a failed one, or an error after its
 * retries, fails it. Told to stop, it abandons the step or Actions under way and stops. However it ends, cancelled
 * included, the Run is ended, so it never stays under way.
 */
export async function agentRun(ref: AgentRunRef) {
  // The Run startAgentRun records or takes up, known even if starting fails.
  const run = {
    runId: ref.runId ?? workflowInfo().runId,
    studentId: ref.studentId,
  };
  const finish = (end: RunEnd) =>
    CancellationScope.nonCancellable(() => finishAgentRun({ run, end }));
  // The steps and Actions run in this scope, which the stop signal cancels; a Run begun before it existed ignores it.
  const work = new CancellationScope();
  let stop: "paused" | "ended" | undefined;
  if (patched("agent-run-stop-signal"))
    setHandler(stopAgentRunSignal, (reason) => {
      stop ??= reason;
      work.cancel();
    });
  let end: RunEnd = { status: "done" };
  try {
    // Not cancellable: a Run its Schedule starts is recorded only here, and a cancel that did not wait for it would end
    // the workflow before the Run exists, leaving it running. Once recorded, the next step sees the cancel.
    const runId = patched("agent-run-start-uncancellable")
      ? await CancellationScope.nonCancellable(() => startAgentRun(ref))
      : await startAgentRun(ref);
    if (!runId) return { status: "skipped" as const };
    for (let n = 1; ; n++) {
      const step = await work.run(() => agentStep({ runId, n }));
      if (step.status === "answered") break;
      // Performed after the step, without waiting for any Approval; the next step tells the model what became of them.
      if (
        step.status === "continue" &&
        step.actions > 0 &&
        patched("agent-run-actions")
      ) {
        const acted = await work.run(() => agentActions({ runId, n }));
        // Only the student resolves an Unconfirmed Action; the Run acts on nothing after it.
        if (acted.unconfirmed) {
          end = { status: "stopped", reason: "unconfirmed" };
          break;
        }
      }
      if (step.status === "refused") {
        end = { status: "stopped", reason: step.reason };
        break;
      }
      if (step.status === "failed") {
        end = { status: "failed", reason: step.reason };
        break;
      }
    }
  } catch (error) {
    // Told to stop, the Run ends as stopped; the workflow itself was not cancelled, so it completes.
    if (stop && isCancellation(error)) {
      end = { status: "stopped", reason: stop };
      await finish(end);
      return end;
    }
    await finish(
      isCancellation(error)
        ? { status: "stopped", reason: "cancelled" }
        : { status: "failed" },
    );
    throw error;
  }
  await finish(end);
  return end;
}

// An Artifact's Run (ADR-0006): one workflow, one Activity. A single attempt, like extraction: a model call that
// failed may already have cost money, so the student asks again instead.
const { makeArtifact } = proxyActivities<{
  makeArtifact(runId: string): Promise<"ready" | "failed">;
}>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 1 },
});
/** Started by the API once the student asked for an Artifact; its Run is already recorded and pinned. */
export async function artifactRun(ref: { runId: string }) {
  return makeArtifact(ref.runId);
}

/** Started by the reconcile Schedule: asks executors about stale in-flight dispatches, never retrying blindly, and performs unperformed approved Actions through the gate. */
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

// Routines look 14 days ahead, so a failed day is caught up by the next tick.
const { tickRoutines } = proxyActivities<{ tickRoutines(): Promise<void> }>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 1 },
});

/** Started by the Routine Schedule: adds the Preparations and Follow-ups every student's Routines call for. */
export async function routineTick() {
  await tickRoutines();
}

// Prices stay usable for 7 days, so a failed day is retried by the next tick rather than here.
const { syncModelPrices: syncPrices } = proxyActivities<{
  syncModelPrices(): Promise<void>;
}>({
  startToCloseTimeout: "2 minutes",
  retry: { maximumAttempts: 3 },
});

/** Started by the model price Schedule: records OpenRouter's zero-retention prices in the Model Catalog. */
export async function syncModelPrices() {
  await syncPrices();
}
