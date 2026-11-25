import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { ConnectionSummary, EmailCheck } from "@nunio/integrations";
import type { Context } from "hono";
import type { AppBindings } from "./app.js";
import { body, ErrorBody, errors, json, student } from "./outcomes.js";

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
    connection: Connection.nullable().describe(
      "The student's Connection to it, or null when they have none.",
    ),
  })
  .openapi("Integration");

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

/** A Connection as the API returns it; never its credentials. */
const toConnection = (connection: ConnectionSummary) => ({
  state: connection.state,
  accountLabel: connection.accountLabel,
  folders: connection.folders,
  agentCount: connection.agentCount,
});

/** Answers a failed mailbox test; nothing was stored. */
function refused(
  c: Context<AppBindings>,
  result:
    | Exclude<EmailCheck, { ok: true }>
    | { ok: false; reason: "unknown_folder" },
) {
  return result.reason === "login_failed"
    ? c.json({ error: result.reason, step: result.step }, 422)
    : c.json({ error: result.reason }, 422);
}

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
      const [offered, connections] = await Promise.all([
        c.get("integrationCatalog").offered(),
        c.get("connections").list(p),
      ]);
      return c.json(
        {
          integrations: offered.map((integration) => {
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
            };
          }),
        },
        200,
      );
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
        422: LoginFailed,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const result = await c.get("connections").testEmail(c.req.valid("json"));
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
        404: json(ErrorBody, "Email isn't offered."),
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
      if (!result.ok) {
        if (result.reason === "not_offered")
          return c.json({ error: result.reason }, 404);
        if (result.reason === "already_connected")
          return c.json({ error: result.reason }, 409);
        return refused(c, result);
      }
      return c.json({ connection: toConnection(result.connection) }, 201);
    },
  );
}
