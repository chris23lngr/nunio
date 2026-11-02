import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

/** Starts the real worker entrypoint and resolves once it logs `msg`. */
function startWorker(vars: Record<string, string>): { child: ChildProcess; logged: (msg: string) => Promise<void> } {
  const child = spawn(process.execPath, ["--import", "tsx", new URL("./index.ts", import.meta.url).pathname], {
    env: { ...process.env, ...vars },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const lines: string[] = [];
  const waiters: { msg: string; resolve: () => void }[] = [];
  child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
    for (const line of chunk.split("\n").filter(Boolean)) {
      lines.push(line);
      for (const w of waiters) if (line.includes(`"msg":"${w.msg}"`)) w.resolve();
    }
  });
  const exited = once(child, "exit");
  const logged = (msg: string) =>
    Promise.race([
      new Promise<void>((resolve) => {
        if (lines.some((l) => l.includes(`"msg":"${msg}"`))) return resolve();
        waiters.push({ msg, resolve });
      }),
      exited.then(([code]) => {
        throw new Error(`worker exited with ${code} before logging "${msg}"`);
      }),
    ]);
  return { child, logged };
}

describe("the worker process", () => {
  it("finishes an in-flight Activity on SIGTERM and exits within the grace time", async () => {
    const taskQueue = `shutdown-${randomUUID()}`;
    const { child, logged } = startWorker({
      TEMPORAL_ADDRESS: env.address,
      TEMPORAL_NAMESPACE: "default",
      TEMPORAL_TASK_QUEUE: taskQueue,
      TEMPORAL_API_KEY: "",
      CODEC_KEY: randomBytes(32).toString("base64"),
      CODEC_KEY_VERSION: "v1",
      SHUTDOWN_GRACE_SECONDS: "10",
      PARSER_HOSTPORT: "127.0.0.1:1",
      // Unused by this test; the worker refuses to start without its Source settings.
      DATABASE_URL: "postgresql://runtime@127.0.0.1:1/nunio",
      SOURCE_KEY_VERSION: "v1", SOURCE_MASTER_KEYS: JSON.stringify({ v1: randomBytes(32).toString("base64") }),
      HETZNER_S3_ENDPOINT: "https://storage.invalid", HETZNER_S3_REGION: "test",
      HETZNER_S3_ACCESS_KEY_ID: "test", HETZNER_S3_SECRET_ACCESS_KEY: "test",
      HETZNER_QUARANTINE_BUCKET: "quarantine", HETZNER_SOURCES_BUCKET: "sources",
      OPENROUTER_API_KEY: "test", OPENROUTER_BASE_URL: "https://openrouter.invalid",
    });
    await logged("worker running");

    const workflowId = `hold-${randomUUID()}`;
    await env.client.workflow.start("holdActivity", { taskQueue, workflowId, args: [3_000] });
    await logged("activity started");

    const started = Date.now();
    child.kill("SIGTERM");
    const [code] = await once(child, "exit");
    const elapsed = Date.now() - started;

    expect(code).toBe(0);
    expect(elapsed).toBeLessThan(10_000);
    const history = await env.client.workflow.getHandle(workflowId).fetchHistory();
    const types = (history.events ?? []).map((e) => e.activityTaskCompletedEventAttributes);
    expect(types.some(Boolean)).toBe(true);
  }, 60_000);
});
