import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { principal } from "@nunio/delegation";
import type {
  ConnectionSummary,
  EmailCheck,
  FolderListing,
} from "@nunio/integrations";
import type { Context } from "hono";
import type { AppBindings } from "./app.js";
import { body, Done, ErrorBody, errors, json, student } from "./outcomes.js";

const Connection = z
  .object({
    state: z.enum(["connected", "needs_reconnection"]),
    accountLabel: z
      .string()
      .describe("The account, such as the email address or workspace name."),
    folders: z
      .array(z.string())
      .describe("Email: the folders nunio may read, by IMAP path."),
    agentCount: z
      .number()
      .int()
      .min(0)
      .describe("How many of the student's Agents use a tool of it."),
  })
  .openapi("Connection");

const Integration = z
  .object({
    key: z.string(),
    name: z.string(),
    logo: z.string().describe("The path of its logo in the web app."),
    description: z.string(),
    dataNote: z.string().describe("Where the vendor processes data."),
    kind: z
      .enum(["mcp", "email"])
      .describe("email connects with a password, mcp through OAuth."),
    // A union, not .nullable(): that would make the shared Connection component nullable everywhere.
    connection: z
      .union([Connection, z.null()])
      .describe("The student's Connection to it, or null when they have none."),
    tools: z
      .array(
        z.object({
          label: z.string().describe("nunio's German label."),
          class: z
            .enum(["read", "write", "write_always_asked"])
            .describe(
              "read: read freely. write: after the student's approval, or Immer erlaubt. write_always_asked: " +
                "always asks.",
            ),
        }),
      )
      .describe(
        "Its classified tools by name; blocked tools are never offered and left out.",
      ),
  })
  .openapi("Integration");

const ConnectionDetail = z
  .object({
    key: z.string(),
    name: z.string(),
    logo: z.string().describe("The path of its logo in the web app."),
    kind: z.enum(["mcp", "email"]),
    connection: Connection,
    tools: z
      .array(
        z.object({
          name: z.string().describe("The server's own tool name."),
          label: z.string().describe("nunio's German label."),
          class: z.enum(["read", "write", "write_always_asked", "blocked"]),
          mode: z
            .enum(["ask", "always_allowed", "always_asks"])
            .nullable()
            .describe(
              "A write tool's setting: ask (Nachfragen) or always_allowed (Immer erlaubt, a Grant held by the " +
                "Connection, in every Chat and Agent); always_asks for one that is never grantable. Null for read " +
                "and blocked tools.",
            ),
          available: z
            .boolean()
            .describe("Whether nunio offers it; a blocked tool never is."),
        }),
      )
      .describe(
        "Every tool nunio classified, by name; a tool nunio hasn't classified is never listed.",
      ),
  })
  .openapi("ConnectionDetail");

const ToolParams = z.object({
  integrationKey: z.string().min(1).max(100),
  toolName: z.string().min(1).max(200),
});

const MailServer = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
});

const Discovery = z
  .discriminatedUnion("status", [
    z.object({
      status: z.literal("recognised"),
      university: z.string(),
      imap: MailServer,
      smtp: MailServer,
    }),
    z
      .object({ status: z.literal("unsupported"), university: z.string() })
      .describe(
        "Its university's mail needs Microsoft 365, which nunio can't connect yet.",
      ),
    z
      .object({ status: z.literal("unknown") })
      .describe("The student enters the servers in the manual form."),
  ])
  .openapi("EmailDiscovery");

const EmailLogin = z.object({
  address: z.email(),
  password: z.string().min(1).max(1024),
  username: z
    .string()
    .trim()
    .min(1)
    .max(320)
    .optional()
    .describe("The login, when it isn't the address."),
  servers: z
    .object({ imap: MailServer, smtp: MailServer })
    .optional()
    .describe(
      "Hosts and ports from the manual form or Server ändern; by default the recognised university's.",
    ),
});

const MailFolder = z
  .object({
    path: z.string(),
    name: z.string(),
    specialUse: z
      .string()
      .nullable()
      .describe("Its special use, such as \\Inbox or \\Sent."),
    preselected: z.boolean().describe("INBOX is preselected."),
  })
  .openapi("MailFolder");

