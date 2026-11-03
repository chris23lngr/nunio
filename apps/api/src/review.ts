import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { CourseStatus, FactType, ObligationKind, ReviewState, Unsupported } from "@nunio/db";
import { principal } from "@nunio/delegation";
import type { AppBindings } from "./app.js";

const Provenance = z.discriminatedUnion("kind", [z.object({ kind: z.literal("correction") }),
  z.object({ kind: z.literal("source"), sourceId: z.string(), title: z.string(), page: z.number().int(), quote: z.string() })]);
const Citation = z.object({ extractionId: z.string(), sourceId: z.string(), title: z.string(), page: z.number().int(), quote: z.string() });
const Due = z.object({ date: z.string().nullable(), time: z.string().nullable(), timeZone: z.string().nullable() });
const item = {
  id: z.string(), state: z.enum(ReviewState), uncertainty: z.string().nullable(), provenance: Provenance,
  disagreement: z.boolean().describe("Values that are not overruled differ from each other or from the Correction."),
  unsupported: z.enum(Unsupported).nullable().describe("Set when a corrected item lost its last extraction."),
};
const cited = { overruled: z.boolean(), citations: z.array(Citation) };
const Obligation = z.object({ ...item, kind: z.enum(ObligationKind), title: z.string(),
  due: Due.extend({ text: z.string().nullable().describe("The Source's wording; null for a Correction.") }),
  destination: z.string().nullable().describe("As stated in the Source, or the student's Correction; never verified."),
  values: z.array(z.object({ due: Due, ...cited })) }).openapi("Obligation");
const Fact = z.object({ ...item, type: z.enum(FactType), value: z.string(),
  values: z.array(z.object({ value: z.string(), ...cited })) }).openapi("Fact");
const Correction = z.union([
  z.object({ title: z.string().min(1).max(500), due: Due, destination: z.string().max(500).nullable() }).strict(),
  z.object({ value: z.string().min(1).max(2000) }).strict(),
]).openapi("Correction");
const Course = z.object({ id: z.string(), code: z.string().nullable(), title: z.string(), status: z.enum(CourseStatus),
  obligations: z.array(Obligation), facts: z.array(Fact) }).openapi("Course");
const ErrorBody = z.object({ error: z.string() });
const json = (schema: z.ZodType, description: string) => ({ description, content: { "application/json": { schema } } });
const errors = { 401: json(ErrorBody, "Sign in required."), 404: json(ErrorBody, "Item or Course is gone.") };
const itemParams = { kind: z.enum(["obligation", "fact"]), id: z.string().uuid() };
const Done = json(z.object({ status: z.literal("ok") }), "Recorded.");

export function registerReviewRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(createRoute({ method: "get", path: "/api/me/review", responses: {
    200: json(z.object({ courses: z.array(Course) }), "Every Course and its items; a rejected Course lists no items until restored."), ...errors,
  } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    return c.json(await c.get("facts").review(principal.fromSession(actor)), 200);
  });
  // Before the generic action route, which would otherwise claim "correct" and "use" as actions.
  routes.openapi(createRoute({ method: "post", path: "/api/me/review/{kind}/{id}/correct", request: {
    params: z.object(itemParams),
    body: { required: true, content: { "application/json": { schema: Correction } } },
  }, responses: { 200: Done, 400: json(ErrorBody, "Not a valid Correction for this item."), ...errors } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const result = await c.get("facts").correct(principal.fromSession(actor), c.req.valid("param"), c.req.valid("json"));
    if (result.status === "invalid") return c.json({ error: "invalid_correction" }, 400);
    if (result.status === "gone") return c.json({ error: "gone" }, 404);
    return c.json({ status: "ok" as const }, 200);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/review/{kind}/{id}/use", description: "Use this extracted value.", request: {
    params: z.object(itemParams),
    body: { required: true, content: { "application/json": { schema: z.object({ extractionId: z.string().uuid() }) } } },
  }, responses: { 200: Done, ...errors } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const result = await c.get("facts").use(principal.fromSession(actor), c.req.valid("param"), c.req.valid("json").extractionId);
    if (result.status === "gone") return c.json({ error: "gone" }, 404);
    return c.json({ status: "ok" as const }, 200);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/review/{kind}/{id}/{action}", request: {
    params: z.object({ ...itemParams, action: z.enum(["confirm", "reject", "restore", "keep_mine"]) }),
  }, responses: { 200: Done, ...errors } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const { kind, id, action } = c.req.valid("param");
    const facts = c.get("facts"), p = principal.fromSession(actor);
    const result = await { confirm: facts.confirm, reject: facts.reject, restore: facts.restore, keep_mine: facts.keepMine }[action](p, { kind, id });
    if (result.status === "gone") return c.json({ error: "gone" }, 404);
    return c.json({ status: "ok" as const }, 200);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/courses/{id}/decision", request: {
    params: z.object({ id: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: z.object({ decision: z.enum(["accept", "reject", "restore"]) }) } } },
  }, responses: { 200: Done, ...errors } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const result = await c.get("facts").decideCourse(principal.fromSession(actor), c.req.valid("param").id, c.req.valid("json").decision);
    if (result.status === "gone") return c.json({ error: "gone" }, 404);
    return c.json({ status: "ok" as const }, 200);
  });
}
