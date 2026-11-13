// Records awaitApproval, ingestSource and responsibilityRun histories for the replay test (src/replay.test.ts). Usage, from apps/worker:
//   node scripts/record-history.ts [workflows file] [ingestSource history name]
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { historyToJSON } from "@temporalio/common/proto-utils";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { approvalDecidedSignal, approvalSignal } from "../src/workflows.ts";

const workflowsPath = new URL(
  process.argv[2] ?? "../src/workflows.ts",
  import.meta.url,
).pathname;
const write = (name: string, history: Parameters<typeof historyToJSON>[0]) => {
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
} finally {
  await env.teardown();
}
