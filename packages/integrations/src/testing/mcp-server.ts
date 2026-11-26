/**
 * A fake vendor MCP server: "Testnotizen" over Streamable HTTP, which is also its own OAuth authorization server.
 *
 * It serves Protected Resource Metadata, AS metadata, DCR and CIMD client ids, an authorize endpoint that approves at
 * once, PKCE (S256), `resource` and `iss`, rotating refresh tokens and revocation.
 */
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Socket } from "node:net";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type {
  AuthInfo,
  CallToolResult,
  Tool,
} from "@modelcontextprotocol/server";
import {
  createMcpHandler,
  ProtocolError,
  ProtocolErrorCode,
  Server,
} from "@modelcontextprotocol/server";
import { createTestnotizen, testnotizenTools } from "./testnotizen.js";

export interface FakeMcpServerOptions {
  /** Default `127.0.0.1`. */
  host?: string;
  /** Default `0`, an ephemeral port. */
  port?: number;
  /** Serve HTTPS with this key and certificate (PEM). */
  tls?: { key: string | Buffer; cert: string | Buffer };
  /** The origin clients reach the server at, if not the bound address (e.g. `https://mcp.nunio.test:8446`). */
  url?: string;
  /** Seconds an access token lives. Default 3600. */
  tokenLifetime?: number;
  /** The account name each token response carries as `workspace_name`, as Notion's does. Default "Testnotizen". */
  workspaceName?: string;
  /**
   * Speak only legacy SSE: a GET on the MCP URL opens the event stream and names the endpoint to POST to, and a POST
   * on the MCP URL is refused with 405, as by a server without Streamable HTTP.
   */
  legacySse?: boolean;
}

/** What the next authorization does instead of approving: redirect with `error=access_denied`, or name a wrong `iss`. */
export type AuthorizationFault = "access-denied" | "wrong-iss";

/** What one scripted `tools/call` gets instead of the service's answer. */
export type McpFault =
  /** A result with `isError: true`. */
  | { kind: "tool-error"; message?: string }
  /** A JSON-RPC error instead of a result. Default code -32603 (internal error). */
  | { kind: "rpc-error"; code?: number; message?: string }
  /**
   * An HTTP error instead of a result: a 4xx, a 5xx, or 429 with `Retry-After` in seconds. A 401 carries the Bearer
   * challenge with `error="invalid_token"`, and a 403 the one with `error="insufficient_scope"`.
   */
  | { kind: "http"; status: number; retryAfter?: number }
  /** Answers normally, `ms` milliseconds late. */
  | { kind: "delay"; ms: number }
  /** Never answers; the request stays open until the server stops. */
  | { kind: "hang" }
  /**
   * Closes the connection without answering, after the call was received and recorded. Over legacy SSE it closes the
   * session's event stream, which ends the session.
   */
  | { kind: "drop" }
  /** A result that is only a 2 KB PNG, 4 KB of MP3 audio, or an 8 KB PDF resource. */
  | { kind: "image" | "audio" | "binary-resource" }
  /** A text result of exactly `characters` characters. */
  | { kind: "oversize"; characters: number };

/** The faults the service answers itself, rather than the HTTP layer. */
type ServiceFault = Exclude<
  McpFault,
  { kind: "hang" | "drop" | "http" | "delay" }
>;

