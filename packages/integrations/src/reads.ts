/**
 * Reading through a Connection (#272, ADR-0028): a session per turn or step and Connection that opens its client on
 * the first call and closes when the turn or step ends. Each read gets 30 s, and one retry after a transport failure,
 * a 429 or a 5xx; what the model sees of it is shaped first (see `shape.ts`).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import type { MCPClient } from "@ai-sdk/mcp";
import { createMCPClient, MCPClientError } from "@ai-sdk/mcp";
import type { PrismaClient } from "@nunio/db";
import type { Principal } from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";
import type { ConnectionCredentialKeys } from "@nunio/keys";
import { publicFetch } from "./public-fetch.js";
import type { ToolResult } from "./shape.js";
import { shapeError, shapeResult } from "./shape.js";

/** How long one read call may take, retry not included. */
export const READ_TIMEOUT_MS = 30_000;

/** The longest `Retry-After` nunio waits before its one retry; a service asking for longer isn't retried. */
const MAX_RETRY_AFTER_MS = 5_000;

/** How long nunio waits before its retry when the service names no time. */
const DEFAULT_RETRY_DELAY_MS = 500;

/** One read as the model gets it: answered or failed, with text that is either fenced service text or nunio's own. */
export interface ReadResult {
  outcome: "answered" | "failed";
  text: string;
}

/** A Connection's reads for one turn or step. Nothing is opened until the first read. */
export interface ReadSession {
  /** Calls a read tool by the server's own name. Throws only when `signal` aborts. */
  read(
    toolName: string,
    args: Record<string, unknown>,
    options: { signal: AbortSignal },
  ): Promise<ReadResult>;
  /** Closes the client, if a read opened one. */
  close(): Promise<void>;
}

/** Where an MCP Connection is read: its catalog server, and the student's access token. */
export interface McpServer {
  mcpUrl: string;
  /** http (Streamable HTTP, with SSE as the fallback) or sse. */
  transport: string;
  accessToken: string;
}

/** The Connection can't be read: gone, not Connected, or not an MCP Integration. */
class Unavailable extends Error {}

/** The `Retry-After` of the response a read got, set by the fetch inside that read's own async context. */
const retryAfter = new AsyncLocalStorage<{ ms?: number }>();

/** A `Retry-After` value in milliseconds: delay seconds or an HTTP date. */
function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (value.trim() !== "" && Number.isFinite(seconds))
    return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/**
 * The fetch an MCP client gets: only the catalog's server (its URL for Streamable HTTP, its origin for SSE, whose
 * endpoint the server names), through `publicFetch`, noting a 429's or a 5xx's `Retry-After` for the read under way.
 */
function serverFetch(
  mcpUrl: string,
  type: "http" | "sse",
  fakes: boolean,
): typeof fetch {
  const base = publicFetch(fakes, {
    timeoutMs: READ_TIMEOUT_MS,
    purpose: "MCP",
  });
  const server = new URL(mcpUrl);
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (
      url.origin !== server.origin ||
      (type === "http" && url.href !== server.href)
    )
      throw new Error("MCP requests go only to the Integration's server");
    const response = await base(input, init);
    if (response.status === 429 || response.status >= 500) {
      const observed = retryAfter.getStore();
      if (observed)
        observed.ms = retryAfterMs(response.headers.get("retry-after"));
    }
    return response;
  };
}

/** Whether the server doesn't speak Streamable HTTP, so SSE is worth a try. */
const noStreamableHttp = (error: unknown) =>
  MCPClientError.isInstance(error) &&
  (error.statusCode === 404 || error.statusCode === 405);

/**
 * Opens an MCP client to the server, over Streamable HTTP with SSE as the fallback, or SSE when the row says so.
 * Listing the server's tools against the pins comes with drift (#295).
 */
async function connect(
  server: McpServer,
  fakes: boolean,
  signal: AbortSignal,
): Promise<MCPClient> {
  const open = (type: "http" | "sse") =>
    createMCPClient({
      transport: {
        type,
        url: server.mcpUrl,
        headers: { authorization: `Bearer ${server.accessToken}` },
        redirect: "error",
        fetch: serverFetch(server.mcpUrl, type, fakes),
      },
      initializationOptions: { signal, timeout: READ_TIMEOUT_MS },
      maxRetries: 0,
    });
  if (server.transport === "sse") return open("sse");
  try {
    return await open("http");
  } catch (error) {
    if (!noStreamableHttp(error)) throw error;
    return open("sse");
  }
}

