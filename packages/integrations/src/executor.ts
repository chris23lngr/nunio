/**
 * The gate's `integration` executor (#272, ADR-0028): one write tool call through a Connection, with its own client,
 * fresh credentials and no retry. A write that may have reached the service and got no answer is `ambiguous`, so the
 * gate records it Unconfirmed, and `lookup` never knows better.
 */

import { setTimeout as sleep } from "node:timers/promises";
import type { MCPClient } from "@ai-sdk/mcp";
import { MCPClientError } from "@ai-sdk/mcp";
import type { PrismaClient } from "@nunio/db";
import type { Executor, ExecutorResult } from "@nunio/delegation";
import { principal } from "@nunio/delegation";
import type { ConnectionCredentialKeys } from "@nunio/keys";
import { publicFetch } from "./public-fetch.js";
import type { McpServer } from "./reads.js";
import { connect, serverOf, Unavailable } from "./reads.js";
import type { ToolResult } from "./shape.js";
import { shapeError, shapeResult } from "./shape.js";

/** How long the gate waits for a write; opening its session must be done in that time too. */
export const WRITE_TIMEOUT_MS = 60_000;

/** How long making a connection may take; a handshake that never completes sent nothing. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * How long a sent write may take to answer at all. Past the gate's 60 s it is Unconfirmed, but it runs on to its own
 * answer or this bound, and only then are its connection, client and access token let go.
 */
const ANSWER_TIMEOUT_MS = 5 * 60_000;

/** How long closing a write's client may take before its connections are cut. */
const CLOSE_TIMEOUT_MS = 5_000;

/** Why nunio failed a write: the only failure it stores. The service's own text goes to the model alone. */
export type WriteFailure = "service_error" | "not_sent" | "needs_reconnection";

const failed = (
  detail: WriteFailure,
  result: string,
): Extract<ExecutorResult, { status: "rejected" }> => ({
  status: "rejected",
  detail,
  result,
});

/** Network errors that mean the request never reached the service: no connection was made. */
const unsentCodes = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
]);

/** Whether a fetch failed before any connection was made, through its chain of causes. */
function neverConnected(error: unknown): boolean {
  for (let e = error; e && typeof e === "object"; e = (e as Error).cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && unsentCodes.has(code)) return true;
  }
  return false;
}

/** Whether a request to the server is the tool call itself, not opening the session. */
function isToolCall(init: RequestInit | undefined) {
  if (typeof init?.body !== "string") return false;
  try {
    return (
      (JSON.parse(init.body) as { method?: unknown }).method === "tools/call"
    );
  } catch {
    return false;
  }
}

/** The write never reached the service. */
const notSent = () =>
  failed("not_sent", "The service could not be reached. Nothing was sent.");

/** The service refused the Connection's sign-in, which only reconnecting fixes. */
const refusedSignIn = (status: number) =>
  failed(
    "needs_reconnection",
    `The service refused the Connection's sign-in (HTTP ${status}); the student must reconnect it.`,
  );

const statusOf = (error: unknown) =>
  MCPClientError.isInstance(error) ? error.statusCode : undefined;

/** A failure to open the session, before any call went out. */
function sessionFailure(error: unknown) {
  const status = statusOf(error);
  return status === 401 || status === 403 ? refusedSignIn(status) : notSent();
}

/** What a tool call's answer, or its failure after it was sent, makes of the write. */
function outcomeOf(
  answer: { ok: true; value: ToolResult } | { ok: false; error: unknown },
  sent: boolean,
): ExecutorResult {
  if (answer.ok) {
    const text = shapeResult(answer.value);
    return answer.value.isError
      ? failed("service_error", text)
      : { status: "done", effect: {}, result: text };
  }
  const { error } = answer;
  if (MCPClientError.isInstance(error)) {
    // A JSON-RPC error is the service's answer: it took no effect, and its message is service text.
    if (error.code !== undefined)
      return failed("service_error", shapeError(error.message));
    const status = error.statusCode;
    if (status === 401 || status === 403) return refusedSignIn(status);
    // A 5xx may have been applied before it failed.
    if (status !== undefined && status >= 500) return { status: "ambiguous" };
    if (status !== undefined)
      return failed(
        "service_error",
        `The service refused the call (HTTP ${status}).`,
      );
  }
  return lost(sent);
}

/** No answer: once the call went out, nobody knows whether it was applied. */
const lost = (sent: boolean): ExecutorResult =>
  sent ? { status: "ambiguous" } : notSent();

/**
 * Wraps how a write's requests are sent, to know whether its call went out. The call counts as sent from the moment
 * it is handed on, unless no connection could be made. Once `signal` has aborted, the call is never handed on: the
 * gate has then recorded it as not sent, so it must not go out later.
 */
