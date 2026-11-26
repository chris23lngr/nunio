/**
 * Connecting an OAuth Integration (#288): nunio's `OAuthClientProvider` for `@ai-sdk/mcp`, backed by Postgres.
 *
 * The SDK discovers the authorization server through Protected Resource Metadata and does PKCE, `resource` and `iss`
 * validation. nunio adds the issuer allowlist (on the advertised server and on the issuer its metadata names), a
 * required and pinned `resource`, CIMD (a URL client id passed as a pre-registered public client, #257), DCR results
 * stored per Integration and issuer, the flow bound to the student's session for 10 minutes, and a fetch that only
 * reaches public addresses over https.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthClientProvider,
  OAuthTokens,
} from "@ai-sdk/mcp";
import { auth } from "@ai-sdk/mcp";
import type { PrismaClient } from "@nunio/db";
import type { Principal } from "@nunio/delegation";
import { accessRefusal, withOwner } from "@nunio/delegation";
import type { ConnectionCredentialKeys, SourceKeys } from "@nunio/keys";
import { isPublic } from "./email/servers.js";
import { publicFetch } from "./public-fetch.js";

/** How long a student has to sign in at the vendor and come back. */
const OAUTH_FLOW_LIFETIME_MS = 10 * 60_000;

/** How long nunio waits to connect to a vendor, for its headers and between body chunks. */
const OAUTH_REQUEST_TIMEOUT_MS = 10_000;

export type OAuthStart =
  | { ok: true; authorizationUrl: string }
  /** Not an offered MCP Integration. */
  | { ok: false; reason: "not_offered" }
  | { ok: false; reason: "not_entitled" | "deletion_pending" }
  | { ok: false; reason: "already_connected" }
  /** The server named an authorization server whose issuer isn't allowlisted on the Integration row. */
  | { ok: false; reason: "issuer_refused" }
  /** Discovery or registration failed; nothing was stored. */
  | { ok: false; reason: "authorization_failed" };

/** Why the dialog shows the student that connecting didn't work; nothing was stored. */
export type OAuthFailure =
  /** The student cancelled at the vendor. */
  | "cancelled"
  /** An expired or unknown state, or one another session started. */
  | "expired"
  | "already_connected"
  /** The vendor answered with an error, a wrong `iss`, or refused the code. */
  | "failed";

export type OAuthFinish = { ok: true } | { ok: false; reason: OAuthFailure };

/** What the vendor's redirect back to nunio carries. */
export interface OAuthCallback {
  state?: string;
  code?: string;
  iss?: string;
  error?: string;
}

/** The flow sealed between start and callback. */
interface PendingFlow {
  codeVerifier: string;
  client: OAuthClientInformation;
  server: OAuthAuthorizationServerInformation;
  /** The protected resource (RFC 8707) from the start's Protected Resource Metadata, sent again with the code. */
  resource: string;
  /** The authorization server advertised RFC 9207, so its response must carry `iss`. */
  issRequired: boolean;
}

/** What nunio observed of the responses `auth()` fetched. */
interface Observed {
  /**
   * Set once nunio allowed the authorization server: the SDK fetches its metadata next, so the first GET that
   * succeeds after it is that metadata, wherever its redirects led.
   */
  discovering: boolean;
  /** The authorization server's metadata. Without it the SDK would guess its endpoints and skip its checks. */
  metadata?: Record<string, unknown>;
  /** The raw first token response, which carries the account name (e.g. `workspace_name`) the SDK drops. */
  tokenResponse?: Record<string, unknown>;
}

type McpIntegration = {
  key: string;
  name: string;
  mcpUrl: string;
  scopes: string[];
  issuers: string[];
  registration: string;
};

/** An issuer as nunio compares it: without a trailing slash. */
const issuerOf = (url: string | URL) => String(url).replace(/\/+$/, "");

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const isUniqueViolation = (error: unknown) =>
  (error as { code?: string } | null)?.code === "P2002";

