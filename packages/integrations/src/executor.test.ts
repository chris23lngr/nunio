import { createServer } from "node:net";
import type { PrismaClient } from "@nunio/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callMcpWrite, createIntegrationExecutor } from "./executor.js";
import { tokenFrom } from "./testing/access-token.js";
import type { FakeMcpServer, McpFault } from "./testing.js";
import { startFakeMcpServer } from "./testing.js";

let fake: FakeMcpServer;
let accessToken: string;

beforeAll(async () => {
  fake = await startFakeMcpServer();
  accessToken = await tokenFrom(fake);
});

afterAll(async () => {
  await fake?.stop();
});

const page = { title: "Lineare Algebra", body: "Zusammenfassung" };
const callsTo = (tool: string) =>
  fake.calls.filter((call) => call.tool === tool).length;

/** One `notes.create_page` write against the fake, after `faults`, within `ms` of the gate's time. */
async function write(faults: McpFault[] = [], ms = 10_000) {
  if (faults.length) fake.script("notes.create_page", ...faults);
  const before = callsTo("notes.create_page");
  const result = await callMcpWrite(
    async () => ({ mcpUrl: fake.mcpUrl, transport: "http", accessToken }),
    "notes.create_page",
    page,
    { fakes: true, signal: AbortSignal.timeout(ms) },
  );
  return { result, calls: callsTo("notes.create_page") - before };
}

describe("an Integration write", () => {
  it("is done once the service answers, with its answer fenced for the model", async () => {
    const { result, calls } = await write();

    expect(result).toMatchObject({ status: "done" });
    expect(
      (result as { result: string }).result.startsWith("<<<BEGIN untrusted"),
    ).toBe(true);
    expect(calls).toBe(1);
    expect(fake.calls.at(-1)?.arguments).toEqual(page);
  });

  it.each<[string, McpFault, string]>([
    [
      "a tool error",
      { kind: "tool-error", message: "Seite existiert schon" },
      "Seite existiert schon",
    ],
    [
      "a JSON-RPC error",
      { kind: "rpc-error", message: "Ungültige Eltern-Seite" },
      "Ungültige Eltern-Seite",
    ],
  ])(
    "fails on %s, handing the service's text back only fenced",
    async (_, fault, text) => {
      const { result, calls } = await write([fault]);

      expect(result).toMatchObject({
        status: "rejected",
        detail: "service_error",
      });
      const shown = (result as { result: string }).result;
      expect(shown).toContain(text);
      expect(shown).toMatch(/<<<BEGIN untrusted [0-9a-f]+>>>/);
      expect(calls).toBe(1);
    },
  );

  it("fails on a 4xx, and on a 401 as needing reconnection", async () => {
    expect((await write([{ kind: "http", status: 400 }])).result).toEqual({
      status: "rejected",
      detail: "service_error",
      result: "The service refused the call (HTTP 400).",
    });
    expect(
      (await write([{ kind: "http", status: 429, retryAfter: 1 }])).result,
    ).toMatchObject({ status: "rejected", detail: "service_error" });
    expect((await write([{ kind: "http", status: 401 }])).result).toMatchObject(
      { status: "rejected", detail: "needs_reconnection" },
    );
  });

  it("is ambiguous on a 5xx, which may have been applied, and never retries", async () => {
    const { result, calls } = await write([{ kind: "http", status: 503 }]);

    expect(result).toEqual({ status: "ambiguous" });
    expect(calls).toBe(1);
  });

  it("is ambiguous when the connection drops after the call was received, recording one call", async () => {
    const { result, calls } = await write([{ kind: "drop" }]);

    expect(result).toEqual({ status: "ambiguous" });
    expect(calls).toBe(1);
  });

  it("is ambiguous when no answer comes in the gate's time, recording one call", async () => {
    const { result, calls } = await write([{ kind: "hang" }], 1_000);

    expect(result).toEqual({ status: "ambiguous" });
    expect(calls).toBe(1);
  });

  it("fails as not sent when the server can't be reached", async () => {
    // A port nothing listens on.
    const closed = await new Promise<number>((resolve) => {
      const server = createServer().listen(0, "127.0.0.1", () => {
        const { port } = server.address() as { port: number };
        server.close(() => resolve(port));
      });
    });

    const result = await callMcpWrite(
      async () => ({
        mcpUrl: `http://127.0.0.1:${closed}/mcp`,
        transport: "http",
        accessToken,
      }),
      "notes.create_page",
      page,
      { fakes: true, signal: AbortSignal.timeout(10_000) },
    );

    expect(result).toMatchObject({ status: "rejected", detail: "not_sent" });
  });

  it("fails as not sent when the Connection can't be loaded", async () => {
    const before = fake.calls.length;

    const result = await callMcpWrite(
      async () => {
        throw new Error("no such Connection");
      },
      "notes.create_page",
      page,
      { fakes: true, signal: AbortSignal.timeout(10_000) },
    );

    expect(result).toMatchObject({ status: "rejected", detail: "not_sent" });
    expect(fake.calls.length).toBe(before);
  });
});

describe("the integration executor", () => {
  it("never knows what became of a write left in flight", async () => {
    const executor = createIntegrationExecutor({
      db: {} as PrismaClient,
      credentials: () => {
        throw new Error("unused");
      },
      fakes: true,
    });

    expect(await executor.lookup("action-1:1", { studentId: "s" })).toEqual({
      status: "unknown",
    });
  });
});
