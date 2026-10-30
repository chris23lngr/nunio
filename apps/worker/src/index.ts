// Temporal worker entrypoint (ADR-0004). Runs on Render; SIGTERM drains in-flight Activities for up
// to SHUTDOWN_GRACE_SECONDS, which must stay below the service's maxShutdownDelaySeconds.
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities.js";
import { createPayloadCodec } from "./codec.js";
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
const codec = createPayloadCodec({
  key: Buffer.from(required("CODEC_KEY"), "base64"),
  keyVersion: required("CODEC_KEY_VERSION"),
});

const worker = await Worker.create({
  connection,
  namespace: required("TEMPORAL_NAMESPACE"),
  taskQueue,
  // ./workflows.ts under tsx in tests, ./workflows.js from dist in production.
  workflowsPath: fileURLToPath(new URL(`./workflows${extname(fileURLToPath(import.meta.url))}`, import.meta.url)),
  activities,
  dataConverter: { payloadCodecs: [codec] },
  shutdownGraceTime: `${Number(process.env.SHUTDOWN_GRACE_SECONDS ?? 25)} seconds`,
});

log("worker running", { taskQueue });
await worker.run();
await connection.close();
log("worker stopped");
