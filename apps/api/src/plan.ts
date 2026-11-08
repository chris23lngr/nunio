import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { principal } from "@nunio/delegation";
import type { AppBindings } from "./app.js";

const Actor = z.enum(["nunio", "student"]);
const Work = z.object({ kind: z.enum(["obligation", "task"]), id: z.string().uuid() });
const Span = z.object({ start: z.coerce.date(), end: z.coerce.date() });
const Move = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), workId: z.string(), start: z.coerce.date(), end: z.coerce.date(), needsApproval: z.boolean() }),
  z.object({ kind: z.literal("move"), blockId: z.string(), workId: z.string(), from: Span, to: Span, needsApproval: z.boolean() }),
]).openapi("PlanMove");
const Tradeoff = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exceed_daily_limit"), gainedMinutes: z.number().int(), needsApproval: z.literal(true) }),
  z.object({ kind: z.literal("free_time_from"), workId: z.string(), blockIds: z.array(z.string()), gainedMinutes: z.number().int(), needsApproval: z.boolean() }),
  z.object({ kind: z.literal("reduce_estimate"), workId: z.string(), byMinutes: z.number().int() }),
]);
const Estimate = z.object({ minutes: z.number().int(), estimatedBy: Actor, rationale: z.string().nullable() });
const PlanView = z.object({
  obligations: z.array(z.object({ id: z.string(), courseId: z.string(), course: z.string(), title: z.string(),
    kind: z.enum(["exam", "assignment", "presentation", "thesis", "registration", "other"]),
    state: z.enum(["unreviewed", "confirmed", "rejected"]), due: z.date().nullable(), estimate: Estimate.nullable() })),
  tasks: z.array(z.object({ id: z.string(), title: z.string(), obligationId: z.string().nullable(),
    estimate: z.object({ minutes: z.number().int(), estimatedBy: Actor }).nullable(), done: z.boolean() })),
  studyBlocks: z.array(z.object({ id: z.string(), work: Work, start: z.date(), end: z.date(), placedBy: Actor, locked: z.boolean() })),
  limits: z.object({
    preferences: z.object({ timeZone: z.string(), studyFromMinute: z.number().int(), studyToMinute: z.number().int(), maxMinutesPerDay: z.number().int() }),
    protectedTime: z.array(z.object({ id: z.string(), weekday: z.number().int(), fromMinute: z.number().int(), toMinute: z.number().int() })),
  }),
  proposal: z.object({
    moves: z.array(Move),
    unplanned: z.array(z.object({ workId: z.string(), reason: z.enum(["no_estimate", "no_deadline", "past_due"]) })),
    shortfalls: z.array(z.object({ workId: z.string(), due: z.date(), shortMinutes: z.number().int(), tradeoffs: z.array(Tradeoff) })),
    lockedConflicts: z.array(z.string()),
  }).describe("What a Rebalance would change now. Moves the student applies count as their own decisions."),
}).openapi("Plan");
const ErrorBody = z.object({ error: z.string() });
const json = (schema: z.ZodType, description: string) => ({ description, content: { "application/json": { schema } } });
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { "application/json": { schema } } } });
const Done = json(z.object({ status: z.literal("ok") }), "Recorded.");
const Created = json(z.object({ id: z.string() }), "Created.");
const errors = { 401: json(ErrorBody, "Sign in required."), 404: json(ErrorBody, "It is gone or not the student's.") };
/** Every way a Plan change can fail, shared by the routes that change the Plan. */
const outcomes = { 400: json(ErrorBody, "Not valid."), 409: json(ErrorBody, "The move no longer matches a fresh proposal."), ...errors };
const id = z.object({ id: z.string().uuid() });
type Result = { status: "ok" | "gone" | "invalid" | "stale"; id?: string };

/** Maps a failed Plan change to its response the same way for every route. */
function failed(c: Context<AppBindings>, status: "gone" | "invalid" | "stale") {
  if (status === "invalid") return c.json({ error: "invalid" }, 400);
  if (status === "gone") return c.json({ error: "gone" }, 404);
  return c.json({ error: "stale" }, 409);
}
const done = (c: Context<AppBindings>, result: Result) => result.status === "ok" ? c.json({ status: "ok" as const }, 200) : failed(c, result.status);
const created = (c: Context<AppBindings>, result: Result) => result.status === "ok" ? c.json({ id: result.id! }, 201) : failed(c, result.status);
/** The signed-in student, setting no-store on every Plan response. */
async function student(c: Context<AppBindings>) {
  c.header("cache-control", "no-store");
  const actor = await c.get("auth").authenticate(c.req.raw);
  return actor && principal.fromSession(actor);
}