const LoginFailed = json(
  z.union([
    z.object({
      error: z.literal("login_failed"),
      step: z
        .enum(["imap", "smtp"])
        .describe("The step that failed: Lesen (IMAP) or Senden (SMTP)."),
    }),
    z
      .object({
        error: z.enum([
          "port_refused",
          "server_refused",
          "servers_required",
          "unsupported",
          "unknown_folder",
        ]),
      })
      .describe(
        "port_refused: TLS only on 993 or 143 (IMAP) and 465 or 587 (SMTP). server_refused: a host that doesn't " +
          "resolve to public addresses. servers_required: an unknown domain without servers. unsupported: Microsoft " +
          "365 mail. unknown_folder: a chosen folder the mailbox doesn't have.",
      ),
  ]),
  "Nothing was stored.",
);

/** Answers a failed folder listing; nothing was stored. */
function folderRefused(
  c: Context<AppBindings>,
  result:
    | Exclude<FolderListing, { ok: true }>
    | { ok: false; reason: "unknown_folder" },
) {
  if (result.reason === "gone") return c.json({ error: result.reason }, 404);
  if (result.reason === "login_failed")
    return c.json({ error: result.reason, step: result.step }, 422);
  return c.json({ error: result.reason }, 422);
}

const FolderRefused = json(
  z.union([
    z.object({
      error: z.literal("login_failed"),
      step: z
        .literal("imap")
        .describe(
          "The stored login no longer opens the mailbox: Neu anmelden.",
        ),
    }),
    z
      .object({
        error: z.enum(["port_refused", "server_refused", "unknown_folder"]),
      })
      .describe(
        "server_refused: the stored host no longer resolves to public addresses. unknown_folder: a chosen folder " +
          "the mailbox doesn't have.",
      ),
  ]),
  "Nothing was stored.",
);

/** A Connection as the API returns it; never its credentials. */
const toConnection = (connection: ConnectionSummary) => ({
  state: connection.state,
  accountLabel: connection.accountLabel,
  folders: connection.folders,
  agentCount: connection.agentCount,
});

/** Answers a refused mailbox test or connect; nothing was stored. */
function refused(
  c: Context<AppBindings>,
  result:
    | Exclude<EmailCheck, { ok: true }>
    | { ok: false; reason: "unknown_folder" },
) {
  switch (result.reason) {
    case "login_failed":
      return c.json({ error: result.reason, step: result.step }, 422);
    case "not_offered":
      return c.json({ error: result.reason }, 404);
    case "not_entitled":
    case "deletion_pending":
      return c.json({ error: result.reason }, 403);
    case "too_many_attempts":
      return c.json({ error: result.reason }, 429);
    default:
      return c.json({ error: result.reason }, 422);
  }
}

/** The refusals both the test and the connect route answer before any mailbox login. */
const beforeLoginOutcomes = {
  403: json(
    ErrorBody,
    "Pilot access is not active (not_entitled) or deletion is pending (deletion_pending).",
  ),
  404: json(ErrorBody, "Email isn't offered (not_offered)."),
  429: json(
    ErrorBody,
    "More than 10 mailbox logins in 15 minutes (too_many_attempts); nothing was tried.",
  ),
};

