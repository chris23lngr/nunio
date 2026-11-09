import { randomUUID } from "node:crypto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRunWorkflows } from "./run-workflows.js";

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe("waking a Run on Temporal", () => {
  it("signals approvalDecided with the Action to exactly the Run that asked", async () => {
    const workflowId = `run/${randomUUID()}-2026-11-12T05:00:00Z`;
    // No worker polls: Temporal still records the signal against the waiting Run.
    const handle = await env.client.workflow.start("responsibilityRun", {
      taskQueue: "runs",
      workflowId,
      args: [{}],
    });

    await createRunWorkflows({ client: env.client }).signalDecided(
      { workflowId, runId: handle.firstExecutionRunId },
      "action-1",
    );

    const events = (await handle.fetchHistory()).events ?? [];
    const signalled = events.flatMap((e) =>
      e.workflowExecutionSignaledEventAttributes
        ? [e.workflowExecutionSignaledEventAttributes]
        : [],
    );
    expect(signalled.map((s) => s.signalName)).toEqual(["approvalDecided"]);
    expect(
      Buffer.from(signalled[0]!.input!.payloads![0]!.data!).toString(),
    ).toBe('"action-1"');
  });
});
