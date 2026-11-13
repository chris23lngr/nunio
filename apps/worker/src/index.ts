// Temporal worker entrypoint (ADR-0004). Runs on Render; SIGTERM drains in-flight Activities for up
// to SHUTDOWN_GRACE_SECONDS, which must stay below the service's maxShutdownDelaySeconds.
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { payloadCodecFromEnv } from "@nunio/keys";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { createActivities } from "./activities.js";
import { createArtifactActivities } from "./artifact-activities.js";
import { createDecisionNotifier } from "./decision-notifier.js";
import { log } from "./log.js";
import { createModelCatalogActivities } from "./model-catalog-activities.js";
import { ensureModelPriceSchedule } from "./model-price-schedule.js";
import { ensureOutreachSchedule } from "./outreach-schedule.js";
import { ensureReconcileSchedule } from "./reconcile-schedule.js";
import { ensureRoutineSchedule } from "./routine-schedule.js";
import { runActivitiesFromEnv } from "./run-activities.js";
import { createSourceActivities } from "./source-activities.js";

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
  : {
      workflowsPath: here(
        `./workflows${extname(fileURLToPath(import.meta.url))}`,
      ),
    };

// Task Models resolve at start, so a Model missing from the catalog stops the worker from starting.
const modelCatalog = createModelCatalogActivities(process.env);
const taskModels = await modelCatalog.taskModels();
const sourceActivities = createSourceActivities(process.env, taskModels);
const artifactActivities = createArtifactActivities(process.env, taskModels);

// The reconcile, outreach and model price Schedules live in Temporal; creating them again on each start is a no-op.
const clientConnection = await Connection.connect({
  address: required("TEMPORAL_ADDRESS"),
  ...(apiKey && { tls: true, apiKey }),
});
const client = new Client({
  connection: clientConnection,
  namespace: required("TEMPORAL_NAMESPACE"),
  dataConverter: { payloadCodecs: [codec] },
});
const runActivities = runActivitiesFromEnv(
  process.env,
  createDecisionNotifier(client),
);
await ensureReconcileSchedule(client, taskQueue);
await ensureOutreachSchedule(client, taskQueue);
await ensureModelPriceSchedule(client, taskQueue);
await ensureRoutineSchedule(client, taskQueue);
const worker = await Worker.create({
  connection,
  namespace: required("TEMPORAL_NAMESPACE"),
  taskQueue,
  ...workflows,
  // Render's private host:port for the parser service (render.yaml `fromService`).
  activities: {
    ...createActivities({ parserUrl: `http://${required("PARSER_HOSTPORT")}` }),
    ...sourceActivities.activities,
    ...artifactActivities.activities,
    ...runActivities.activities,
    ...modelCatalog.activities,
  },
  dataConverter: { payloadCodecs: [codec] },
  shutdownGraceTime: `${Number(process.env.SHUTDOWN_GRACE_SECONDS ?? 25)} seconds`,
});

log("worker running", { taskQueue });
try {
  await worker.run();
} finally {
  await sourceActivities.close();
  await artifactActivities.close();
  await runActivities.close();
  await modelCatalog.close();
  await clientConnection.close();
}
await connection.close();
log("worker stopped");
