import { readFileSync } from "node:fs";
import { bundleWorkflowCode, Worker, type WorkflowBundle } from "@temporalio/worker";
import { beforeAll, describe, it } from "vitest";

let workflowBundle: WorkflowBundle;

beforeAll(async () => {
  workflowBundle = await bundleWorkflowCode({ workflowsPath: new URL("./workflows.ts", import.meta.url).pathname });
}, 120_000);

// ADR-0004: workflow changes go through patched() and must replay every recorded history.
// Record a new history with scripts/record-history.ts whenever a workflow gains a code path.
describe("replay", () => {
  it("replays the recorded awaitApproval history with the current workflow code", async () => {
    const history = JSON.parse(readFileSync(new URL("../histories/await-approval.json", import.meta.url), "utf8"));
    await Worker.runReplayHistory(
      { workflowBundle },
      history,
    );
  });
});
