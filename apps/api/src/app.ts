import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";

const HealthSchema = z.object({ status: z.literal("ok") }).openapi("Health");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: { "application/json": { schema: HealthSchema } },
      description: "The API is running.",
    },
  },
});

/** The documented routes; `openapi.json` is generated from these. */
export const routes = new OpenAPIHono();

routes.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

export const openApiConfig = {
  openapi: "3.1.0",
  info: { title: "nunio API", version: "0.0.0" },
};
