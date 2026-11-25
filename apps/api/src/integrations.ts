import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { AppBindings } from "./app.js";
import { errors, json, student } from "./outcomes.js";

const Connection = z.object({
  state: z.enum(["connected", "needs_reconnection"]),
  accountLabel: z
    .string()
    .describe("The account, such as the email address or workspace name."),
  agentCount: z
    .number()
    .int()
    .min(0)
    .describe("How many of the student's Agents use a tool of it."),
});

const Integration = z
  .object({
    key: z.string(),
    name: z.string(),
    logo: z.string().describe("The path of its logo in the web app."),
    description: z.string(),
    dataNote: z.string().describe("Where the vendor processes data."),
    connection: Connection.nullable().describe(
      "The student's Connection to it, or null when they have none.",
    ),
  })
  .openapi("Integration");

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
      const offered = await c.get("integrationCatalog").offered();
      return c.json(
        {
          // Connections come with Connect (#287); until then no student has one.
          integrations: offered.map((integration) => ({
            key: integration.key,
            name: integration.name,
            logo: integration.logo,
            description: integration.description,
            dataNote: integration.dataNote,
            connection: null,
          })),
        },
        200,
      );
    },
  );
}