/** What nunio makes of a failed read: the service's own error, a refusal not worth retrying, or one worth a retry. */
function failureOf(
  error: unknown,
):
  | { kind: "service"; message: string }
  | { kind: "final" | "retry"; text: string } {
  if (error instanceof Unavailable)
    return {
      kind: "final",
      text: "This Connection can't be read right now.",
    };
  if (MCPClientError.isInstance(error)) {
    // A JSON-RPC error is the service's answer: its message is service text. A 401 or 403 is final like any 4xx
    // until refreshing and Needs reconnection come (#304).
    if (error.code !== undefined)
      return { kind: "service", message: error.message };
    const status = error.statusCode;
    if (status === 429 || (status !== undefined && status >= 500))
      return {
        kind: "retry",
        text: `The service is unavailable (HTTP ${status}).`,
      };
    if (status !== undefined)
      return {
        kind: "final",
        text: `The service refused the request (HTTP ${status}).`,
      };
  }
  return { kind: "retry", text: "The service could not be reached." };
}

/**
 * A read session on an MCP server. A read retries once after a transport failure, a 429 or a 5xx, after the
 * `Retry-After` the service names (at most 5 s) and within `signal`; a tool error, a JSON-RPC error or another 4xx
 * is final.
 */
export function openMcpReads(
  server: () => Promise<McpServer>,
  { fakes }: { fakes: boolean },
): ReadSession {
  let client: Promise<MCPClient> | undefined;
  const opened = (signal: AbortSignal) => {
    client ??= server()
      .then((resolved) => connect(resolved, fakes, signal))
      .catch((error: unknown) => {
        // Opened again by the retry or the next read.
        client = undefined;
        throw error;
      });
    return client;
  };
  return {
    async read(toolName, args, { signal }) {
      for (let attempt = 1; ; attempt++) {
        const observed: { ms?: number } = {};
        try {
          // 30 s for the call, opening the client included.
          const until = Date.now() + READ_TIMEOUT_MS;
          const called = await retryAfter.run(observed, async () =>
            (await opened(signal)).callTool({
              name: toolName,
              arguments: args,
              options: { signal, timeout: Math.max(1, until - Date.now()) },
            }),
          );
          // A legacy server's result is a bare `toolResult`.
          const result: ToolResult =
            "toolResult" in called
              ? { structuredContent: called.toolResult }
              : called;
          return {
            outcome: result.isError ? "failed" : "answered",
            text: shapeResult(result),
          };
        } catch (error) {
          signal.throwIfAborted();
          const failure = failureOf(error);
          if (failure.kind === "service")
            return { outcome: "failed", text: shapeError(failure.message) };
          const wait = observed.ms ?? DEFAULT_RETRY_DELAY_MS;
          if (
            failure.kind === "final" ||
            attempt > 1 ||
            wait > MAX_RETRY_AFTER_MS
          )
            return { outcome: "failed", text: failure.text };
          await sleep(wait, undefined, { signal });
        }
      }
    },
    async close() {
      const open = client;
      client = undefined;
      await open?.then((c) => c.close()).catch(() => {});
    },
  };
}

/** Reads through a student's Connections, under their owner context; credentials never leave this module. */
export function createIntegrationReads({
  db,
  credentials,
  fakes,
}: {
  db: PrismaClient;
  credentials: ConnectionCredentialKeys;
  fakes: boolean;
}) {
  /** The Connection's server and token, if it is the student's, Connected, and through an MCP Integration. */
  async function serverOf(
    p: Principal,
    connectionId: string,
  ): Promise<McpServer> {
    const row = await withOwner(db, p, (tx) =>
      tx.connection.findFirst({
        where: { id: connectionId, state: "connected" },
        include: { credential: true, integration: true },
      }),
    );
    const { integration, credential } = row ?? {};
    if (!row || !credential || integration?.kind !== "mcp")
      throw new Unavailable();
    if (!integration.mcpUrl) throw new Unavailable();
    const { accessToken } = JSON.parse(
      credentials.open(row.id, {
        version: credential.keyVersion,
        ciphertext: credential.ciphertext,
      }),
    ) as { accessToken: string };
    return {
      mcpUrl: integration.mcpUrl,
      transport: integration.transport ?? "http",
      accessToken,
    };
  }
  return {
    /** A lazy read session on one of the student's Connections; it reads the credentials at its first read. */
    open(p: Principal, connectionId: string): ReadSession {
      return openMcpReads(() => serverOf(p, connectionId), { fakes });
    },
  };
}

export type IntegrationReads = ReturnType<typeof createIntegrationReads>;
