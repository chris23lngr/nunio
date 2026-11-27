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

/** A failure to open the session: nothing was sent, or the service refused the credentials. */
function unopened(error: unknown) {
  const status = MCPClientError.isInstance(error)
    ? error.statusCode
    : undefined;
  if (status === 401 || status === 403)
    return failed(
      "needs_reconnection",
      "The service refused the Connection's sign-in; the student must reconnect it. Nothing was sent.",
    );
  return failed(
    "not_sent",
    "The service could not be reached. Nothing was sent.",
  );
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
    if (status === 401 || status === 403)
      return failed(
        "needs_reconnection",
        `The service refused the Connection's sign-in (HTTP ${status}); the student must reconnect it.`,
      );
    // A 5xx may have been applied before it failed.
    if (status !== undefined && status >= 500) return { status: "ambiguous" };
    if (status !== undefined)
      return failed(
        "service_error",
        `The service refused the call (HTTP ${status}).`,
      );
  }
  // The connection dropped: after the call went out, nobody knows whether it was applied.
  return sent
    ? { status: "ambiguous" }
    : failed("not_sent", "The service could not be reached. Nothing was sent.");
}

/**
 * Calls one write tool on an MCP server with a client of its own and no retry. `signal` is the gate's timeout: it
 * may stop opening the session, but a call once sent is never aborted. Past it the write is `ambiguous`, and the
 * client is closed whenever the call settles.
 */
export async function callMcpWrite(
  server: () => Promise<McpServer>,
  toolName: string,
  args: Record<string, unknown>,
  {
    fakes,
    signal,
    timeoutMs = WRITE_TIMEOUT_MS,
  }: {
    fakes: boolean;
    signal: AbortSignal;
    /** How long the transport waits; a test seam. */
    timeoutMs?: number;
  },
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
      timeoutMs,
      signal,
      until: Date.now() + timeoutMs,
      tap,
    });
  } catch (error) {
    return unopened(error);
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
  if ("timedOut" in answer)
    return sent
      ? { status: "ambiguous" }
      : failed(
          "not_sent",
          "The service could not be reached. Nothing was sent.",
        );
  return outcomeOf(answer, sent);
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
