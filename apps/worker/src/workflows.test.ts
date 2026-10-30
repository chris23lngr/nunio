import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@temporalio/client";
import type { PayloadCodec } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPayloadCodec } from "./codec.js";
import { approvalSignal } from "./workflows.js";

const taskQueue = "spike-d-test";
let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

async function withWorker<T>(run: () => Promise<T>, codec?: PayloadCodec): Promise<T> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    ...(codec && { dataConverter: { payloadCodecs: [codec] } }),
    workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
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