export interface FakeMcpServer {
  /** The origin, which is also the authorization server's issuer. */
  url: string;
  /** The Streamable HTTP endpoint and OAuth resource. */
  mcpUrl: string;
  /** Every `tools/call` that reached the service with a valid token, in order. */
  readonly calls: readonly ReceivedCall[];
  /** How many requests reached the MCP endpoint at all, opening a session included, with a valid token or not. */
  readonly mcpRequests: number;
  /** Every request to the token endpoint, in order, whether it succeeded or not. */
  readonly tokenRequests: readonly TokenRequest[];
  /** Every request to the revocation endpoint, in order. */
  readonly revocations: readonly Revocation[];
  /** Queues faults for `tool`'s next calls: each call spends one, in order, and then the tool answers normally. */
  script(tool: string, ...faults: McpFault[]): void;
  /** Queues faults for the next authorizations, one each, in order; then authorizations approve again. */
  scriptAuthorization(...faults: AuthorizationFault[]): void;
  /** Replaces the Protected Resource Metadata it serves, answers it with 404 for `null`, or restores it when omitted. */
  setProtectedResourceMetadata(metadata?: Record<string, unknown> | null): void;
  /** Drift: adds a tool, or changes the definition of one with the same name. */
  setTool(definition: Tool): void;
  /** Drift: removes a tool. */
  removeTool(name: string): void;
  /** Expires every access token issued so far, so the next call gets a 401. */
  expireAccessTokens(): void;
  /** Answers every refresh token issued so far with `invalid_grant`. */
  invalidateRefreshTokens(): void;
  stop(): Promise<void>;
}

export interface ReceivedCall {
  tool: string;
  arguments: Record<string, unknown>;
  /** The access token it carried. */
  token: string;
}

export interface TokenRequest {
  grantType: string;
  /** The client id it presented. */
  clientId?: string;
  /** The `resource` it named (RFC 8707), if any. */
  resource?: string;
}

export interface Revocation {
  token: string;
  /** The client id it presented. */
  clientId?: string;
}

interface Client {
  redirectUris: string[];
  /** Absent for a public client. */
  secret?: string;
}

/** One OAuth authorization: a code, then the tokens issued from it. */
interface Authorization {
  id: string;
  clientId: string;
}

interface Code extends Authorization {
  redirectUri: string;
  challenge: string;
  expiresAt: number;
}

interface AccessToken extends Authorization {
  expiresAt: number;
}

