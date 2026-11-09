// Spike d staging checks against Temporal Cloud. Usage, from apps/worker:
//   set -a; . ./.env.staging; set +a; npx tsx scripts/staging.ts <command> [args]
//   start <id>            start awaitApproval
//   signal <id> <text>    send the Approval signal
//   result <id>           wait for the result
//   status <id>           print the run's status
//   hold <id> <ms>        start holdActivity
//   ciphertext <id>       check the stored history holds only codec ciphertext (what the UI shows)
//   timeline <id>         Activity attempts with their worker identity and times
//   parser <id>           run checkParser: the worker calls the parser over Render's private network

import { payloadCodecFromEnv } from "@nunio/keys";
import { Client, Connection } from "@temporalio/client";
import { approvalSignal } from "../src/workflows.js";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};
const connection = await Connection.connect({
  address: env("TEMPORAL_ADDRESS"),
  tls: true,
  apiKey: env("TEMPORAL_API_KEY"),
});
const namespace = env("TEMPORAL_NAMESPACE");
const taskQueue = env("TEMPORAL_TASK_QUEUE");
const codec = payloadCodecFromEnv(process.env);
const client = new Client({
  connection,
  namespace,
  dataConverter: { payloadCodecs: [codec] },
});
const raw = new Client({ connection, namespace });

const [command, id, arg] = process.argv.slice(2);
if (!command || !id) throw new Error("usage: staging.ts <command> <id> [arg]");
const handle = client.workflow.getHandle(id);

switch (command) {
  case "start":
    await client.workflow.start("awaitApproval", { taskQueue, workflowId: id });
    console.log(`started ${id}`);
    break;
  case "signal":
    await handle.signal(approvalSignal, arg ?? "approved");
    console.log(`signalled ${id}`);
    break;
  case "result":
    console.log(`result ${JSON.stringify(await handle.result())}`);
    break;
  case "status":
    console.log(`status ${(await handle.describe()).status.name}`);
    break;
  case "hold":
    await client.workflow.start("holdActivity", {
      taskQueue,
      workflowId: id,
      args: [Number(arg ?? 20_000)],
    });
    console.log(`started ${id}`);
    break;
  case "ciphertext": {
    const history = await raw.workflow.getHandle(id).fetchHistory();
    const encodings = new Map<string, number>();
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object" || value instanceof Uint8Array)
        return;
      if ("payloads" in value && Array.isArray(value.payloads)) {
        for (const p of value.payloads as {
          metadata?: Record<string, Uint8Array>;
        }[]) {
          const enc = Buffer.from(p.metadata?.encoding ?? []).toString();
          const version = Buffer.from(
            p.metadata?.["encryption-key-version"] ?? [],
          ).toString();
          const key = `${enc} (${version || "no key version"})`;
          encodings.set(key, (encodings.get(key) ?? 0) + 1);
        }
      }
      for (const child of Object.values(value)) walk(child);
    };
    walk(history);
    console.log("payload encodings:", Object.fromEntries(encodings));
    break;
  }
  case "parser":
    console.log(
      "parser",
      JSON.stringify(
        await client.workflow.execute("checkParser", {
          taskQueue,
          workflowId: id,
        }),
      ),
    );
    break;
  case "timeline": {
    const history = await raw.workflow.getHandle(id).fetchHistory();
    for (const event of history.events ?? []) {
      const at = new Date(
        Number(event.eventTime?.seconds ?? 0) * 1000 +
          (event.eventTime?.nanos ?? 0) / 1e6,
      );
      const started = event.activityTaskStartedEventAttributes;
      const completed = event.activityTaskCompletedEventAttributes;
      const failed =
        event.activityTaskTimedOutEventAttributes ??
        event.activityTaskFailedEventAttributes;
      if (started)
        console.log(
          at.toISOString(),
          "activity started",
          `attempt ${started.attempt}`,
          started.identity,
        );
      if (completed)
        console.log(at.toISOString(), "activity completed", completed.identity);
      if (failed) console.log(at.toISOString(), "activity failed or timed out");
    }
    break;
  }
  default:
    throw new Error(`unknown command ${command}`);
}
await connection.close();
