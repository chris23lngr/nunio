import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { pilotStatus } from "@nunio/billing";
import type { PrismaClient } from "@nunio/db";
import { principal } from "@nunio/delegation";
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
  return c.json({ status: await pilotStatus(c.get("prisma"), principal.fromSession(actor)) }, 200);
});

const DeletionRequestSchema = z.object({ password: z.string() }).openapi("DeletionRequest");
const DeletionPendingSchema = z.object({ status: z.literal("pending") }).openapi("DeletionPending");
const InvalidPasswordSchema = z.object({ error: z.literal("invalid_password") }).openapi("InvalidPassword");

routes.openapi(createRoute({
  method: "post",
  path: "/api/me/deletion-request",
  request: { body: { content: { "application/json": { schema: DeletionRequestSchema } }, required: true } },
  responses: {
    202: {
      content: { "application/json": { schema: DeletionPendingSchema } },
      description: "Deletion is queued for manual completion; every session of the student has ended.",
    },
    401: {
      content: { "application/json": { schema: UnauthorizedSchema } },
      description: "A current, verified session is required.",
    },
    403: {
      content: { "application/json": { schema: InvalidPasswordSchema } },
      description: "The password does not match; nothing was recorded and sessions remain.",
    },
  },
}), async c => {
  const result = await c.get("auth").requestDeletion(c.req.raw, c.req.valid("json").password);
  if (result === "unauthorized") return c.json({ error: "unauthorized" as const }, 401);
  if (result === "invalid_password") return c.json({ error: "invalid_password" as const }, 403);
  return c.json({ status: "pending" as const }, 202);
});

export const openApiConfig = {
  openapi: "3.1.0",
  info: { title: "nunio API", version: "0.0.0" },
};
