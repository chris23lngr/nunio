import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { pilotStatus } from "@nunio/billing";
import type { PrismaClient } from "@nunio/db";
import type { Auth } from "@nunio/identity";

export interface AppBindings {
  Variables: { auth: Auth; prisma: PrismaClient };
}

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
export const routes = new OpenAPIHono<AppBindings>();

routes.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

const PilotEntitlementSchema = z.object({ status: z.enum(["none", "active", "revoked"]) }).openapi("PilotEntitlement");
const UnauthorizedSchema = z.object({ error: z.literal("unauthorized") }).openapi("Unauthorized");

routes.openapi(createRoute({
  method: "get",
  path: "/api/me/entitlement",
  responses: {
    200: {
      content: { "application/json": { schema: PilotEntitlementSchema } },
      description: "The current student's pilot status. Active pilot access has no fixed expiry.",
    },
    401: {
      content: { "application/json": { schema: UnauthorizedSchema } },
      description: "A current, verified session is required.",
    },
  },
}), async c => {
  c.header("cache-control", "no-store");
  const actor = await c.get("auth").authenticate(c.req.raw);
  if (!actor) return c.json({ error: "unauthorized" as const }, 401);
  return c.json({ status: await pilotStatus(c.get("prisma"), actor.studentId) }, 200);
});

export const openApiConfig = {
  openapi: "3.1.0",
  info: { title: "nunio API", version: "0.0.0" },
};
