import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { CourseStatus, FactType, ObligationKind, ReviewState } from "@nunio/db";
import { principal } from "@nunio/delegation";
import type { AppBindings } from "./app.js";

const Provenance = z.object({ kind: z.literal("source"), sourceId: z.string(), title: z.string(), page: z.number().int(), quote: z.string() });
const Obligation = z.object({
  id: z.string(), kind: z.enum(ObligationKind), title: z.string(), state: z.enum(ReviewState),
  due: z.object({ date: z.string().nullable(), time: z.string().nullable(), timeZone: z.string().nullable(), text: z.string() }),
  destination: z.string().nullable().describe("As stated in the Source; never verified."), uncertainty: z.string().nullable(), provenance: Provenance,
}).openapi("Obligation");
const Fact = z.object({ id: z.string(), type: z.enum(FactType), value: z.string(), uncertainty: z.string().nullable(),
  state: z.enum(ReviewState), provenance: Provenance }).openapi("Fact");
const Course = z.object({ id: z.string(), code: z.string().nullable(), title: z.string(), status: z.enum(CourseStatus),
  obligations: z.array(Obligation), facts: z.array(Fact) }).openapi("Course");
const ErrorBody = z.object({ error: z.string() });
const json = (schema: z.ZodType, description: string) => ({ description, content: { "application/json": { schema } } });
const errors = { 401: json(ErrorBody, "Sign in required."), 404: json(ErrorBody, "Item or Course is gone.") };
const Done = json(z.object({ status: z.literal("ok") }), "Recorded.");

export function registerReviewRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(createRoute({ method: "get", path: "/api/me/review", responses: {
    200: json(z.object({ courses: z.array(Course) }), "Extracted Courses and their items, without rejected ones."), ...errors,
  } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    return c.json(await c.get("facts").review(principal.fromSession(actor)), 200);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/review/{kind}/{id}/{action}", request: {
    params: z.object({ kind: z.enum(["obligation", "fact"]), id: z.string().uuid(), action: z.enum(["confirm", "reject"]) }),
  }, responses: { 200: Done, ...errors } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const { kind, id, action } = c.req.valid("param");
    const facts = c.get("facts"), p = principal.fromSession(actor);
    const result = action === "confirm" ? await facts.confirm(p, { kind, id }) : await facts.reject(p, { kind, id });
    if (result.status === "gone") return c.json({ error: "gone" }, 404);
    return c.json({ status: "ok" as const }, 200);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/courses/{id}/decision", request: {
    params: z.object({ id: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: z.object({ decision: z.enum(["accept", "reject"]) }) } } },
  }, responses: { 200: Done, ...errors } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const result = await c.get("facts").decideCourse(principal.fromSession(actor), c.req.valid("param").id, c.req.valid("json").decision);
    if (result.status === "gone") return c.json({ error: "gone" }, 404);
    return c.json({ status: "ok" as const }, 200);
  });
}
