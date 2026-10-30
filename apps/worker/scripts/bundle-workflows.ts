// Bundles the compiled workflows once at build time, so the worker starts without webpack.
// Runs as part of `bun run build`, after tsc.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundleWorkflowCode } from "@temporalio/worker";

const { code } = await bundleWorkflowCode({
  workflowsPath: fileURLToPath(new URL("../dist/workflows.js", import.meta.url)),
});
writeFileSync(new URL("../dist/workflow-bundle.js", import.meta.url), code);