export async function startFakeMcpServer(
  options: FakeMcpServerOptions = {},
): Promise<FakeMcpServer> {
  const tokenLifetime = options.tokenLifetime ?? 3600;
  const workspaceName = options.workspaceName ?? "Testnotizen";
  const clients = new Map<string, Client>();
  const codes = new Map<string, Code>();
  const accessTokens = new Map<string, AccessToken>();
  const refreshTokens = new Map<string, Authorization>();
  const calls: ReceivedCall[] = [];
  let mcpRequests = 0;
  const tokenRequests: TokenRequest[] = [];
  const revocations: Revocation[] = [];
  const authorizationFaults: AuthorizationFault[] = [];
  const scripts = new Map<string, McpFault[]>();
  const tools = new Map<string, Tool>(
    testnotizenTools.map((tool) => [tool.name, tool]),
  );
  const testnotizen = createTestnotizen();
  // Set once the server listens, before any request arrives.
  let issuer = "";
  let mcpUrl = "";
  /** Legacy SSE sessions by id, each with the event stream its answers go back on. */
  const sseSessions = new Map<string, ServerResponse>();
  /** Replaces the default Protected Resource Metadata; `null` answers 404. */
  let protectedResource: Record<string, unknown> | null | undefined;

  const handler = createMcpHandler(({ authInfo }) => {
    const fault = authInfo?.extra?.fault as ServiceFault | undefined;
    const server = new Server(
      { name: "testnotizen", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler("tools/list", () => ({
      tools: [...tools.values()],
    }));
    server.setRequestHandler(
      "tools/call",
      (request): CallToolResult =>
        fault
          ? faultResult(fault)
          : testnotizen(request.params.name, request.params.arguments ?? {}),
    );
    return server;
  });
  const mcp = toNodeHandler(handler);

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? "/", issuer).pathname;
    if (path.startsWith("/.well-known/oauth-protected-resource")) {
      if (protectedResource === null)
        return json(res, 404, { error: "not_found" });
      if (protectedResource) return json(res, 200, protectedResource);
      return json(res, 200, {
        resource: mcpUrl,
        authorization_servers: [issuer],
        scopes_supported: ["notes"],
        bearer_methods_supported: ["header"],
        resource_name: "Testnotizen",
      });
    }
    if (path === "/.well-known/oauth-authorization-server")
      return json(res, 200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        registration_endpoint: `${issuer}/register`,
        revocation_endpoint: `${issuer}/revoke`,
        scopes_supported: ["notes"],
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: [
          "none",
          "client_secret_post",
          "client_secret_basic",
        ],
        authorization_response_iss_parameter_supported: true,
        client_id_metadata_document_supported: true,
      });
    if (path === "/register" && req.method === "POST")
      return register(res, await body(req));
    if (path === "/authorize" && req.method === "GET")
      return authorize(res, new URL(req.url!, issuer).searchParams);
    if (path === "/token" && req.method === "POST")
      return token(req, res, new URLSearchParams(await body(req)));
    if (path === "/revoke" && req.method === "POST")
      return revoke(req, res, new URLSearchParams(await body(req)));
    if (path === "/mcp" || path === "/mcp/messages") mcpRequests++;
    if (options.legacySse && path === "/mcp") return serveSse(req, res);
    if (options.legacySse && path === "/mcp/messages")
      return serveSseMessage(req, res);
    if (path === "/mcp") return serveMcp(req, res);
    json(res, 404, { error: "not_found" });
  }

  function register(res: ServerResponse, request: string) {
    let metadata: Record<string, unknown>;
    try {
      metadata = JSON.parse(request);
    } catch {
      return json(res, 400, { error: "invalid_client_metadata" });
    }
    const redirectUris = metadata.redirect_uris;
    if (
      !Array.isArray(redirectUris) ||
      redirectUris.length === 0 ||
      !redirectUris.every((uri) => typeof uri === "string" && URL.canParse(uri))
    )
      return json(res, 400, { error: "invalid_redirect_uri" });
    const clientId = `client-${secret()}`;
    const method = metadata.token_endpoint_auth_method ?? "client_secret_basic";
    const client: Client = { redirectUris };
    if (method !== "none") client.secret = secret();
    clients.set(clientId, client);
    json(res, 201, {
      ...metadata,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: method,
      ...(client.secret && {
        client_secret: client.secret,
        client_secret_expires_at: 0,
      }),
    });
  }

  async function authorize(res: ServerResponse, params: URLSearchParams) {
    const clientId = params.get("client_id") ?? "";
    const redirectUri = params.get("redirect_uri") ?? "";
    const client = isCimdClientId(clientId)
      ? await fetchClientMetadata(clientId)
      : clients.get(clientId);
    if (!client?.redirectUris.includes(redirectUri))
      return json(res, 400, { error: "invalid_client" });
    if (
      params.get("response_type") !== "code" ||
      params.get("code_challenge_method") !== "S256" ||
      !params.get("code_challenge")
    )
      return json(res, 400, { error: "invalid_request" });
    if (params.get("resource") !== mcpUrl)
      return json(res, 400, { error: "invalid_target" });

    const callback = new URL(redirectUri);
    const fault = authorizationFaults.shift();
    if (fault === "access-denied")
      callback.searchParams.set("error", "access_denied");
    else {
      const code = secret();
      codes.set(code, {
        id: secret(),
        clientId,
        redirectUri,
        challenge: params.get("code_challenge")!,
        expiresAt: Date.now() + 60_000,
      });
      callback.searchParams.set("code", code);
    }
    const state = params.get("state");
    if (state !== null) callback.searchParams.set("state", state);
    callback.searchParams.set(
      "iss",
      fault === "wrong-iss" ? "https://evil.test" : issuer,
    );
    res.writeHead(302, { location: callback.href }).end();
  }

  /**
   * A CIMD client id names its own metadata document, which must name that id back. The client is public and is
   * remembered for the token endpoint.
   */
  async function fetchClientMetadata(
    clientId: string,
  ): Promise<Client | undefined> {
    const response = await fetch(clientId).catch(() => undefined);
    const document = response?.ok
      ? ((await response.json().catch(() => undefined)) as
          | Record<string, unknown>
          | undefined)
      : undefined;
    const redirectUris = document?.redirect_uris;
    if (document?.client_id !== clientId || !Array.isArray(redirectUris))
      return undefined;
    const client = { redirectUris: redirectUris.map(String) };
    clients.set(clientId, client);
    return client;
  }

  function token(
    req: IncomingMessage,
    res: ServerResponse,
    params: URLSearchParams,
  ) {
    tokenRequests.push({
      grantType: params.get("grant_type") ?? "",
      clientId: credentials(req, params).clientId,
      ...(params.has("resource") && { resource: params.get("resource")! }),
    });
    const clientId = authenticate(req, params);
    if (clientId === undefined)
      return json(res, 401, { error: "invalid_client" });
    const resource = params.get("resource");
    if (resource !== null && resource !== mcpUrl)
      return json(res, 400, { error: "invalid_target" });

    let authorization: Authorization | undefined;
    if (params.get("grant_type") === "authorization_code") {
      const value = params.get("code") ?? "";
      const code = codes.get(value);
      codes.delete(value);
      const verifier = params.get("code_verifier") ?? "";
      if (
        code &&
        code.clientId === clientId &&
        code.expiresAt > Date.now() &&
        code.redirectUri === params.get("redirect_uri") &&
        createHash("sha256").update(verifier).digest("base64url") ===
          code.challenge
      )
        authorization = code;
    } else if (params.get("grant_type") === "refresh_token") {
      const value = params.get("refresh_token") ?? "";
      const refresh = refreshTokens.get(value);
      if (refresh?.clientId === clientId) {
        // Rotation: a used refresh token stops working.
        refreshTokens.delete(value);
        authorization = refresh;
      }
    } else return json(res, 400, { error: "unsupported_grant_type" });
    if (!authorization) return json(res, 400, { error: "invalid_grant" });

    const access = secret();
    const refresh = secret();
    accessTokens.set(access, {
      id: authorization.id,
      clientId,
      expiresAt: Date.now() + tokenLifetime * 1000,
    });
    refreshTokens.set(refresh, { id: authorization.id, clientId });
    json(res, 200, {
      access_token: access,
      token_type: "Bearer",
      expires_in: tokenLifetime,
      refresh_token: refresh,
      scope: "notes",
      workspace_name: workspaceName,
    });
  }

  /** RFC 7009: revoking a refresh token ends its authorization, access tokens included. */
  function revoke(
    req: IncomingMessage,
    res: ServerResponse,
    params: URLSearchParams,
  ) {
    const value = params.get("token") ?? "";
    revocations.push({
      token: value,
      clientId: credentials(req, params).clientId,
    });
    const clientId = authenticate(req, params);
    if (clientId === undefined)
      return json(res, 401, { error: "invalid_client" });
    const authorization = refreshTokens.get(value) ?? accessTokens.get(value);
    if (authorization?.clientId === clientId) {
      accessTokens.delete(value);
      if (refreshTokens.delete(value))
        for (const [token, access] of accessTokens)
          if (access.id === authorization.id) accessTokens.delete(token);
    }
    res.writeHead(200).end();
  }

  /** The client id the request authenticates as, or `undefined` if it fails to. */
  function authenticate(
    req: IncomingMessage,
    params: URLSearchParams,
  ): string | undefined {
    const { clientId, secret } = credentials(req, params);
    if (clientId === undefined) return undefined;
    const client = clients.get(clientId);
    if (!client || client.secret !== secret) return undefined;
    return clientId;
  }

  /** The Bearer challenge (RFC 6750), pointing at the Protected Resource Metadata (RFC 9728). */
  function challenge(...params: string[]): Record<string, string> {
    const metadata = `resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`;
    return { "www-authenticate": `Bearer ${[metadata, ...params].join(", ")}` };
  }

  /** The request's valid access token, or undefined after answering 401 with the Bearer challenge. */
  function authorized(req: IncomingMessage, res: ServerResponse) {
    const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const access = bearer === undefined ? undefined : accessTokens.get(bearer);
    if (access && access.expiresAt > Date.now())
      return { bearer: bearer!, access };
    json(
      res,
      401,
      { error: "invalid_token" },
      challenge(...(bearer === undefined ? [] : ['error="invalid_token"'])),
    );
    return undefined;
  }

  /** Legacy SSE: opens a session's event stream and names the endpoint its messages go to. */
  function serveSse(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== "GET")
      return json(res, 405, { error: "method_not_allowed" });
    if (!authorized(req, res)) return;
    const session = secret();
    sseSessions.set(session, res);
    res.on("close", () => sseSessions.delete(session));
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
    });
    res.write(`event: endpoint\ndata: /mcp/messages?session=${session}\n\n`);
  }

  /** Legacy SSE: accepts a message with 202 and sends its answer on the session's event stream. */
  async function serveSseMessage(req: IncomingMessage, res: ServerResponse) {
    const authorization = authorized(req, res);
    if (!authorization) return;
    const stream = sseSessions.get(
      new URL(req.url!, issuer).searchParams.get("session") ?? "",
    );
    if (!stream) return json(res, 404, { error: "unknown_session" });
    let message: {
      id?: string | number;
      method?: string;
      params?: Record<string, unknown>;
    };
    try {
      message = JSON.parse(await body(req));
    } catch {
      return json(res, 400, { error: "parse_error" });
    }
    let fault: McpFault | undefined;
    if (message.method === "tools/call") {
      const tool = String(message.params?.name);
      calls.push({
        tool,
        arguments: (message.params?.arguments ?? {}) as Record<string, unknown>,
        token: authorization.bearer,
      });
      fault = scripts.get(tool)?.shift();
    }
    if (fault?.kind === "http")
      return json(
        res,
        fault.status,
        { error: `Scripted HTTP ${fault.status}` },
        fault.retryAfter === undefined
          ? {}
          : { "retry-after": String(fault.retryAfter) },
      );
    res.writeHead(202).end();
    if (message.id === undefined || fault?.kind === "hang") return;
    if (fault?.kind === "drop") return void stream.destroy();
    if (fault?.kind === "delay") {
      const { ms } = fault;
      await new Promise((resolve) => setTimeout(resolve, ms));
      fault = undefined;
    }
    const answer = (result: unknown) =>
      stream.write(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, ...(result as object) })}\n\n`,
      );
    try {
      switch (message.method) {
        case "initialize":
          return answer({
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "testnotizen", version: "1.0.0" },
            },
          });
        case "tools/list":
          return answer({ result: { tools: [...tools.values()] } });
        case "tools/call":
          return answer({
            result: fault
              ? faultResult(fault as ServiceFault)
              : testnotizen(
                  String(message.params?.name),
                  (message.params?.arguments ?? {}) as Record<string, unknown>,
                ),
          });
        default:
          return answer({
            error: {
              code: ProtocolErrorCode.MethodNotFound,
              message: "Method not found",
            },
          });
      }
    } catch (error) {
      if (!(error instanceof ProtocolError)) throw error;
      return answer({ error: { code: error.code, message: error.message } });
    }
  }

  async function serveMcp(req: IncomingMessage, res: ServerResponse) {
    const authorization = authorized(req, res);
    if (!authorization) return;
    const { bearer, access } = authorization;
    if (req.method !== "POST") return mcp(req, res);
    let message: { method?: unknown; params?: Record<string, unknown> };
    try {
      message = JSON.parse(await body(req));
    } catch {
      return json(res, 400, { error: "parse_error" });
    }
    let fault: McpFault | undefined;
    if (message.method === "tools/call") {
      const tool = String(message.params?.name);
      calls.push({
        tool,
        arguments: (message.params?.arguments ?? {}) as Record<string, unknown>,
        token: bearer!,
      });
      fault = scripts.get(tool)?.shift();
    }
    if (fault?.kind === "hang") return;
    if (fault?.kind === "drop") return void req.socket.destroy();
    if (fault?.kind === "http")
      return json(
        res,
        fault.status,
        { error: `Scripted HTTP ${fault.status}` },
        {
          ...(fault.status === 401 ? challenge('error="invalid_token"') : {}),
          ...(fault.status === 403
            ? challenge('error="insufficient_scope"', 'scope="notes"')
            : {}),
          ...(fault.retryAfter === undefined
            ? {}
            : { "retry-after": String(fault.retryAfter) }),
        },
      );
    if (fault?.kind === "delay") {
      const { ms } = fault;
      await new Promise((resolve) => setTimeout(resolve, ms));
      fault = undefined;
    }
    // The other faults travel to the service with the call.
    const auth: AuthInfo = {
      token: bearer!,
      clientId: access.clientId,
      scopes: ["notes"],
      extra: { fault },
    };
    await mcp(Object.assign(req, { auth }), res, message);
  }

  const sockets = new Set<Socket>();
  const listener = (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent)
        json(res, 500, {
          error: "server_error",
          error_description: String(error),
        });
    });
  };
  const server = options.tls
    ? createHttpsServer(options.tls, listener)
    : createHttpServer(listener);
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("The fake MCP server has no TCP port");
  issuer = (
    options.url ?? `${options.tls ? "https" : "http"}://${host}:${address.port}`
  ).replace(/\/$/, "");
  mcpUrl = `${issuer}/mcp`;

  return {
    url: issuer,
    mcpUrl,
    calls,
    get mcpRequests() {
      return mcpRequests;
    },
    tokenRequests,
    revocations,
    scriptAuthorization(...faults) {
      authorizationFaults.push(...faults);
    },
    setProtectedResourceMetadata(metadata) {
      protectedResource = metadata;
    },
    script(tool, ...faults) {
      scripts.set(tool, [...(scripts.get(tool) ?? []), ...faults]);
    },
    setTool(definition) {
      tools.set(definition.name, definition);
    },
    removeTool(name) {
      tools.delete(name);
    },
    expireAccessTokens() {
      for (const access of accessTokens.values()) access.expiresAt = 0;
    },
    invalidateRefreshTokens() {
      refreshTokens.clear();
    },
    async stop() {
      await handler.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function faultResult(fault: ServiceFault): CallToolResult {
  const bytes = (size: number) => Buffer.alloc(size, 7).toString("base64");
  switch (fault.kind) {
    case "rpc-error":
      throw new ProtocolError(
        fault.code ?? ProtocolErrorCode.InternalError,
        fault.message ?? "Testnotizen ist gerade nicht erreichbar.",
      );
    case "tool-error":
      return {
        content: [
          {
            type: "text",
            text: fault.message ?? "Testnotizen ist gerade nicht erreichbar.",
          },
        ],
        isError: true,
      };
    case "image":
      return {
        content: [{ type: "image", mimeType: "image/png", data: bytes(2048) }],
      };
    case "audio":
      return {
        content: [{ type: "audio", mimeType: "audio/mpeg", data: bytes(4096) }],
      };
    case "binary-resource":
      return {
        content: [
          {
            type: "resource",
            resource: {
              uri: "testnotizen://anhang/skript.pdf",
              mimeType: "application/pdf",
              blob: bytes(8192),
            },
          },
        ],
      };
    case "oversize":
      return {
        content: [
          {
            type: "text",
            text: "Notizen ohne Ende. "
              .repeat(fault.characters)
              .slice(0, fault.characters),
          },
        ],
      };
  }
}

/** The client id and secret a request presents, by HTTP Basic or in the form. */
function credentials(
  req: IncomingMessage,
  params: URLSearchParams,
): { clientId?: string; secret?: string } {
  const basic = /^Basic (.+)$/i.exec(req.headers.authorization ?? "");
  if (!basic)
    return {
      clientId: params.get("client_id") ?? undefined,
      secret: params.get("client_secret") ?? undefined,
    };
  const [clientId, secret] = Buffer.from(basic[1]!, "base64")
    .toString()
    .split(":")
    .map(decodeURIComponent);
  return { clientId, secret };
}

/** A URL client id is CIMD; `http:` too, because nunio's dev API serves its document over plain HTTP. */
function isCimdClientId(clientId: string): boolean {
  return (
    URL.canParse(clientId) &&
    ["http:", "https:"].includes(new URL(clientId).protocol)
  );
}

function json(
  res: ServerResponse,
  status: number,
  value: unknown,
  headers: Record<string, string> = {},
) {
  res
    .writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    })
    .end(JSON.stringify(value));
}

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

function secret(): string {
  return randomBytes(16).toString("base64url");
}
