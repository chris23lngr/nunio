// Records awaitApproval, ingestSource, responsibilityRun and agentRun (reading only, acting, started by its Schedule, and
// told to stop) histories for the replay test (src/replay.test.ts). Usage, from apps/worker:
//   node scripts/record-history.ts [workflows file] [ingestSource history name]
// RECORD_ONLY=agent-run-stopped (comma-separated names) writes only those, keeping the others as recorded before.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Context } from "@temporalio/activity";
import { historyToJSON } from "@temporalio/common/proto-utils";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { approvalDecidedSignal, approvalSignal } from "../src/workflows.ts";

const workflowsPath = new URL(
  process.argv[2] ?? "../src/workflows.ts",
  import.meta.url,
).pathname;
const only = process.env.RECORD_ONLY?.split(",");
const write = (name: string, history: Parameters<typeof historyToJSON>[0]) => {
  if (only && !only.includes(name)) return;
  const path = new URL(`../histories/${name}.json`, import.meta.url);
  writeFileSync(
    path,
    `${JSON.stringify(JSON.parse(historyToJSON(history)), null, 2)}\n`,
  );
  console.log(`wrote ${path.pathname}`);
};
let performed = 0;
const env = await TestWorkflowEnvironment.createLocal();
try {
  const taskQueue = "record-history";
  // A worker polls only once, so each recording gets its own.
  const worker = () =>
    Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowsPath,
      activities: {
        processSource: async () => ({ status: "ready" }),
        extractFacts: async () => ({
          status: "done",
          dropped: { ungrounded: 0, noCourse: 0, aiUseRule: 0 },
        }),
        // A Run that asks once, is approved, and acts.
        startRun: async () => "run",
        proposeActions: async () => [
          {
            kind: "studyBlock.move",
            studyBlockId: "block",
            start: "2026-12-01T14:00:00.000Z",
            end: "2026-12-01T15:00:00.000Z",
          },
        ],
        performAction: async () =>
          performed++ === 0
            ? {
                status: "awaiting_approval",
                actionId: "action",
                fingerprint: "fingerprint",
                expiresAt: "2099-01-01T00:00:00.000Z",
              }
            : {
                status: "done",
                actionId: "action",
                effect: { studyBlockId: "block" },
              },
        // An Agent's Run that reads twice, then answers; with Actions, its first step also calls two Action tools.
        // A Run its Schedule starts has no runId from the API.
        startAgentRun: async ({ runId }: { runId?: string }) =>
          runId ?? "agent-run-scheduled",
        // A Run told to stop is signalled during its first step, which it abandons.
        agentStep: async ({ runId, n }: { runId: string; n: number }) => {
          if (runId === "agent-run-stopped") {
            const handle = env.client.workflow.getHandle(
              Context.current().info.workflowExecution.workflowId,
            );
            await handle.signal("stopAgentRun", "paused");
            await handle.result();
          }
          return n >= 3
            ? { status: "answered" }
            : {
                status: "continue",
                actions: runId === "agent-run-actions" && n === 1 ? 2 : 0,
              };
        },
        agentActions: async () => ({ unconfirmed: false }),
        finishAgentRun: async () => {},
      },
    });
  const workflowId = `approval-${randomUUID()}`;
  await (await worker()).runUntil(async () => {
    const handle = await env.client.workflow.start("awaitApproval", {
      taskQueue,
      workflowId,
    });
    await handle.signal(approvalSignal, "approved");
    await handle.result();
  });
  write(
    "await-approval",
    await env.client.workflow.getHandle(workflowId).fetchHistory(),
  );
  const sourceWorkflowId = `source-${randomUUID()}`;
  await (await worker()).runUntil(
    env.client.workflow.execute("ingestSource", {
      taskQueue,
      workflowId: sourceWorkflowId,
      args: [{ studentId: "student", sourceId: "source" }],
    }),
  );
  write(
    process.argv[3] ?? "ingest-source",
    await env.client.workflow.getHandle(sourceWorkflowId).fetchHistory(),
  );
  const runWorkflowId = `run-${randomUUID()}`;
  await (await worker()).runUntil(async () => {
    const handle = await env.client.workflow.start("responsibilityRun", {
      taskQueue,
      workflowId: runWorkflowId,
      args: [{ studentId: "student", responsibilityId: "responsibility" }],
    });
    // Signalled once the Run waits, as the API does after the student decides.
    while (performed === 0)
      await new Promise((resolve) => setTimeout(resolve, 50));
    await handle.signal(approvalDecidedSignal, "action");
    await handle.result();
  });
  write(
    "responsibility-run",
    await env.client.workflow.getHandle(runWorkflowId).fetchHistory(),
  );
  const agentRunWorkflowId = `agentRun/${randomUUID()}`;
  await (await worker()).runUntil(
    env.client.workflow.execute("agentRun", {
      taskQueue,
      workflowId: agentRunWorkflowId,
      args: [{ studentId: "student", agentId: "agent", runId: "agent-run" }],
    }),
  );
  write(
    "agent-run",
    await env.client.workflow.getHandle(agentRunWorkflowId).fetchHistory(),
  );
  const actingWorkflowId = `agentRun/${randomUUID()}`;
  await (await worker()).runUntil(
    env.client.workflow.execute("agentRun", {
      taskQueue,
      workflowId: actingWorkflowId,
      args: [
        { studentId: "student", agentId: "agent", runId: "agent-run-actions" },
      ],
    }),
  );
  write(
    "agent-run-actions",
    await env.client.workflow.getHandle(actingWorkflowId).fetchHistory(),
  );
  const scheduledWorkflowId = `agentRun/agent-${randomUUID()}`;
  await (await worker()).runUntil(
    env.client.workflow.execute("agentRun", {
      taskQueue,
      workflowId: scheduledWorkflowId,
      args: [{ studentId: "student", agentId: "agent" }],
    }),
  );
  write(
    "agent-run-scheduled",
    await env.client.workflow.getHandle(scheduledWorkflowId).fetchHistory(),
  );
  const stoppedWorkflowId = `agentRun/${randomUUID()}`;
  await (await worker()).runUntil(
    env.client.workflow.execute("agentRun", {
      taskQueue,
      workflowId: stoppedWorkflowId,
      args: [
        { studentId: "student", agentId: "agent", runId: "agent-run-stopped" },
      ],
    }),
  );
  write(
    "agent-run-stopped",
    await env.client.workflow.getHandle(stoppedWorkflowId).fetchHistory(),
  );
} finally {
  await env.teardown();
}
