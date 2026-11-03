import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { ExtractionStatus, SourceFailure, SourceStatus } from "@nunio/db";
import { principal } from "@nunio/delegation";
import { maxSourceBytes } from "@nunio/knowledge";
import type { AppBindings } from "./app.js";

const Source = z.object({ id: z.string(), title: z.string(), status: z.enum(SourceStatus),
  failure: z.enum(SourceFailure).nullable().openapi({ description: "Why processing stopped, when the student can act on it." }),
  extraction: z.enum(ExtractionStatus) }).openapi("Source");
const ErrorBody = z.object({ error: z.string() });
const json = (schema: z.ZodType, description: string) => ({ description, content: { "application/json": { schema } } });
const errors = { 401: json(ErrorBody, "Sign in required."), 403: json(ErrorBody, "Pilot access is not active or deletion is pending."),
  404: json(ErrorBody, "Source is gone.") };
const params = z.object({ id: z.string().uuid() });
export function registerSourceRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(createRoute({ method: "get", path: "/api/me/sources", responses: {
    200: json(z.array(Source), "The student's live Sources."), ...errors,
  } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const sources = c.get("sources");
    return c.json(await sources.list(principal.fromSession(actor)), 200);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/sources", request: { body: { required: true,
    content: { "application/json": { schema: z.object({ title: z.string().min(1).max(255), bytes: z.number().int().positive().max(maxSourceBytes), type: z.literal("application/pdf") }) } } } },
  responses: { 201: json(z.object({ source: Source, upload: z.object({ url: z.string(), headers: z.record(z.string(), z.string()), expiresAt: z.string() }) }), "Upload directly to quarantine using PUT and these headers."), ...errors },
  }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const sources = c.get("sources");
    const result = await sources.upload(principal.fromSession(actor), c.req.valid("json"));
    if (result.status === "refused") return c.json({ error: result.reason }, 403);
    return c.json({ source: result.source, upload: { ...result.upload, expiresAt: result.upload.expiresAt.toISOString() } }, 201);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/sources/{id}/extract", description: "Read again: extract a ready Source anew.",
    request: { params }, responses: {
      202: json(z.object({ status: z.literal("queued") }), "Extraction queued and metered again; repeating while it waits is idempotent."),
      409: json(ErrorBody, "Extraction is running."), ...errors,
    } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const id = c.req.valid("param").id;
    const result = await c.get("facts").requestExtraction(principal.fromSession(actor), id);
    if (result.status === "gone") return c.json({ error: "gone" }, 404);
    if (result.status === "running") return c.json({ error: "running" }, 409);
    await c.get("sourceWorkflows").start("extractSource", actor.studentId, id);
    return c.json({ status: "queued" as const }, 202);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/sources/{id}/complete", request: { params }, responses: {
    202: json(z.object({ status: z.literal("queued") }), "Ingestion queued; repeating is idempotent."), ...errors,
  } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const sources = c.get("sources"), workflows = c.get("sourceWorkflows");
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
    const id = c.req.valid("param").id;
    const result = await sources.removeWithCleanup(principal.fromSession(actor), id,
      cleanupAfter => workflows.start("deleteSource", actor.studentId, id, cleanupAfter.toISOString()));
    if (result.status === "gone") return c.json({ error: "gone" }, 404);
    return c.json({ status: "deleted" as const }, 202);
  });
}
