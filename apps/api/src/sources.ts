import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { principal } from "@nunio/delegation";
import type { AppBindings } from "./app.js";

const Source = z.object({ id: z.string(), title: z.string(), status: z.string() }).openapi("Source");
const ErrorBody = z.object({ error: z.string() });
const json = (schema: z.ZodType, description: string) => ({ description, content: { "application/json": { schema } } });
const errors = { 401: json(ErrorBody, "Sign in required."), 403: json(ErrorBody, "Pilot access is not active or deletion is pending."),
  404: json(ErrorBody, "Source is gone."), 503: json(ErrorBody, "Source processing is unavailable.") };
const params = z.object({ id: z.string().uuid() });
export function registerSourceRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(createRoute({ method: "get", path: "/api/me/sources", responses: {
    200: json(z.array(Source), "The student's live Sources."), ...errors,
  } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const sources = c.get("sources");
    if (!sources) return c.json({ error: "unavailable" }, 503);
    return c.json(await sources.list(principal.fromSession(actor)), 200);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/sources", request: { body: { required: true,
    content: { "application/json": { schema: z.object({ title: z.string().min(1).max(255), bytes: z.number().int().positive().max(20 * 1024 * 1024), type: z.literal("application/pdf") }) } } } },
  responses: { 201: json(z.object({ source: Source, upload: z.object({ url: z.string(), headers: z.record(z.string(), z.string()), expiresAt: z.string() }) }), "Upload directly to quarantine using PUT and these headers."), ...errors },
  }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const sources = c.get("sources");
    if (!sources) return c.json({ error: "unavailable" }, 503);
    const result = await sources.upload(principal.fromSession(actor), c.req.valid("json"));
    if (result.status === "refused") return c.json({ error: result.reason }, 403);
    return c.json({ source: result.source, upload: { ...result.upload, expiresAt: result.upload.expiresAt.toISOString() } }, 201);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/sources/{id}/complete", request: { params }, responses: {
    202: json(z.object({ status: z.literal("queued") }), "Ingestion Run queued; repeating is idempotent."), ...errors,
  } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const sources = c.get("sources"), workflows = c.get("sourceWorkflows");
    if (!sources || !workflows) return c.json({ error: "unavailable" }, 503);
    const id = c.req.valid("param").id;
    const result = await sources.complete(principal.fromSession(actor), id);
    if (result.status === "gone") return c.json({ error: "gone" }, 404);
    if (result.status === "refused") return c.json({ error: result.reason }, 403);
    await workflows.start("ingestSource", actor.studentId, id);
    return c.json({ status: "queued" as const }, 202);
  });
  routes.openapi(createRoute({ method: "delete", path: "/api/me/sources/{id}", request: { params }, responses: {
    202: json(z.object({ status: z.literal("deleted") }), "Key and derived rows removed. Object cleanup queued."), ...errors,
  } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const sources = c.get("sources"), workflows = c.get("sourceWorkflows");
    if (!sources || !workflows) return c.json({ error: "unavailable" }, 503);
    const id = c.req.valid("param").id;
    const result = await sources.remove(principal.fromSession(actor), id,
      cleanupAfter => workflows.start("deleteSource", actor.studentId, id, cleanupAfter.toISOString()));
    if (result.status === "gone") return c.json({ error: "gone" }, 404);
    return c.json({ status: "deleted" as const }, 202);
  });
}
