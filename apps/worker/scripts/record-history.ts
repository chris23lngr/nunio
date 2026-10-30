// Records an awaitApproval history for the replay test (src/replay.test.ts). Usage, from apps/worker:
//   node scripts/record-history.ts
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { historyToJSON } from "@temporalio/common/proto-utils";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { approvalSignal } from "../src/workflows.ts";

const env = await TestWorkflowEnvironment.createLocal();
try {
  const taskQueue = "record-history";
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowsPath: new URL("../src/workflows.ts", import.meta.url).pathname,
  });
  const workflowId = `approval-${randomUUID()}`;
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start("awaitApproval", { taskQueue, workflowId });
    await handle.signal(approvalSignal, "approved");
    await handle.result();
  });
  const history = await env.client.workflow.getHandle(workflowId).fetchHistory();
  const path = new URL("../histories/await-approval.json", import.meta.url);
  writeFileSync(path, `${JSON.stringify(JSON.parse(historyToJSON(history)), null, 2)}\n`);
  console.log(`wrote ${path.pathname}`);
} finally {
  await env.teardown();
}
