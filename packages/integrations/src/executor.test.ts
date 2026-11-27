import { randomBytes, randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer } from "node:net";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Executor } from "@nunio/delegation";
import { createConnectionCredentialKeys, createSourceKeys } from "@nunio/keys";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  callMcpWrite,
  createIntegrationExecutor,
  guardedSend,
} from "./executor.js";
import { tokenFrom } from "./testing/access-token.js";
import { testCertificate } from "./testing/certificate.js";
import type { FakeMcpServer, McpFault } from "./testing.js";
import { seedIntegrationCatalog, startFakeMcpServer } from "./testing.js";

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

  it("fails on a 4xx, and on a 401 or 403 as needing reconnection", async () => {
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
    expect((await write([{ kind: "http", status: 403 }])).result).toMatchObject(
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

describe("sending a write's call", () => {
  const toolCall = {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call" }),
  };
  const opening = {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize" }),
  };
  /** A transport that records what reached it, or fails as `fail`. */
  function transport(fail?: unknown) {
    const reached: string[] = [];
    const send = (async (_input: unknown, init?: RequestInit) => {
      reached.push(String(init?.body));
      if (fail) throw fail;
      return new Response("{}");
    }) as typeof fetch;
    return { send, reached };
  }

  it("never sends the call once the gate's time ran out, so a write recorded not sent never went out", async () => {
    const controller = new AbortController();
    const base = transport();
    const call = guardedSend(base.send, controller.signal);
    controller.abort();

    await expect(call.send("http://mcp/", toolCall)).rejects.toThrow();
    expect(base.reached).toEqual([]);
    expect(call.sent()).toBe(false);
    // Only the call is held back, not what opens the session.
    await call.send("http://mcp/", opening);
    expect(base.reached).toEqual([opening.body]);
  });

  it("counts the call as sent from the moment it is handed on", async () => {
    const base = transport();
    const call = guardedSend(base.send, new AbortController().signal);

    await call.send("http://mcp/", opening);
    expect(call.sent()).toBe(false);
    await call.send("http://mcp/", toolCall);
    expect(call.sent()).toBe(true);
  });

  it("counts a call whose connection was never made as not sent", async () => {
    const refused = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    });
    const call = guardedSend(
      transport(refused).send,
      new AbortController().signal,
    );

    await expect(call.send("http://mcp/", toolCall)).rejects.toThrow();
    expect(call.sent()).toBe(false);
  });
});

describe("a write that gets no answer", () => {
  it("is ambiguous through nunio's guarded https transport too, recording one call", async () => {
    const certificate = testCertificate();
    const defaultCAs = getCACertificates("default");
    setDefaultCACertificates([...defaultCAs, certificate.ca]);
    const secure = await startFakeMcpServer({ tls: certificate });
    try {
      const token = await tokenFrom(secure);
      secure.script("notes.create_page", { kind: "hang" });

      const result = await callMcpWrite(
        async () => ({
          mcpUrl: secure.mcpUrl,
          transport: "http",
          accessToken: token,
        }),
        "notes.create_page",
        page,
        {
          fakes: false,
          signal: AbortSignal.timeout(1_000),
          // The loopback stands in for the public internet.
          allowed: () => true,
        },
      );

      expect(result).toEqual({ status: "ambiguous" });
      expect(
        secure.calls.filter((c) => c.tool === "notes.create_page"),
      ).toHaveLength(1);
    } finally {
      await secure.stop();
      setDefaultCACertificates(defaultCAs);
    }
  });

  it("is let go once its own bound passes, closing its connection", async () => {
    let closed = false;
    const server = createHttpServer(async (req, res) => {
      if (req.method !== "POST") return;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const message = JSON.parse(Buffer.concat(chunks).toString()) as {
        id?: unknown;
        method: string;
      };
      if (message.id === undefined) return void res.writeHead(202).end();
      if (message.method === "server/discover")
        return void res.writeHead(429).end();
      if (message.method === "initialize")
        return void res
          .writeHead(200, { "content-type": "application/json" })
          .end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: message.id,
              result: {
                protocolVersion: "2025-11-25",
                capabilities: { tools: {} },
                serverInfo: { name: "scripted", version: "1.0.0" },
              },
            }),
          );
      // The call itself is never answered.
      res.on("close", () => {
        closed = true;
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const port = (server.address() as AddressInfo).port;
      const result = await callMcpWrite(
        async () => ({
          mcpUrl: `http://127.0.0.1:${port}/mcp`,
          transport: "http",
          accessToken,
        }),
        "notes.create_page",
        page,
        {
          fakes: true,
          signal: AbortSignal.timeout(300),
          answerTimeoutMs: 1_000,
        },
      );

      expect(result).toEqual({ status: "ambiguous" });
      expect(closed).toBe(false);
      await expect.poll(() => closed, { timeout: 5_000 }).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("the integration executor", () => {
  let db: TestDatabase;
  let admin: PrismaClient;
  let runtime: PrismaClient;
  const keys = createSourceKeys({
    activeVersion: "v1",
    masters: { v1: randomBytes(32) },
  });
  const credentials = createConnectionCredentialKeys({
    activeVersion: "v1",
    masters: { v1: randomBytes(32) },
  });

  beforeAll(async () => {
    db = await startTestDatabase();
    admin = createPrismaClient(createPool(db.connectionString));
    runtime = createPrismaClient(createPool(db.runtimeConnectionString));
    await seedIntegrationCatalog(admin, fake);
  }, 180_000);

  afterAll(async () => {
    await runtime?.$disconnect();
    await admin?.$disconnect();
    await db?.stop();
  });

  /** A student's Testnotizen Connection holding the fake's access token. */
  async function connection(state = "connected") {
    const studentId = randomUUID(),
      connectionId = randomUUID();
    await admin.user.create({
      data: {
        id: studentId,
        name: "Student",
        email: `${studentId}@example.com`,
        emailVerified: true,
      },
    });
    const { wrapped } = keys.generateConnectionKey(connectionId);
    const sealed = credentials.seal(
      connectionId,
      JSON.stringify({ accessToken }),
    );
    await admin.connection.create({
      data: {
        id: connectionId,
        studentId,
        integrationKey: "testnotizen",
        accountLabel: "Testnotizen",
        state,
        stateCause: state === "connected" ? null : "token_refused",
        keyVersion: wrapped.version,
        keyCiphertext: wrapped.ciphertext,
        credential: {
          create: {
            keyVersion: sealed.version,
            ciphertext: sealed.ciphertext,
          },
        },
      },
    });
    return { studentId, connectionId };
  }

  const executorWith = (keysOf: () => typeof credentials) =>
    createIntegrationExecutor({
      db: runtime,
      credentials: keysOf,
      fakes: true,
    });

  const execute = (
    executor: Executor,
    c: { studentId: string; connectionId: string },
  ) =>
    executor.execute(
      {
        studentId: c.studentId,
        actionId: "action-1",
        intent: {
          kind: "integration.call",
          integrationKey: "testnotizen",
          connectionId: c.connectionId,
          toolName: "notes.create_page",
          pinHash: "a".repeat(64),
          arguments: page,
        },
      },
      { idempotencyKey: "action-1:1", signal: AbortSignal.timeout(10_000) },
    );

  it("performs a write with the Connection's credentials, read at the call", async () => {
    const c = await connection();
    const before = callsTo("notes.create_page");

    const result = await execute(
      executorWith(() => credentials),
      c,
    );

    expect(result).toMatchObject({ status: "done" });
    expect(callsTo("notes.create_page") - before).toBe(1);
    expect(fake.calls.at(-1)).toMatchObject({
      arguments: page,
      token: accessToken,
    });
  });

  it("sends nothing on a Connection that Needs reconnection", async () => {
    const c = await connection("needs_reconnection");
    const before = fake.calls.length;

    const result = await execute(
      executorWith(() => credentials),
      c,
    );

    expect(result).toMatchObject({ status: "rejected", detail: "not_sent" });
    expect(fake.calls.length).toBe(before);
  });

  it("sends nothing without the credential master keys, and logs why", async () => {
    const c = await connection();
    const before = fake.calls.length;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await execute(
      executorWith(() => {
        throw new Error("Connection credential master keys are not configured");
      }),
      c,
    );

    expect(result).toMatchObject({ status: "rejected", detail: "not_sent" });
    expect(fake.calls.length).toBe(before);
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
  });

  it("never knows what became of a write left in flight", async () => {
    expect(
      await executorWith(() => credentials).lookup("action-1:1", {
        studentId: "s",
      }),
    ).toEqual({ status: "unknown" });
  });
});