export function registerPlanRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(createRoute({ method: "get", path: "/api/me/plan", responses: { 200: json(PlanView, "The Plan and a Rebalance proposal."), 401: errors[401] } }),
    async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return c.json(await c.get("plan").view(p), 200);
    });
  routes.openapi(createRoute({ method: "post", path: "/api/me/plan/apply", request: body(Move),
    responses: { 200: Done, ...outcomes } }),
    async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(c, await c.get("plan").apply(p, c.req.valid("json")));
    });
  routes.openapi(createRoute({ method: "post", path: "/api/me/plan/estimates",
    responses: { 200: json(z.object({ proposed: z.number().int() }), "Estimates proposed for Obligations that had none."),
      403: json(ErrorBody, "Usage is refused, such as an exhausted Allowance."), 401: errors[401] } }), async c => {
    const p = await student(c);
    if (!p) return c.json({ error: "unauthorized" }, 401);
    const result = await c.get("plan").proposeEstimates(p, { estimator: c.get("estimator"), delegation: c.get("delegation") });
    if (result.status === "refused") return c.json({ error: result.reason }, 403);
    return c.json({ proposed: result.proposed }, 200);
  });
  routes.openapi(createRoute({ method: "put", path: "/api/me/estimates/{kind}/{id}", request: {
    params: Work, ...body(z.object({ minutes: z.number().int() }).strict()) }, responses: { 200: Done, ...outcomes } }),
    async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(c, await c.get("plan").estimate(p, c.req.valid("param"), c.req.valid("json").minutes));
    });
  routes.openapi(createRoute({ method: "post", path: "/api/me/tasks", request: body(z.object({ title: z.string(), obligationId: z.string().uuid().nullable() }).strict()),
    responses: { 201: Created, ...outcomes } }), async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return created(c, await c.get("plan").addTask(p, c.req.valid("json")));
    });
  routes.openapi(createRoute({ method: "post", path: "/api/me/tasks/{id}/done", request: { params: id, ...body(z.object({ done: z.boolean() }).strict()) },
    responses: { 200: Done, ...outcomes } }), async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(c, await c.get("plan").completeTask(p, c.req.valid("param").id, c.req.valid("json").done));
    });
  routes.openapi(createRoute({ method: "post", path: "/api/me/study-blocks", request: body(Span.extend({ work: Work }).strict()),
    responses: { 201: Created, ...outcomes } }), async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return created(c, await c.get("plan").placeBlock(p, c.req.valid("json")));
    });
  routes.openapi(createRoute({ method: "patch", path: "/api/me/study-blocks/{id}", request: { params: id, ...body(Span.strict()) },
    responses: { 200: Done, ...outcomes } }), async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(c, await c.get("plan").moveBlock(p, c.req.valid("param").id, c.req.valid("json")));
    });
  routes.openapi(createRoute({ method: "post", path: "/api/me/study-blocks/{id}/lock", request: { params: id, ...body(z.object({ locked: z.boolean() }).strict()) },
    responses: { 200: Done, ...outcomes } }), async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(c, await c.get("plan").lockBlock(p, c.req.valid("param").id, c.req.valid("json").locked));
    });
  routes.openapi(createRoute({ method: "delete", path: "/api/me/study-blocks/{id}", request: { params: id }, responses: { 200: Done, ...outcomes } }),
    async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(c, await c.get("plan").removeBlock(p, c.req.valid("param").id));
    });
  routes.openapi(createRoute({ method: "put", path: "/api/me/preferences",
    request: body(z.object({ studyFromMinute: z.number().int(), studyToMinute: z.number().int(), maxMinutesPerDay: z.number().int() }).strict()),
    responses: { 200: Done, ...outcomes } }), async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(c, await c.get("plan").setPreferences(p, c.req.valid("json")));
    });
  routes.openapi(createRoute({ method: "post", path: "/api/me/protected-time",
    request: body(z.object({ weekday: z.number().int(), fromMinute: z.number().int(), toMinute: z.number().int() }).strict()),
    responses: { 201: Created, ...outcomes } }), async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return created(c, await c.get("plan").addProtectedTime(p, c.req.valid("json")));
    });
  routes.openapi(createRoute({ method: "delete", path: "/api/me/protected-time/{id}", request: { params: id }, responses: { 200: Done, ...outcomes } }),
    async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(c, await c.get("plan").removeProtectedTime(p, c.req.valid("param").id));
    });
  routes.openapi(createRoute({ method: "put", path: "/api/me/priorities", request: body(z.object({ courseIds: z.array(z.string().uuid()).max(100) }).strict()),
    responses: { 200: Done, ...outcomes } }), async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(c, await c.get("plan").rankCourses(p, c.req.valid("json").courseIds));
    });
}