/** The issuer the authorization server's metadata names; there is none without metadata. */
function discoveredIssuer(observed: Observed): string {
  const issuer = observed.metadata?.issuer;
  if (typeof issuer !== "string")
    throw new Error("The authorization server served no metadata");
  return issuer;
}

/** Whether a Protected Resource Metadata `resource` covers the MCP URL: the same origin, and its path or a parent. */
function coversMcpUrl(resource: string, mcpUrl: string): boolean {
  const covering = new URL(resource);
  const mcp = new URL(mcpUrl);
  const path = covering.pathname.replace(/\/+$/, "");
  return (
    covering.origin === mcp.origin &&
    (mcp.pathname.replace(/\/+$/, "") === path ||
      mcp.pathname.startsWith(`${path}/`))
  );
}

/** When the access token expires, or null when the vendor named no lifetime nunio can turn into a date. */
function expiryOf(expiresIn: number | undefined): string | null {
  if (expiresIn === undefined || !Number.isFinite(expiresIn) || expiresIn < 0)
    return null;
  const at = new Date(Date.now() + expiresIn * 1000);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

class IssuerRefused extends Error {
  constructor() {
    super("The authorization server's issuer is not allowlisted");
    this.name = "IssuerRefused";
  }
}

/**
 * The fetch `auth()` uses for every OAuth request: https only outside INTEGRATION_FAKES, public addresses only, and
 * no redirects followed (see `publicFetch`). `allowed` is a test seam.
 */
export function oauthFetch(
  fakes: boolean,
  allowed: (address: string) => boolean = isPublic,
): typeof fetch {
  return publicFetch(fakes, {
    timeoutMs: OAUTH_REQUEST_TIMEOUT_MS,
    allowed,
    what: "OAuth",
  });
}

/** Wraps `base` to observe the authorization server's metadata and the code exchange's raw response. */
function observing(base: typeof fetch, observed: Observed): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init);
    const read = () =>
      response
        .clone()
        .json()
        .catch(() => undefined) as Promise<Record<string, unknown> | undefined>;
    if (
      observed.discovering &&
      response.ok &&
      (init?.method ?? "GET").toUpperCase() === "GET"
    ) {
      observed.discovering = false;
      observed.metadata = await read();
    }
    if (
      response.ok &&
      init?.body instanceof URLSearchParams &&
      init.body.get("grant_type") === "authorization_code"
    )
      observed.tokenResponse = await read();
    return response;
  };
}

/**
 * Connecting an OAuth Integration: start (discover, register if needed, store the flow, return the vendor's URL) and
 * finish (take the flow, exchange the code, create the Connection). Only a Connection is ever created; a failed or
 * cancelled flow leaves nothing behind but the DCR registration, which is nunio's, not the student's.
 */
