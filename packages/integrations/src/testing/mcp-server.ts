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
import type { AuthInfo, CallToolResult } from "@modelcontextprotocol/server";
import { createMcpHandler, Server } from "@modelcontextprotocol/server";
import type { McpToolDefinition } from "./testnotizen.js";
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
}

/** What one scripted `tools/call` gets instead of the service's answer. */
export type McpFault =
  /** A result with `isError: true`. */
  | { kind: "tool-error"; message?: string }
  /** An HTTP error instead of a result: a 4xx, a 5xx, or 429 with `Retry-After` in seconds. */
  | { kind: "http"; status: number; retryAfter?: number }
  /** Never answers; the request stays open until the server stops. */
  | { kind: "hang" }
  /** Closes the connection without answering, after the call was received and recorded. */
  | { kind: "drop" }
  /** A result that is only a 2 KB PNG, 4 KB of MP3 audio, or an 8 KB PDF resource. */
  | { kind: "image" | "audio" | "binary-resource" }
  /** A text result of exactly `characters` characters. */
  | { kind: "oversize"; characters: number };

export interface FakeMcpServer {
  /** The origin, which is also the authorization server's issuer. */
  url: string;
  /** The Streamable HTTP endpoint and OAuth resource. */
  mcpUrl: string;
  /** Every `tools/call` that reached the service with a valid token, in order. */
  readonly calls: readonly ReceivedCall[];
  /** Queues faults for `tool`'s next calls: each call spends one, in order, and then the tool answers normally. */
  script(tool: string, ...faults: McpFault[]): void;
  /** Drift: adds a tool, or changes the definition of one with the same name. */
  setTool(definition: McpToolDefinition): void;
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

interface Client {
  redirectUris: string[];
  /** Absent for a public client. */
  secret?: string;
}

interface Grant {
  id: string;
  clientId: string;
}

interface Code extends Grant {
  redirectUri: string;
  challenge: string;
  expiresAt: number;
}

interface AccessToken extends Grant {
  expiresAt: number;
}

export async function startFakeMcpServer(
  options: FakeMcpServerOptions = {},
): Promise<FakeMcpServer> {
  const tokenLifetime = options.tokenLifetime ?? 3600;
  const clients = new Map<string, Client>();
  const codes = new Map<string, Code>();
  const accessTokens = new Map<string, AccessToken>();
  const refreshTokens = new Map<string, Grant>();
  const calls: ReceivedCall[] = [];
  const scripts = new Map<string, McpFault[]>();
  const tools = new Map<string, McpToolDefinition>(
    testnotizenTools.map((tool) => [tool.name, tool]),
  );
  const testnotizen = createTestnotizen();
  // Set once the server listens, before any request arrives.
  let issuer = "";
  let mcpUrl = "";

  const handler = createMcpHandler(({ authInfo }) => {
    const fault = authInfo?.extra?.fault as McpFault | undefined;
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
        (fault && faultResult(fault)) ??
        testnotizen(request.params.name, request.params.arguments ?? {}),
    );
    return server;
  });
  const mcp = toNodeHandler(handler);

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const path = new URL(req.url ?? "/", issuer).pathname;
    if (path.startsWith("/.well-known/oauth-protected-resource"))
      return json(res, 200, {
        resource: mcpUrl,
        authorization_servers: [issuer],
        scopes_supported: ["notes"],
        bearer_methods_supported: ["header"],
        resource_name: "Testnotizen",
      });
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
      return register(res, JSON.parse(await body(req)));
    if (path === "/authorize" && req.method === "GET")
      return authorize(res, new URL(req.url!, issuer).searchParams);
    if (path === "/token" && req.method === "POST")
      return token(req, res, new URLSearchParams(await body(req)));
    if (path === "/revoke" && req.method === "POST")
      return revoke(req, res, new URLSearchParams(await body(req)));
    if (path === "/mcp") return serveMcp(req, res);
    json(res, 404, { error: "not_found" });
  }

  function register(res: ServerResponse, metadata: Record<string, unknown>) {
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
      ...(client.secret && { client_secret: client.secret }),
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

    const code = secret();
    codes.set(code, {
      id: secret(),
      clientId,
      redirectUri,
      challenge: params.get("code_challenge")!,
      expiresAt: Date.now() + 60_000,
    });
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    const state = params.get("state");
    if (state !== null) callback.searchParams.set("state", state);
    callback.searchParams.set("iss", issuer);
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
    const clientId = authenticate(req, params);
    if (clientId === undefined)
      return json(res, 401, { error: "invalid_client" });
    const resource = params.get("resource");
    if (resource !== null && resource !== mcpUrl)
      return json(res, 400, { error: "invalid_target" });

    let grant: Grant | undefined;
    if (params.get("grant_type") === "authorization_code") {
      const code = codes.get(params.get("code") ?? "");
      codes.delete(params.get("code") ?? "");
      const verifier = params.get("code_verifier") ?? "";
      if (
        code &&
        code.clientId === clientId &&
        code.expiresAt > Date.now() &&
        code.redirectUri === params.get("redirect_uri") &&
        createHash("sha256").update(verifier).digest("base64url") ===
          code.challenge
      )
        grant = code;
    } else if (params.get("grant_type") === "refresh_token") {
      const refresh = refreshTokens.get(params.get("refresh_token") ?? "");
      if (refresh?.clientId === clientId) {
        // Rotation: a used refresh token stops working.
        refreshTokens.delete(params.get("refresh_token")!);
        grant = refresh;
      }
    } else return json(res, 400, { error: "unsupported_grant_type" });
    if (!grant) return json(res, 400, { error: "invalid_grant" });

    const access = secret();
    const refresh = secret();
    accessTokens.set(access, {
      id: grant.id,
      clientId,
      expiresAt: Date.now() + tokenLifetime * 1000,
    });
    refreshTokens.set(refresh, { id: grant.id, clientId });
    json(res, 200, {
      access_token: access,
      token_type: "Bearer",
      expires_in: tokenLifetime,
      refresh_token: refresh,
      scope: "notes",
    });
  }

  /** RFC 7009: revoking a refresh token ends its grant, access tokens included. */
  function revoke(
    req: IncomingMessage,
    res: ServerResponse,
    params: URLSearchParams,
  ) {
    const clientId = authenticate(req, params);
    if (clientId === undefined)
      return json(res, 401, { error: "invalid_client" });
    const value = params.get("token") ?? "";
    const grant = refreshTokens.get(value) ?? accessTokens.get(value);
    if (grant?.clientId === clientId) {
      accessTokens.delete(value);
      if (refreshTokens.delete(value))
        for (const [token, access] of accessTokens)
          if (access.id === grant.id) accessTokens.delete(token);
    }
    res.writeHead(200).end();
  }

  /** The client id the request authenticates as, or `undefined` if it fails to. */
  function authenticate(
    req: IncomingMessage,
    params: URLSearchParams,
  ): string | undefined {
    let clientId = params.get("client_id") ?? undefined;
    let presented = params.get("client_secret") ?? undefined;
    const basic = /^Basic (.+)$/i.exec(req.headers.authorization ?? "");
    if (basic) {
      const [id, password] = Buffer.from(basic[1]!, "base64")
        .toString()
        .split(":")
        .map(decodeURIComponent);
      clientId = id;
      presented = password;
    }
    if (clientId === undefined) return undefined;
    const client = clients.get(clientId);
    if (!client || client.secret !== presented) return undefined;
    return clientId;
  }

  async function serveMcp(req: IncomingMessage, res: ServerResponse) {
    const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    const access = bearer === undefined ? undefined : accessTokens.get(bearer);
    if (!access || access.expiresAt <= Date.now()) {
      const challenge = [
        `resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`,
        ...(bearer === undefined ? [] : ['error="invalid_token"']),
      ].join(", ");
      return json(
        res,
        401,
        { error: "invalid_token" },
        {
          "www-authenticate": `Bearer ${challenge}`,
        },
      );
    }
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
        fault.retryAfter === undefined
          ? {}
          : { "retry-after": String(fault.retryAfter) },
      );
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
    script(tool, ...faults) {
      scripts.set(tool, [...(scripts.get(tool) ?? []), ...faults]);
    },
    setTool(definition) {
      tools.set(definition.name, definition);
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

/** The result a fault answers with, or `undefined` if it leaves the answer to the service. */
function faultResult(fault: McpFault): CallToolResult | undefined {
  const bytes = (size: number) => Buffer.alloc(size, 7).toString("base64");
  switch (fault.kind) {
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
    default:
      return undefined;
  }
}

function isCimdClientId(clientId: string): boolean {
  return URL.canParse(clientId) && new URL(clientId).protocol === "https:";
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
