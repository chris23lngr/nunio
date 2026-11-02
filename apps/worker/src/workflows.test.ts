import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@temporalio/client";
import type { PayloadCodec } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { bundleWorkflowCode, Worker, type WorkflowBundle } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createParserServer } from "@nunio/parser/server";
import { createActivities } from "./activities.js";
import { createPayloadCodec } from "@nunio/keys";
import { parseSource } from "./source-activities.js";
import { approvalSignal } from "./workflows.js";

const taskQueue = "spike-d-test";
let env: TestWorkflowEnvironment;
let workflowBundle: WorkflowBundle;

// Bundling the workflows takes several seconds on CI runners, so do it once per file.
beforeAll(async () => {
  [env, workflowBundle] = await Promise.all([
    TestWorkflowEnvironment.createLocal(),
    bundleWorkflowCode({ workflowsPath: new URL("./workflows.ts", import.meta.url).pathname }),
  ]);
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

async function withWorker<T>(run: () => Promise<T>, codec?: PayloadCodec): Promise<T> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    ...(codec && { dataConverter: { payloadCodecs: [codec] } }),
    workflowBundle,
  });
  return worker.runUntil(run());
}

describe("awaitApproval", () => {
  it("completes with the decision once the Approval signal arrives", async () => {
    const result = await withWorker(async () => {
      const handle = await env.client.workflow.start("awaitApproval", {
        taskQueue,
        workflowId: `approval-${randomUUID()}`,
      });
      await handle.signal(approvalSignal, "approved");
      return handle.result();
    });
    expect(result).toBe("approved");
  });
});

describe("the payload codec", () => {
  it("leaves only ciphertext tagged with the key version in Temporal's history", async () => {
    const codec = createPayloadCodec({ key: randomBytes(32), keyVersion: "v1" });
    const client = new Client({
      connection: env.connection,
      namespace: env.namespace,
      dataConverter: { payloadCodecs: [codec] },
    });
    const decision = "approved: move the physics study block to Thursday";
    const workflowId = `approval-${randomUUID()}`;

    const result = await withWorker(async () => {
      const handle = await client.workflow.start("awaitApproval", { taskQueue, workflowId });
      await handle.signal(approvalSignal, decision);
      return handle.result();
    }, codec);
    expect(result).toBe(decision);

    // Read the history as Temporal stores it: through a client without the codec.
    const history = await env.client.workflow.getHandle(workflowId).fetchHistory();
    const payloads = (history.events ?? []).flatMap(payloadsOf);
    expect(payloads.length).toBeGreaterThan(0);
    for (const payload of payloads) {
      expect(text(payload.metadata?.encoding)).toBe("binary/encrypted");
      expect(text(payload.metadata?.["encryption-key-version"])).toBe("v1");
      expect(Buffer.from(payload.data ?? []).toString("utf8")).not.toContain("physics");
    }
  });
});

type RawPayload = { metadata?: Record<string, Uint8Array> | null; data?: Uint8Array | null };

/** Every payload in a history event, wherever the event type keeps it. */
function payloadsOf(event: object): RawPayload[] {
  const found: RawPayload[] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object" || value instanceof Uint8Array) return;
    if ("payloads" in value && Array.isArray(value.payloads)) found.push(...(value.payloads as RawPayload[]));
    for (const child of Object.values(value)) walk(child);
  };
  walk(event);
  return found;
}

const text = (bytes: Uint8Array | undefined) => (bytes ? Buffer.from(bytes).toString("utf8") : undefined);

describe("checkParser", () => {
  it("reaches the parser's health endpoint from an Activity", async () => {
    const parser = createParserServer({ quarantineBucket: "test" });
    await new Promise<void>((resolve) => parser.listen(0, "127.0.0.1", resolve));
    const parserUrl = `http://127.0.0.1:${(parser.address() as AddressInfo).port}`;
    try {
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue,
        workflowBundle,
        activities: createActivities({ parserUrl }),
      });
      const result = await worker.runUntil(
        env.client.workflow.execute("checkParser", { taskQueue, workflowId: `parser-${randomUUID()}` }),
      );
      expect(result).toEqual({ status: "ok" });
    } finally {
      await new Promise<void>((resolve) => parser.close(() => resolve()));
    }
  });
});

describe("Source Runs", () => {
  it("does not blindly retry an ingestion Activity whose call may have been charged", async () => {
    let calls = 0;
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue, workflowBundle,
      activities: { processSource: async () => { calls++; throw new Error("uncertain call"); } } });
    await worker.runUntil(async () => {
      await expect(env.client.workflow.execute("ingestSource", { taskQueue, workflowId: `source-${randomUUID()}`,
        args: [{ studentId: "student", sourceId: "source" }] })).rejects.toThrow();
    });
    expect(calls).toBe(1);
  });
  it("waits for a busy parser instead of failing the Source", async () => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const parser = createParserServer({ quarantineBucket: "test",
      fetch: async () => { await held; return new Response(null, { status: 404 }); } });
    await new Promise<void>(resolve => parser.listen(0, "127.0.0.1", resolve));
    const hostport = `127.0.0.1:${(parser.address() as AddressInfo).port}`;
    const input = { url: "https://fsn1.your-objectstorage.com/test/source", etag: "e", expectedBytes: 9 };
    try {
      const first = parseSource(hostport, { ...input, keyBase64: Buffer.alloc(32).toString("base64") }, new AbortController().signal);
      await new Promise(resolve => setTimeout(resolve, 100));
      // Past the busy lock, the parser judges the request itself.
      const second = expect(parseSource(hostport, { ...input, keyBase64: "not a key" }, new AbortController().signal))
        .rejects.toThrow("(400)");
      setTimeout(release, 300);
      await expect(first).rejects.toThrow("(502)");
      await second;
    } finally { release(); await new Promise<void>(resolve => parser.close(() => resolve())); }
  });
  it("sweeps object versions immediately and again after the upload window", async () => {
    const seen: unknown[] = [];
    const workflowId = `delete-source-${randomUUID()}`;
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue, workflowBundle,
      activities: { purgeSource: async (input: unknown) => { seen.push(input); } } });
    await worker.runUntil(env.client.workflow.execute("deleteSource", { taskQueue, workflowId,
      args: [{ studentId: "student", sourceId: "source", cleanupAfter: new Date(Date.now() + 3_000).toISOString() }] }));
    expect(seen).toEqual([{ studentId: "student", sourceId: "source" }, { studentId: "student", sourceId: "source" }]);
    const history = await env.client.workflow.getHandle(workflowId).fetchHistory();
    expect(history.events?.some(event => event.timerFiredEventAttributes)).toBe(true);
  });
});