export function guardedSend(base: typeof fetch, signal: AbortSignal) {
  let sent = false;
  const send = (async (input, init) => {
    const call = isToolCall(init);
    if (call) {
      if (signal.aborted)
        throw new Error("The write's time ran out before its call was sent");
      sent = true;
    }
    try {
      return await base(input, init);
    } catch (error) {
      if (call && neverConnected(error)) sent = false;
      throw error;
    }
  }) as typeof fetch;
  return { send, sent: () => sent };
}

/** Whether a failure to load the Connection or open its session is one nunio expects, not a fault to look into. */
const expected = (error: unknown) =>
  error instanceof Unavailable ||
  MCPClientError.isInstance(error) ||
  (error instanceof TypeError && error.message === "fetch failed");

/**
 * Calls one write tool on an MCP server with a client of its own and no retry. `signal` is the gate's timeout: it
 * may stop opening the session, but a call once sent is never aborted by it. Past `signal` the write is `ambiguous`;
 * the call runs on to its own answer or `ANSWER_TIMEOUT_MS`, then its client and connections are let go.
 */
export async function callMcpWrite(
  server: () => Promise<McpServer>,
  toolName: string,
  args: Record<string, unknown>,
  {
    fakes,
    signal,
    allowed,
    answerTimeoutMs = ANSWER_TIMEOUT_MS,
  }: {
    fakes: boolean;
    signal: AbortSignal;
    /** Which addresses count as public; a test seam. */
    allowed?: (address: string) => boolean;
    /** How long a sent call may take to answer at all; a test seam. */
    answerTimeoutMs?: number;
  },
): Promise<ExecutorResult> {
  const transport = publicFetch(fakes, {
    timeoutMs: CONNECT_TIMEOUT_MS,
    headersTimeoutMs: answerTimeoutMs,
    bodyTimeoutMs: answerTimeoutMs,
    purpose: "MCP",
    ...(allowed && { allowed }),
  });
  const guard = guardedSend(transport, signal);
  let client: MCPClient;
  try {
    client = await connect(await server(), {
      fakes,
      timeoutMs: CONNECT_TIMEOUT_MS,
      signal,
      until: Date.now() + WRITE_TIMEOUT_MS,
      send: guard.send,
    });
  } catch (error) {
    void transport.destroy().catch(() => {});
    // Nothing was sent either way; a fault such as missing master keys or a database error is logged to be fixed.
    if (!expected(error))
      console.error(
        JSON.stringify({
          msg: "an Integration write could not be opened",
          error: error instanceof Error ? error.name : typeof error,
          message: error instanceof Error ? error.message : undefined,
        }),
      );
    return sessionFailure(error);
  }
  /** Lets the write's client and connections go, however its client's closing goes. */
  const release = async () => {
    await Promise.race([
      client.close().catch(() => {}),
      sleep(CLOSE_TIMEOUT_MS, undefined, { ref: false }),
    ]);
    await transport.destroy().catch(() => {});
  };
  // The gate gave up while the session opened: the call is never made.
  if (signal.aborted) {
    void release();
    return notSent();
  }
  // Not the gate's signal: the call is never cancelled because the gate stopped waiting.
  const call = client.callTool({
    name: toolName,
    arguments: args,
    options: { timeout: answerTimeoutMs },
  });
  call.then(release, release);
  const answer = await new Promise<
    | { ok: true; value: ToolResult }
    | { ok: false; error: unknown }
    | { ok: false; timedOut: true }
  >((resolve) => {
    const onAbort = () => resolve({ ok: false, timedOut: true });
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    call.then(
      (called) => {
        signal.removeEventListener("abort", onAbort);
        // A legacy server's result is a bare `toolResult`.
        resolve({
          ok: true,
          value:
            "toolResult" in called
              ? { structuredContent: called.toolResult }
              : called,
        });
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        resolve({ ok: false, error });
      },
    );
  });
  return "timedOut" in answer
    ? lost(guard.sent())
    : outcomeOf(answer, guard.sent());
}

/**
 * The gate's executor for Integration Actions. It loads the Connection's credentials at each call; `credentials` is
 * read then too, so a process without the master keys fails a write as not sent, and logs why, instead of failing to
 * start. Throwing instead would make the gate record the write Unconfirmed, as `lookup` never knows better.
 */
export function createIntegrationExecutor({
  db,
  credentials,
  fakes,
}: {
  db: PrismaClient;
  credentials: () => ConnectionCredentialKeys;
  fakes: boolean;
}): Executor {
  return {
    async execute({ studentId, intent }, { signal }) {
      if (intent.kind !== "integration.call")
        throw new Error(
          `The integration executor can't perform ${intent.kind}`,
        );
      return callMcpWrite(
        () =>
          serverOf(
            { db, credentials: credentials() },
            principal.fromSession({ studentId }),
            intent.connectionId,
          ),
        intent.toolName,
        intent.arguments,
        { fakes, signal },
      );
    },
    // No MCP server honours nunio's idempotency keys, so a write left in flight is never known and never retried.
    async lookup() {
      return { status: "unknown" };
    },
  };
}
