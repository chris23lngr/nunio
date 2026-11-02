// Temporal worker entrypoint (ADR-0004). Runs on Render; SIGTERM drains in-flight Activities for up
// to SHUTDOWN_GRACE_SECONDS, which must stay below the service's maxShutdownDelaySeconds.
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { createActivities } from "./activities.js";
import { payloadCodecFromEnv } from "@nunio/keys";
import { createSourceActivities } from "./source-activities.js";
import { log } from "./log.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const apiKey = process.env.TEMPORAL_API_KEY;
const connection = await NativeConnection.connect({
  address: required("TEMPORAL_ADDRESS"),
  ...(apiKey && { tls: true, apiKey }),
});
const taskQueue = required("TEMPORAL_TASK_QUEUE");
const codec = payloadCodecFromEnv(process.env);

// dist/ carries a bundle prebuilt at build time; under tsx (tests) the worker bundles src itself.
const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));
const workflows = existsSync(here("./workflow-bundle.js"))
  ? { workflowBundle: { codePath: here("./workflow-bundle.js") } }
  : { workflowsPath: here(`./workflows${extname(fileURLToPath(import.meta.url))}`) };

const sourceActivities = createSourceActivities(process.env);
const worker = await Worker.create({
  connection,
  namespace: required("TEMPORAL_NAMESPACE"),
  taskQueue,
  ...workflows,
  // Render's private host:port for the parser service (render.yaml `fromService`).
  activities: { ...createActivities({ parserUrl: `http://${required("PARSER_HOSTPORT")}` }), ...sourceActivities.activities },
  dataConverter: { payloadCodecs: [codec] },
  shutdownGraceTime: `${Number(process.env.SHUTDOWN_GRACE_SECONDS ?? 25)} seconds`,
});

log("worker running", { taskQueue });
try { await worker.run(); } finally { await sourceActivities.close(); }
await connection.close();
log("worker stopped");