export function registerIntegrationRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/integrations",
      responses: {
        200: json(
          z.object({ integrations: z.array(Integration) }),
          "The offered Integrations, by name; hidden and withdrawn ones are left out.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const catalog = c.get("integrationCatalog");
      const [offered, connections] = await Promise.all([
        catalog.offered(),
        c.get("connections").list(p),
      ]);
      const tools = await Promise.all(
        offered.map((integration) => catalog.tools(integration.key)),
      );
      return c.json(
        {
          integrations: offered.map((integration, index) => {
            const connection = connections.find(
              (row) => row.integrationKey === integration.key,
            );
            return {
              key: integration.key,
              name: integration.name,
              logo: integration.logo,
              description: integration.description,
              dataNote: integration.dataNote,
              kind: integration.kind,
              connection: connection ? toConnection(connection) : null,
              tools: tools[index]!.flatMap((tool) =>
                tool.class === "blocked"
                  ? []
                  : [{ label: tool.label, class: tool.class }],
              ),
            };
          }),
        },
        200,
      );
    },
  );

  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/connections/{integrationKey}",
      request: { params: IntegrationKey },
      responses: {
        200: json(
          ConnectionDetail,
          "The student's Connection with its tools; never its credentials.",
        ),
        401: errors[401],
        404: json(ErrorBody, "The student has no Connection to it (gone)."),
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const detail = await c
        .get("connections")
        .read(p, c.req.valid("param").integrationKey);
      if (!detail) return c.json({ error: "gone" }, 404);
      return c.json(
        {
          key: detail.key,
          name: detail.name,
          logo: detail.logo,
          kind: detail.kind,
          connection: toConnection(detail.connection),
          tools: detail.tools,
        },
        200,
      );
    },
  );

  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/connections/{integrationKey}/tools/{toolName}",
      request: {
        params: ToolParams,
        ...body(z.object({ mode: z.enum(["ask", "always_allowed"]) })),
      },
      responses: {
        200: Done,
        400: json(ErrorBody, "Not valid."),
        401: errors[401],
        404: json(ErrorBody, "The student has no Connection to it (gone)."),
        422: json(
          ErrorBody,
          "not_grantable: only a write tool nunio classified can be Immer erlaubt; never one that always asks, " +
            "a Chat-only, read, blocked or unclassified tool.",
        ),
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const { integrationKey, toolName } = c.req.valid("param");
      const result = await c
        .get("connections")
        .setToolMode(p, integrationKey, toolName, c.req.valid("json").mode);
      if (result.ok) return c.json({ status: "ok" as const }, 200);
      return result.reason === "gone"
        ? c.json({ error: result.reason }, 404)
        : c.json({ error: result.reason }, 422);
    },
  );

  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/connections/email/folders",
      responses: {
        200: json(
          z.object({ folders: z.array(MailFolder) }),
          "The mailbox's folders, listed with the stored login; nothing was stored.",
        ),
        401: errors[401],
        404: json(ErrorBody, "The student has no Email Connection (gone)."),
        422: FolderRefused,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const result = await c.get("connections").mailboxFolders(p);
      if (!result.ok) return folderRefused(c, result);
      return c.json({ folders: result.folders }, 200);
    },
  );

  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/connections/email/folders",
      request: body(
        z.object({
          folders: z
            .array(z.string().min(1).max(1000))
            .min(1)
            .max(200)
            .describe("The folders nunio may read, by IMAP path."),
        }),
      ),
      responses: {
        200: Done,
        400: json(ErrorBody, "Not valid."),
        401: errors[401],
        404: json(ErrorBody, "The student has no Email Connection (gone)."),
        422: FolderRefused,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("connections")
        .setFolders(p, c.req.valid("json").folders);
      if (!result.ok) return folderRefused(c, result);
      return c.json({ status: "ok" as const }, 200);
    },
  );

  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/connections/email/discover",
      request: body(z.object({ address: z.email() })),
      responses: {
        200: json(
          Discovery,
          "What nunio knows about the address's mail servers.",
        ),
        400: json(ErrorBody, "Not valid."),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const { address } = c.req.valid("json");
      return c.json(c.get("connections").discoverEmail(address), 200);
    },
  );

  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/connections/email/test",
      request: body(EmailLogin),
      responses: {
        200: json(
          z.object({ folders: z.array(MailFolder) }),
          "Reading (IMAP) and sending (SMTP) work; nothing was sent or stored.",
        ),
        400: json(ErrorBody, "Not valid."),
        401: errors[401],
        ...beforeLoginOutcomes,
        422: LoginFailed,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("connections")
        .testEmail(p, c.req.valid("json"));
      if (!result.ok) return refused(c, result);
      return c.json({ folders: result.folders }, 200);
    },
  );

  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/connections/email",
      request: body(
        EmailLogin.extend({
          folders: z
            .array(z.string().min(1).max(1000))
            .min(1)
            .max(200)
            .describe("The folders nunio may read, by IMAP path."),
        }),
      ),
      responses: {
        201: json(
          z.object({ connection: Connection }),
          "Tested again and saved, with the credentials encrypted.",
        ),
        400: json(ErrorBody, "Not valid."),
        401: errors[401],
        ...beforeLoginOutcomes,
        409: json(ErrorBody, "The student already has an Email Connection."),
        422: LoginFailed,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("connections")
        .connectEmail(p, c.req.valid("json"));
      if (!result.ok)
        return result.reason === "already_connected"
          ? c.json({ error: result.reason }, 409)
          : refused(c, result);
      return c.json({ connection: toConnection(result.connection) }, 201);
    },
  );
}

