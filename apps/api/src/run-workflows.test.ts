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

describe("starting an Agent's Run on Temporal", () => {
  it("starts one agentRun workflow under the Run's workflow ID, with the recorded Run", async () => {
    const runId = randomUUID();
    const workflowId = `agentRun/${runId}`;

    await createRunWorkflows({
      client: env.client,
      taskQueue: "runs",
    }).startAgentRun({
      studentId: "student",
      agentId: "agent",
      runId,
      workflowId,
    });

    const handle = env.client.workflow.getHandle(workflowId);
    const described = await handle.describe();
    expect(described.type).toBe("agentRun");
    expect(described.taskQueue).toBe("runs");
    const [started] = (await handle.fetchHistory()).events ?? [];
    expect(
      JSON.parse(
        Buffer.from(
          started!.workflowExecutionStartedEventAttributes!.input!.payloads![0]!
            .data!,
        ).toString(),
      ),
    ).toEqual({ studentId: "student", agentId: "agent", runId });
    await handle.terminate();
  });
});

describe("stopping an Agent's Run on Temporal", () => {
  const runs = () =>
    createRunWorkflows({ client: env.client, taskQueue: "runs" });

  it("signals stopAgentRun with why to the Run's workflow while it runs", async () => {
    const workflowId = `agentRun/${randomUUID()}`;
    // No worker polls: Temporal still records the signal against the running workflow.
    const handle = await env.client.workflow.start("agentRun", {
      taskQueue: "runs",
      workflowId,
      args: [{}],
    });

    expect(await runs().agentRunAlive(workflowId)).toBe(true);
    expect(await runs().stopAgentRun(workflowId, "paused")).toBe(true);

    const signalled = ((await handle.fetchHistory()).events ?? []).flatMap(
      (e) =>
        e.workflowExecutionSignaledEventAttributes
          ? [e.workflowExecutionSignaledEventAttributes]
          : [],
    );
    expect(signalled.map((s) => s.signalName)).toEqual(["stopAgentRun"]);
    expect(
      Buffer.from(signalled[0]!.input!.payloads![0]!.data!).toString(),
    ).toBe('"paused"');
    await handle.terminate();
  });

  it("cancels a deleted Agent's Run workflow, and leaves one that no longer runs alone", async () => {
    const workflowId = `agentRun/${randomUUID()}`;
    const handle = await env.client.workflow.start("agentRun", {
      taskQueue: "runs",
      workflowId,
      args: [{}],
    });

    await runs().cancelRun(workflowId);
    await runs().cancelRun(`agentRun/${randomUUID()}`);

    const events = (await handle.fetchHistory()).events ?? [];
    expect(
      events.some((e) => e.workflowExecutionCancelRequestedEventAttributes),
    ).toBe(true);
    await handle.terminate();
  });

  it("answers that a terminated or unknown workflow no longer runs", async () => {
    const workflowId = `agentRun/${randomUUID()}`;
    const handle = await env.client.workflow.start("agentRun", {
      taskQueue: "runs",
      workflowId,
      args: [{}],
    });
    await handle.terminate();

    expect(await runs().agentRunAlive(workflowId)).toBe(false);
    expect(await runs().stopAgentRun(workflowId, "ended")).toBe(false);
    expect(await runs().agentRunAlive(`agentRun/${randomUUID()}`)).toBe(false);
    expect(await runs().stopAgentRun(`agentRun/${randomUUID()}`, "ended")).toBe(
      false,
    );
  });
});