export function createOAuthConnect({
  db,
  keys,
  credentials,
  fakes,
  apiOrigin,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  credentials: ConnectionCredentialKeys;
  fakes: boolean;
  /** The API's own origin: the CIMD URL and the callbacks live there. */
  apiOrigin: string;
}) {
  const clientId = new URL("/oauth/client-metadata.json", apiOrigin).href;
  const redirectUrl = (integrationKey: string) =>
    new URL(
      `/api/me/connections/${encodeURIComponent(integrationKey)}/oauth/callback`,
      apiOrigin,
    ).href;
  const baseFetch = oauthFetch(fakes);

  /** What nunio registers through DCR and publishes as its CIMD, with the Integrations' callbacks. */
  const clientMetadata = (redirectUris: string[]): OAuthClientMetadata => ({
    client_name: "nunio",
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  });

  const clientContext = (integrationKey: string, issuer: string) =>
    `oauth-client:${integrationKey}:${issuer}`;

  /** The DCR registration stored for this Integration and issuer, if any. */
  async function registeredClient(
    integrationKey: string,
    issuer: string,
  ): Promise<OAuthClientInformation | undefined> {
    const row = await db.oAuthClient.findUnique({
      where: { integrationKey_issuer: { integrationKey, issuer } },
    });
    if (!row) return undefined;
    return JSON.parse(
      credentials.open(clientContext(integrationKey, issuer), {
        version: row.keyVersion,
        ciphertext: row.ciphertext,
      }),
    );
  }

  /** Stores a DCR registration once per Integration and issuer; a concurrent registration that came first stays. */
  async function saveRegisteredClient(
    integrationKey: string,
    issuer: string,
    client: OAuthClientInformation,
  ) {
    const sealed = credentials.seal(
      clientContext(integrationKey, issuer),
      JSON.stringify(client),
    );
    await db.oAuthClient.createMany({
      data: {
        integrationKey,
        issuer,
        keyVersion: sealed.version,
        ciphertext: sealed.ciphertext,
      },
      skipDuplicates: true,
    });
  }

  /** The checks before nunio contacts the vendor or creates the Connection, in one transaction. */
  function beforeConnect(p: Principal, integrationKey: string) {
    return withOwner(db, p, async (tx, studentId) => {
      const integration = await tx.integration.findFirst({
        where: { key: integrationKey, status: "offered", kind: "mcp" },
      });
      if (!integration?.mcpUrl || !integration.registration)
        return { ok: false, reason: "not_offered" } as const;
      const refusal = await accessRefusal(tx, studentId);
      if (refusal) return { ok: false, reason: refusal } as const;
      if (await tx.connection.findFirst({ where: { integrationKey } }))
        return { ok: false, reason: "already_connected" } as const;
      return {
        ok: true,
        integration: {
          key: integration.key,
          name: integration.name,
          mcpUrl: integration.mcpUrl,
          scopes: integration.scopes,
          issuers: integration.issuers,
          registration: integration.registration,
        } satisfies McpIntegration,
      } as const;
    });
  }

  /**
   * Refuses an authorization server whose issuer isn't on the Integration row: the server the resource advertises,
   * before nunio fetches its metadata, and the issuer that metadata names.
   */
  const allowlisted =
    (integration: McpIntegration) => (_server: unknown, as: string | URL) => {
      if (!integration.issuers.map(issuerOf).includes(issuerOf(as)))
        throw new IssuerRefused();
    };

  return {
    /** nunio's Client ID Metadata Document, at its own URL, listing every CIMD Integration's callback. */
    async clientMetadataDocument() {
      const integrations = await db.integration.findMany({
        where: {
          kind: "mcp",
          registration: "cimd",
          status: { not: "withdrawn" },
        },
        select: { key: true },
        orderBy: { key: "asc" },
      });
      return {
        client_id: clientId,
        ...clientMetadata(integrations.map(({ key }) => redirectUrl(key))),
        token_endpoint_auth_method: "none",
      };
    },

    /**
     * Discovers the authorization server, refuses one not allowlisted, registers through DCR if the Integration
     * says so and none is stored for its issuer, and stores the state's hash with the PKCE verifier, the client and
     * the pinned server, bound to the session, for 10 minutes. Returns the vendor's URL, asking for every scope.
     */
    async start(
      p: Principal,
      sessionId: string,
      integrationKey: string,
    ): Promise<OAuthStart> {
      const checked = await beforeConnect(p, integrationKey);
      if (!checked.ok) return checked;
      const { integration } = checked;
      if (
        integration.registration !== "cimd" &&
        integration.registration !== "dcr"
      )
        // Pre-registered clients come with Google Calendar.
        throw new Error(
          `Registration ${integration.registration} is not supported yet`,
        );

      const state = randomBytes(32).toString("base64url");
      const observed: Observed = { discovering: false };
      let issuer: string | undefined;
      let resource: string | undefined;
      let client: OAuthClientInformation | undefined;
      let server: OAuthAuthorizationServerInformation | undefined;
      let codeVerifier: string | undefined;
      let authorizationUrl: URL | undefined;
      const provider: OAuthClientProvider = {
        redirectUrl: redirectUrl(integration.key),
        clientMetadata: clientMetadata([redirectUrl(integration.key)]),
        state: () => state,
        tokens: () => undefined,
        saveTokens: () => {
          throw new Error("No tokens before the callback");
        },
        // Without Protected Resource Metadata the SDK would fall back to no `resource` at all.
        validateResourceURL: async (_server, advertised) => {
          if (!advertised || !coversMcpUrl(advertised, integration.mcpUrl))
            throw new Error("No protected resource for this MCP server");
          resource = new URL(advertised).href;
          return new URL(resource);
        },
        validateAuthorizationServerURL: (serverUrl, as) => {
          allowlisted(integration)(serverUrl, as);
          observed.discovering = true;
        },
        // Called right after the metadata, before any registration: its issuer must be allowlisted too, as the
        // SDK accepts a path-scoped server's root metadata.
        clientInformation: async () => {
          const discovered = discoveredIssuer(observed);
          allowlisted(integration)(null, discovered);
          issuer = issuerOf(discovered);
          if (integration.registration === "cimd")
            client = { client_id: clientId };
          else client = await registeredClient(integration.key, issuer!);
          return client;
        },
        ...(integration.registration === "dcr" && {
          saveClientInformation: async (registered: OAuthClientInformation) => {
            client = registered;
            await saveRegisteredClient(integration.key, issuer!, registered);
          },
        }),
        saveAuthorizationServerInformation: (information) => {
          allowlisted(integration)(
            null,
            information.issuer ?? information.authorizationServerUrl,
          );
          server = information;
        },
        authorizationServerInformation: () => server,
        saveCodeVerifier: (verifier) => {
          codeVerifier = verifier;
        },
        codeVerifier: () => codeVerifier!,
        redirectToAuthorization: (url) => {
          authorizationUrl = url;
        },
      };
      try {
        await auth(provider, {
          serverUrl: integration.mcpUrl,
          scope: integration.scopes.join(" "),
          fetchFn: observing(baseFetch, observed),
        });
      } catch (error) {
        if (error instanceof IssuerRefused)
          return { ok: false, reason: "issuer_refused" };
        console.error("Could not start connecting an Integration", {
          integrationKey,
          error: error instanceof Error ? error.name : "unknown",
        });
        return { ok: false, reason: "authorization_failed" };
      }
      if (
        !authorizationUrl ||
        // The student's browser goes there next: https only, but for the fakes.
        !(
          authorizationUrl.protocol === "https:" ||
          (fakes && authorizationUrl.protocol === "http:")
        ) ||
        !resource ||
        !client ||
        !server ||
        !codeVerifier
      )
        return { ok: false, reason: "authorization_failed" };

      const id = sha256(state);
      const pending: PendingFlow = {
        codeVerifier,
        client,
        server,
        resource,
        issRequired:
          observed.metadata?.authorization_response_iss_parameter_supported ===
          true,
      };
      const sealed = credentials.seal(
        `oauth-flow:${id}`,
        JSON.stringify(pending),
      );
      await withOwner(db, p, async (tx, studentId) => {
        // Flows nobody finished in time go when the student starts another.
        await tx.oAuthFlow.deleteMany({
          where: { expiresAt: { lte: new Date() } },
        });
        await tx.oAuthFlow.create({
          data: {
            id,
            studentId,
            sessionId,
            integrationKey: integration.key,
            keyVersion: sealed.version,
            ciphertext: sealed.ciphertext,
            expiresAt: new Date(Date.now() + OAUTH_FLOW_LIFETIME_MS),
          },
        });
      });
      return { ok: true, authorizationUrl: authorizationUrl.href };
    },

    /**
     * Takes the flow the state names, only in the session and for the Integration that started it and only within
     * 10 minutes, then exchanges the code and creates the Connection with the account label from the first token
     * response, its sealed credentials and a new content key. Anything else stores nothing.
     */
    async finish(
      p: Principal,
      sessionId: string,
      integrationKey: string,
      callback: OAuthCallback,
    ): Promise<OAuthFinish> {
      if (!callback.state) return { ok: false, reason: "expired" };
      const id = sha256(callback.state);
      // Taken once: a second callback with the same state finds nothing.
      const flow = await withOwner(db, p, async (tx) => {
        const where = { id, sessionId, integrationKey };
        const row = await tx.oAuthFlow.findFirst({ where });
        if (!row) return null;
        const { count } = await tx.oAuthFlow.deleteMany({ where });
        return count === 1 ? row : null;
      });
      if (!flow || flow.expiresAt <= new Date())
        return { ok: false, reason: "expired" };
      if (callback.error)
        return {
          ok: false,
          reason: callback.error === "access_denied" ? "cancelled" : "failed",
        };
      const pending: PendingFlow = JSON.parse(
        credentials.open(`oauth-flow:${id}`, {
          version: flow.keyVersion,
          ciphertext: flow.ciphertext,
        }),
      );
      if (!callback.code || (pending.issRequired && !callback.iss))
        return { ok: false, reason: "failed" };

      const checked = await beforeConnect(p, integrationKey);
      if (!checked.ok)
        return {
          ok: false,
          reason:
            checked.reason === "already_connected" ? checked.reason : "failed",
        };
      const { integration } = checked;

      const observed: Observed = { discovering: false };
      let tokens: OAuthTokens | undefined;
      const provider: OAuthClientProvider = {
        redirectUrl: redirectUrl(integration.key),
        clientMetadata: clientMetadata([redirectUrl(integration.key)]),
        tokens: () => undefined,
        saveTokens: (saved) => {
          tokens = saved;
        },
        // The resource pinned at the start; Protected Resource Metadata found now may only name it again.
        validateResourceURL: async (_server, advertised) => {
          if (advertised && new URL(advertised).href !== pending.resource)
            throw new Error("The protected resource changed");
          return new URL(pending.resource);
        },
        validateAuthorizationServerURL: (serverUrl, as) => {
          allowlisted(integration)(serverUrl, as);
          observed.discovering = true;
        },
        clientInformation: () => pending.client,
        authorizationServerInformation: () => pending.server,
        // The SDK asks for the state after the metadata and before the exchange: the last point to refuse a server
        // that served none, or names an issuer not on the row.
        storedState: () => {
          allowlisted(integration)(null, discoveredIssuer(observed));
          return callback.state;
        },
        saveCodeVerifier: () => {
          throw new Error("No new authorization in the callback");
        },
        codeVerifier: () => pending.codeVerifier,
        redirectToAuthorization: () => {
          throw new Error("No new authorization in the callback");
        },
      };
      try {
        await auth(provider, {
          serverUrl: integration.mcpUrl,
          authorizationCode: callback.code,
          callbackState: callback.state,
          callbackIssuer: callback.iss,
          fetchFn: observing(baseFetch, observed),
        });
      } catch (error) {
        console.error("Could not finish connecting an Integration", {
          integrationKey,
          error: error instanceof Error ? error.name : "unknown",
        });
        return { ok: false, reason: "failed" };
      }
      if (!tokens) return { ok: false, reason: "failed" };

      const workspace = observed.tokenResponse?.workspace_name;
      const accountLabel =
        typeof workspace === "string" && workspace.trim()
          ? workspace.trim().slice(0, 200)
          : integration.name;
      const connectionId = randomUUID();
      const { wrapped } = keys.generateConnectionKey(connectionId);
      const sealed = credentials.seal(
        connectionId,
        JSON.stringify({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt: expiryOf(tokens.expires_in),
          scopes:
            tokens.scope?.split(" ").filter(Boolean) ?? integration.scopes,
          tokenType: tokens.token_type,
          server: pending.server,
          client: pending.client,
        }),
      );
      try {
        await withOwner(db, p, async (tx, studentId) => {
          await tx.connection.create({
            data: {
              id: connectionId,
              studentId,
              integrationKey: integration.key,
              accountLabel,
              keyVersion: wrapped.version,
              keyCiphertext: wrapped.ciphertext,
            },
          });
          await tx.connectionCredential.create({
            data: {
              connectionId,
              studentId,
              keyVersion: sealed.version,
              ciphertext: sealed.ciphertext,
            },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error))
          return { ok: false, reason: "already_connected" };
        throw error;
      }
      return { ok: true };
    },
  };
}