const IntegrationKey = z.object({
  integrationKey: z.string().min(1).max(100),
});

/** The OAuth routes: starting at the vendor, the vendor's redirect back, and nunio's Client ID Metadata Document. */
export function registerOAuthRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/oauth/client-metadata.json",
      responses: {
        200: json(
          z
            .object({
              client_id: z.string().describe("This document's own URL."),
              client_name: z.string(),
              redirect_uris: z.array(z.string()),
              grant_types: z.array(z.string()),
              response_types: z.array(z.string()),
              token_endpoint_auth_method: z.literal("none"),
            })
            .openapi("ClientIdMetadataDocument"),
          "nunio's Client ID Metadata Document: a public client whose id is this URL, with each Integration's callback.",
        ),
      },
    }),
    async (c) =>
      c.json(await c.get("connections").clientMetadataDocument(), 200),
  );

  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/connections/{integrationKey}/oauth",
      request: { params: IntegrationKey },
      responses: {
        200: json(
          z.object({
            authorizationUrl: z
              .string()
              .describe("The vendor's sign-in page, asking for every scope."),
          }),
          "The flow is stored for 10 minutes, bound to this session; the browser goes to the vendor next.",
        ),
        401: errors[401],
        403: json(
          ErrorBody,
          "Pilot access is not active (not_entitled) or deletion is pending (deletion_pending).",
        ),
        404: json(ErrorBody, "Not an offered OAuth Integration (not_offered)."),
        409: json(
          ErrorBody,
          "The student already has a Connection to it (already_connected).",
        ),
        422: json(
          ErrorBody,
          "issuer_refused: the server named an authorization server nunio doesn't allow for it. " +
            "authorization_failed: discovering or registering at the vendor failed. Nothing was stored.",
        ),
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("connections")
        .startOAuth(
          principal.fromSession(actor),
          actor.sessionId,
          c.req.valid("param").integrationKey,
        );
      if (result.ok)
        return c.json({ authorizationUrl: result.authorizationUrl }, 200);
      switch (result.reason) {
        case "not_offered":
          return c.json({ error: result.reason }, 404);
        case "not_entitled":
        case "deletion_pending":
          return c.json({ error: result.reason }, 403);
        case "already_connected":
          return c.json({ error: result.reason }, 409);
        default:
          return c.json({ error: result.reason }, 422);
      }
    },
  );

  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/connections/{integrationKey}/oauth/callback",
      request: {
        params: IntegrationKey,
        // Never refused: whatever the vendor sends, the student goes back to the dialog.
        query: z.object({
          state: z.string().optional(),
          code: z.string().optional(),
          iss: z.string().optional(),
          error: z.string().optional(),
        }),
      },
      responses: {
        302: {
          description:
            "Back to Einstellungen › Verbindungen: with the Connection made, or with `connect` naming the " +
            "Integration and `error` the reason (cancelled, expired, already_connected or failed), nothing stored.",
        },
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const { integrationKey } = c.req.valid("param");
      const back = new URL("/settings/connections", c.get("appOrigin"));
      const actor = await c.get("auth").authenticate(c.req.raw);
      const result = actor
        ? await c
            .get("connections")
            .finishOAuth(
              principal.fromSession(actor),
              actor.sessionId,
              integrationKey,
              c.req.valid("query"),
            )
        : ({ ok: false, reason: "expired" } as const);
      if (!result.ok) {
        back.searchParams.set("connect", integrationKey);
        back.searchParams.set("error", result.reason);
      }
      return c.redirect(back.href, 302);
    },
  );
}
