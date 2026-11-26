import { createHash, randomBytes } from "node:crypto";
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
