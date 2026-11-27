/**
 * The gate's `integration` executor (#272, ADR-0028): one write tool call through a Connection, with its own client,
 * fresh credentials and no retry. A write that may have reached the service and got no answer is `ambiguous`, so the
 * gate records it Unconfirmed, and `lookup` never knows better.
 */
import type { MCPClient } from "@ai-sdk/mcp";
import { MCPClientError } from "@ai-sdk/mcp";
import type { PrismaClient } from "@nunio/db";
import type { Executor, ExecutorResult } from "@nunio/delegation";
import { principal } from "@nunio/delegation";
import type { ConnectionCredentialKeys } from "@nunio/keys";
import type { McpServer, Tap } from "./reads.js";
import { connect, serverOf } from "./reads.js";
import type { ToolResult } from "./shape.js";
import { shapeError, shapeResult } from "./shape.js";

/** How long a write may take, as the gate waits for it; the transport gives up then too. */
export const WRITE_TIMEOUT_MS = 60_000;

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
 * Calls one write tool on an MCP server with a client of its own and no retry. `signal` is the gate's timeout: it
 * may stop opening the session, which must also be done in `WRITE_TIMEOUT_MS`, but a call once sent is never
 * aborted, so the transport itself never times out. Past `signal` the write is `ambiguous`, and the client is closed
 * whenever the call settles.
 */
export async function callMcpWrite(
  server: () => Promise<McpServer>,
  toolName: string,
  args: Record<string, unknown>,
  { fakes, signal }: { fakes: boolean; signal: AbortSignal },
): Promise<ExecutorResult> {
  let sent = false;
  const tap: Tap = (send) => async (input, init) => {
    const call = isToolCall(init);
    if (call) sent = true;
    try {
      return await send(input, init);
    } catch (error) {
      if (call && neverConnected(error)) sent = false;
      throw error;
    }
  };
  let client: MCPClient;
  try {
    client = await connect(await server(), {
      fakes,
      // No connect, headers or body timeout: the session's opening has `until`, and a sent call never times out.
      timeoutMs: 0,
      signal,
      until: Date.now() + WRITE_TIMEOUT_MS,
      tap,
    });
  } catch (error) {
    return sessionFailure(error);
  }
  // No signal: the call is never cancelled once it may have gone out.
  const call = client.callTool({ name: toolName, arguments: args });
  const close = () => void client.close().catch(() => {});
  call.then(close, close);
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
  return "timedOut" in answer ? lost(sent) : outcomeOf(answer, sent);
}

/**
 * The gate's executor for Integration Actions. It loads the Connection's credentials at each call; `credentials` is
 * read then too, so a process without the master keys fails a write as not sent instead of failing to start.
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
