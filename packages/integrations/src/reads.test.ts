import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openMcpReads } from "./reads.js";
import type { FakeMcpServer } from "./testing.js";
import { startFakeMcpServer } from "./testing.js";

let fake: FakeMcpServer;
let accessToken: string;

/** An access token from the fake, through DCR and PKCE as a vendor would issue one. */
async function tokenFrom(server: FakeMcpServer) {
  const redirect = "http://localhost/callback";
  const client = (await (
    await fetch(`${server.url}/register`, {
      method: "POST",
      body: JSON.stringify({
        redirect_uris: [redirect],
        token_endpoint_auth_method: "none",
      }),
    })
  ).json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const authorize = new URL(`${server.url}/authorize`);
  for (const [name, value] of Object.entries({
    client_id: client.client_id,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    resource: server.mcpUrl,
  }))
    authorize.searchParams.set(name, value);
  const back = new URL(
    (await fetch(authorize, { redirect: "manual" })).headers.get("location")!,
  );
  const tokens = (await (
    await fetch(`${server.url}/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: back.searchParams.get("code")!,
        code_verifier: verifier,
        redirect_uri: redirect,
        client_id: client.client_id,
      }),
    })
  ).json()) as { access_token: string };
  return tokens.access_token;
}

beforeAll(async () => {
  fake = await startFakeMcpServer();
  accessToken = await tokenFrom(fake);
});

afterAll(async () => {
  await fake?.stop();
});

const signal = () => AbortSignal.timeout(60_000);
const callsTo = (tool: string) =>
  fake.calls.filter((call) => call.tool === tool).length;

function session(fakes = true) {
  return openMcpReads(
    async () => ({ mcpUrl: fake.mcpUrl, transport: "http", accessToken }),
    { fakes },
  );
}

describe("reading through an MCP Connection", () => {
  it("reaches a server only over https outside INTEGRATION_FAKES", async () => {
    const before = fake.calls.length;
    const reads = session(false);

    const read = await reads.read(
      "notes.search",
      { query: "Lenz" },
      { signal: signal() },
    );
    await reads.close();

    expect(read).toEqual({
      outcome: "failed",
      text: "The service could not be reached.",
    });
    expect(fake.calls.length).toBe(before);
  });

  it("retries a dropped call once", async () => {
    const reads = session();
    const before = callsTo("notes.read");
    fake.script("notes.read", { kind: "drop" });

    const read = await reads.read(
      "notes.read",
      { id: "note-1" },
      { signal: signal() },
    );
    await reads.close();

    expect(read.outcome).toBe("answered");
    expect(read.text).toContain("Lineare Algebra");
    expect(callsTo("notes.read") - before).toBe(2);
  });

  it("doesn't retry when the service asks to wait longer than 5 s", async () => {
    const reads = session();
    const before = callsTo("notes.read");
    fake.script("notes.read", { kind: "http", status: 429, retryAfter: 6 });

    const read = await reads.read(
      "notes.read",
      { id: "note-1" },
      { signal: signal() },
    );
    await reads.close();

    expect(read).toEqual({
      outcome: "failed",
      text: "The service is unavailable (HTTP 429).",
    });
    expect(callsTo("notes.read") - before).toBe(1);
  });

  it("gives up after its one retry", async () => {
    const reads = session();
    const before = callsTo("notes.read");
    fake.script(
      "notes.read",
      { kind: "http", status: 503 },
      { kind: "http", status: 503 },
    );

    const read = await reads.read(
      "notes.read",
      { id: "note-1" },
      { signal: signal() },
    );
    await reads.close();

    expect(read).toEqual({
      outcome: "failed",
      text: "The service is unavailable (HTTP 503).",
    });
    expect(callsTo("notes.read") - before).toBe(2);
  });

  it("stops waiting when the turn ends", async () => {
    const reads = session();
    fake.script("notes.read", { kind: "hang" });
    const turn = new AbortController();

    const read = reads.read(
      "notes.read",
      { id: "note-1" },
      { signal: turn.signal },
    );
    setTimeout(() => turn.abort(new Error("turn ended")), 200);

    await expect(read).rejects.toThrow("turn ended");
    await reads.close();
  });
});

/** What a scripted server does with one MCP message: answer with a status and JSON body, or drop the connection. */
type Scripted =
  | { status: number; headers?: Record<string, string>; body?: unknown }
  | "drop";

/** A JSON-RPC result for the request `id`. */
const result = (id: unknown, value: unknown): Scripted => ({
  status: 200,
  body: { jsonrpc: "2.0", id, result: value },
});

const initialized = (id: unknown) =>
  result(id, {
    protocolVersion: "2025-11-25",
    capabilities: { tools: {} },
    serverInfo: { name: "scripted", version: "1.0.0" },
  });

/**
 * A Streamable HTTP server whose answers a test scripts per message. A notification gets 202; a GET (an event stream)
 * is held open unanswered. It records each POST's method and when it arrived.
 */
async function scriptedServer(
  answer: (message: {
    id?: unknown;
    method: string;
  }) => Promise<Scripted> | Scripted,
) {
  const received: { method: string; at: number }[] = [];
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== "POST") return;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const message = JSON.parse(Buffer.concat(chunks).toString()) as {
        id?: unknown;
        method: string;
      };
      received.push({ method: message.method, at: Date.now() });
      if (message.id === undefined) return void res.writeHead(202).end();
      const scripted = await answer(message);
      if (scripted === "drop") return void req.socket.destroy();
      res
        .writeHead(scripted.status, {
          "content-type": "application/json",
          ...scripted.headers,
        })
        .end(JSON.stringify(scripted.body ?? {}));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    mcpUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`,
    received,
    stop: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

describe("reading through a legacy SSE server", () => {
  let sse: FakeMcpServer;
  let sseToken: string;

  beforeAll(async () => {
    sse = await startFakeMcpServer({ legacySse: true });
    sseToken = await tokenFrom(sse);
  });

  afterAll(async () => {
    await sse?.stop();
  });

  const sseCalls = (tool: string) =>
    sse.calls.filter((call) => call.tool === tool).length;

  it("falls back to SSE when the server has no Streamable HTTP", async () => {
    const reads = openMcpReads(
      async () => ({
        mcpUrl: sse.mcpUrl,
        transport: "http",
        accessToken: sseToken,
      }),
      { fakes: true },
    );

    const read = await reads.read(
      "notes.read",
      { id: "note-1" },
      { signal: signal() },
    );
    await reads.close();

    expect(read.outcome).toBe("answered");
    expect(read.text).toContain("Lineare Algebra");
  });

  it("opens a new stream for its one retry after the stream dropped", async () => {
    const reads = openMcpReads(
      async () => ({
        mcpUrl: sse.mcpUrl,
        transport: "sse",
        accessToken: sseToken,
      }),
      { fakes: true, timeoutMs: 1_000 },
    );
    const before = sseCalls("notes.read");
    sse.script("notes.read", { kind: "drop" });
    // A rejection nothing handles would take the API process down.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      const read = await reads.read(
        "notes.read",
        { id: "note-1" },
        { signal: signal() },
      );
      await reads.close();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(read.outcome).toBe("answered");
      expect(read.text).toContain("Lineare Algebra");
      expect(sseCalls("notes.read") - before).toBe(2);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("waiting before a retry", () => {
  it("has every read that waited on opening honour the Retry-After the service named", async () => {
    const server = await scriptedServer(() => ({
      status: 429,
      headers: { "retry-after": "10" },
    }));
    const reads = openMcpReads(
      async () => ({ mcpUrl: server.mcpUrl, transport: "http", accessToken }),
      { fakes: true },
    );

    const both = await Promise.all(
      ["note-1", "note-2"].map((id) =>
        reads.read("notes.read", { id }, { signal: signal() }),
      ),
    );
    await reads.close();
    await server.stop();

    expect(both).toEqual([
      { outcome: "failed", text: "The service is unavailable (HTTP 429)." },
      { outcome: "failed", text: "The service is unavailable (HTTP 429)." },
    ]);
    // Opened once, discovering and then initializing; neither read tried again.
    expect(server.received.map((r) => r.method)).toEqual([
      "server/discover",
      "initialize",
    ]);
  });

  it("forgets a Retry-After once a later request answered", async () => {
    let called = 0;
    const server = await scriptedServer((message) => {
      if (message.method === "server/discover")
        return { status: 429, headers: { "retry-after": "10" } };
      if (message.method === "initialize") return initialized(message.id);
      called += 1;
      return called === 1
        ? "drop"
        : result(message.id, { content: [{ type: "text", text: "Notiz" }] });
    });
    const reads = openMcpReads(
      async () => ({ mcpUrl: server.mcpUrl, transport: "http", accessToken }),
      { fakes: true },
    );

    const read = await reads.read(
      "notes.read",
      { id: "note-1" },
      { signal: signal() },
    );
    await reads.close();
    await server.stop();

    expect(read.outcome).toBe("answered");
    expect(called).toBe(2);
  });
});

describe("a read's deadline", () => {
  it("covers opening the client, the SSE fallback included", async () => {
    // Streamable HTTP is refused slowly; the SSE stream then never names its endpoint.
    const server = await scriptedServer(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { status: 405 };
    });
    const reads = openMcpReads(
      async () => ({ mcpUrl: server.mcpUrl, transport: "http", accessToken }),
      { fakes: true, timeoutMs: 600 },
    );

    const read = await reads.read(
      "notes.read",
      { id: "note-1" },
      { signal: signal() },
    );
    await reads.close();
    await server.stop();

    expect(read.outcome).toBe("failed");
    // Each attempt ends at its 600 ms deadline; the retry follows 500 ms later.
    const attempts = server.received.filter(
      (r) => r.method === "server/discover",
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.at - attempts[0]!.at).toBeLessThan(1_300);
  });
});
