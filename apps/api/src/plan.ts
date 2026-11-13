import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { AppBindings } from "./app.js";
import {
  body,
  Created,
  created,
  Done,
  done,
  ErrorBody,
  errors,
  failed,
  id,
  json,
  outcomes,
  student,
} from "./outcomes.js";

const Actor = z.enum(["nunio", "student"]);
const Work = z.object({
  kind: z.enum(["obligation", "task"]),
  id: z.string().uuid(),
});
const Span = z.object({ start: z.coerce.date(), end: z.coerce.date() });
const Move = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("create"),
      workId: z.string(),
      start: z.coerce.date(),
      end: z.coerce.date(),
      needsApproval: z.boolean(),
    }),
    z.object({
      kind: z.literal("move"),
      blockId: z.string(),
      workId: z.string(),
      from: Span,
      to: Span,
      needsApproval: z.boolean(),
    }),
  ])
  .openapi("PlanMove");
export const Tradeoff = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("exceed_daily_limit"),
      gainedMinutes: z.number().int(),
      needsApproval: z.literal(true),
    }),
    z.object({
      kind: z.literal("free_time_from"),
      workId: z.string(),
      blockIds: z.array(z.string()),
      gainedMinutes: z.number().int(),
      needsApproval: z.boolean(),
    }),
    z.object({
      kind: z.literal("reduce_estimate"),
      workId: z.string(),
      byMinutes: z.number().int(),
    }),
  ])
  .openapi("Tradeoff");
const PriorityRef = z.object({
  kind: z.enum(["course", "project", "obligation"]),
  id: z.string().uuid(),
});
const Limit = z
  .object({ maxMinutesPerDay: z.number().int().nullable() })
  .strict();
const Estimate = z.object({
  minutes: z.number().int(),
  estimatedBy: Actor,
  rationale: z.string().nullable(),
});
const PlanView = z
  .object({
    obligations: z.array(
      z.object({
        id: z.string(),
        courseId: z.string(),
        course: z.string(),
        title: z.string(),
        kind: z.enum([
          "exam",
          "assignment",
          "presentation",
          "thesis",
          "registration",
          "other",
        ]),
        state: z.enum(["unreviewed", "confirmed", "rejected"]),
        reportedSubmittedAt: z
          .date()
          .nullable()
          .describe(
            "Reported as Submitted: the student's word, never verified; such work is no longer planned.",
          ),
        due: z.date().nullable(),
        estimate: Estimate.nullable(),
      }),
    ),
    tasks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        obligationId: z.string().nullable(),
        courseId: z
          .string()
          .nullable()
          .describe(
            "The Task's own Course; null for one toward an Obligation, which is in the Obligation's Course.",
          ),
        course: z
          .string()
          .nullable()
          .describe("The title of the Task's own Course."),
        estimate: Estimate.nullable(),
        maxMinutesPerDay: z
          .number()
          .int()
          .nullable()
          .describe(
            "The Task's own daily limit, which wins over its Course's.",
          ),
        done: z.boolean(),
        fixedEventId: z
          .string()
          .nullable()
          .describe("The Course Event a Routine's Task is for."),
        role: z
          .enum(["preparation", "follow_up"])
          .nullable()
          .describe(
            "Whether a Routine's Task prepares for its Course Event or follows up on it.",
          ),
        window: z
          .object({ start: z.date(), end: z.date() })
          .nullable()
          .describe(
            "When a Routine's Task is to be done: between the Course Events of its series around it (ADR-0021).",
          ),
      }),
    ),
    studyBlocks: z.array(
      z.object({
        id: z.string(),
        work: Work,
        start: z.date(),
        end: z.date(),
        placedBy: Actor,
        locked: z.boolean(),
      }),
    ),
    fixedEvents: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        start: z.date(),
        end: z.date(),
        calendarId: z
          .string()
          .nullable()
          .describe(
            "The calendar Source it was read from; null when entered by hand.",
          ),
        seriesId: z
          .string()
          .nullable()
          .describe("Its Event Series; null when entered by hand."),
        courseId: z
          .string()
          .nullable()
          .describe(
            "Its Course when it is a Course Event: one of a confirmed series the student did not take out.",
          ),
      }),
    ),
    eventSeries: z
      .array(
        z.object({
          id: z.string(),
          calendarId: z.string(),
          title: z.string(),
          courseId: z
            .string()
            .nullable()
            .describe("The Course nunio proposed or the student chose."),
          state: z
            .enum(["undecided", "proposed", "confirmed", "rejected"])
            .describe(
              "Only a confirmed series' events are Course Events; a rejected one belongs to no Course.",
            ),
        }),
      )
      .describe(
        "The Fixed Events of one calendar that share a title (ADR-0021).",
      ),
    calendars: z.array(
      z.object({ id: z.string(), name: z.string(), events: z.number().int() }),
    ),
    priorities: z
      .array(PriorityRef)
      .describe("The student's single ranking, most important first."),
    limits: z.object({
      preferences: z.object({
        timeZone: z.string(),
        studyFromMinute: z.number().int(),
        studyToMinute: z.number().int(),
        maxMinutesPerDay: z.number().int(),
      }),
      courses: z.array(
        z.object({ courseId: z.string(), maxMinutesPerDay: z.number().int() }),
      ),
      protectedTime: z.array(
        z.union([
          z.object({
            id: z.string(),
            weekday: z.number().int(),
            fromMinute: z.number().int(),
            toMinute: z.number().int(),
          }),
          z.object({ id: z.string(), start: z.date(), end: z.date() }),
        ]),
      ),
    }),
    proposal: z
      .object({
        moves: z.array(Move),
        unplanned: z.array(
          z.object({
            workId: z.string(),
            reason: z.enum(["no_estimate", "no_deadline", "past_due"]),
          }),
        ),
        shortfalls: z.array(
          z.object({
            workId: z.string(),
            due: z.date(),
            shortMinutes: z.number().int(),
            tradeoffs: z.array(Tradeoff),
          }),
        ),
        overlaps: z
          .array(
            z.object({
              blockId: z.string(),
              reason: z.enum(["locked", "no_room"]),
            }),
          )
          .describe(
            "Blocks the calendar now overlaps that stay put: Locked, or with no time left before their deadline.",
          ),
      })
      .describe(
        "What a Rebalance would change now. Moves the student applies count as their own decisions.",
      ),
  })
  .openapi("Plan");
export function registerPlanRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/plan",
      responses: {
        200: json(PlanView, "The Plan and a Rebalance proposal."),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return c.json(await c.get("plan").view(p), 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/plan/apply",
      request: body(Move),
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(c, await c.get("plan").apply(p, c.req.valid("json")));
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/plan/estimates",
      responses: {
        200: json(
          z.object({ proposed: z.number().int() }),
          "Estimates proposed for Obligations that had none.",
        ),
        403: json(
          ErrorBody,
          "Usage is refused, such as an exhausted Allowance.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const result = await c.get("plan").proposeEstimates(p, {
        estimator: c.get("estimator"),
        delegation: c.get("delegation"),
      });
      if (result.status === "refused")
        return c.json({ error: result.reason }, 403);
      return c.json({ proposed: result.proposed }, 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/estimates/{kind}/{id}",
      request: {
        params: Work,
        ...body(z.object({ minutes: z.number().int() }).strict()),
      },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("plan")
          .estimate(p, c.req.valid("param"), c.req.valid("json").minutes),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/tasks",
      request: body(
        z
          .object({
            title: z.string(),
            obligationId: z.string().uuid().nullable(),
            courseId: z
              .string()
              .uuid()
              .nullable()
              .optional()
              .describe(
                "The Course of a Task toward no Obligation; a Task toward one is in the Obligation's Course.",
              ),
          })
          .strict(),
      ),
      responses: { 201: Created, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return created(c, await c.get("plan").addTask(p, c.req.valid("json")));
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/tasks/{id}/done",
      request: {
        params: id,
        ...body(z.object({ done: z.boolean() }).strict()),
      },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("plan")
          .completeTask(p, c.req.valid("param").id, c.req.valid("json").done),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/study-blocks",
      request: body(Span.extend({ work: Work }).strict()),
      responses: { 201: Created, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return created(c, await c.get("plan").placeBlock(p, c.req.valid("json")));
    },
  );
  routes.openapi(
    createRoute({
      method: "patch",
      path: "/api/me/study-blocks/{id}",
      request: { params: id, ...body(Span.strict()) },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("plan")
          .moveBlock(p, c.req.valid("param").id, c.req.valid("json")),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/study-blocks/{id}/lock",
      request: {
        params: id,
        ...body(z.object({ locked: z.boolean() }).strict()),
      },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("plan")
          .lockBlock(p, c.req.valid("param").id, c.req.valid("json").locked),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "delete",
      path: "/api/me/study-blocks/{id}",
      request: { params: id },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c.get("plan").removeBlock(p, c.req.valid("param").id),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/preferences",
      request: body(
        z
          .object({
            studyFromMinute: z.number().int(),
            studyToMinute: z.number().int(),
            maxMinutesPerDay: z.number().int(),
          })
          .strict(),
      ),
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c.get("plan").setPreferences(p, c.req.valid("json")),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/protected-time",
      request: body(
        z
          .union([
            z
              .object({
                weekday: z.number().int(),
                fromMinute: z.number().int(),
                toMinute: z.number().int(),
              })
              .strict(),
            Span.strict(),
          ])
          .describe("A weekly span, or a one-off span such as a trip."),
      ),
      responses: { 201: Created, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return created(
        c,
        await c.get("plan").addProtectedTime(p, c.req.valid("json")),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "delete",
      path: "/api/me/protected-time/{id}",
      request: { params: id },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c.get("plan").removeProtectedTime(p, c.req.valid("param").id),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/fixed-events",
      request: body(Span.extend({ title: z.string() }).strict()),
      responses: { 201: Created, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return created(
        c,
        await c.get("plan").addFixedEvent(p, c.req.valid("json")),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "delete",
      path: "/api/me/fixed-events/{id}",
      request: { params: id },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c.get("plan").removeFixedEvent(p, c.req.valid("param").id),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/calendar-sources",
      request: body(
        z
          .object({ name: z.string(), ics: z.string().max(1024 * 1024) })
          .strict(),
      ),
      responses: {
        201: json(
          z.object({
            id: z.string(),
            events: z.number().int(),
            skipped: z.object({
              allDay: z.number().int(),
              outsideWindow: z.number().int(),
              truncated: z.boolean(),
            }),
            proposedCourses: z
              .number()
              .int()
              .nullable()
              .describe(
                "How many Event Series nunio proposed a Course for; null when it could not ask, such as with the Allowance used up.",
              ),
          }),
          "The calendar Source, with its timed events of the coming year and what was skipped. A file sharing event UIDs with a calendar added before updates that one, whose ID it returns.",
        ),
        ...outcomes,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const plan = c.get("plan");
      const result = await plan.addCalendar(p, c.req.valid("json"));
      if (result.status === "invalid") return failed(c, "invalid");
      // The calendar is added either way; without proposals the student assigns its series in Review (ADR-0021).
      const proposed = await plan
        .proposeSeriesCourses(p, {
          assigner: c.get("seriesAssigner"),
          delegation: c.get("delegation"),
        })
        .catch((error: unknown) => {
          console.error(
            JSON.stringify({
              msg: "series course proposal failed",
              error: String(error),
            }),
          );
          return null;
        });
      return c.json(
        {
          id: result.id,
          events: result.events,
          skipped: result.skipped,
          proposedCourses: proposed?.status === "ok" ? proposed.proposed : null,
        },
        201,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/event-series/{id}/decision",
      request: {
        params: id,
        ...body(
          z.union([
            z.object({ courseId: z.string() }).strict(),
            z.object({ reject: z.literal(true) }).strict(),
          ]),
        ),
      },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("plan")
          .decideSeries(p, c.req.valid("param").id, c.req.valid("json")),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/event-series/{id}/routine",
      request: {
        params: id,
        ...body(
          z
            .object({
              preparationMinutes: z.number().int(),
              followUpMinutes: z.number().int(),
            })
            .strict()
            .describe(
              "Minutes to prepare for and follow up on each Course Event of the series; 0 for none (ADR-0021).",
            ),
        ),
      },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("plan")
          .setRoutine(p, c.req.valid("param").id, c.req.valid("json")),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/fixed-events/{id}/detach",
      request: { params: id },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c.get("plan").detachEvent(p, c.req.valid("param").id),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "delete",
      path: "/api/me/calendar-sources/{id}",
      request: { params: id },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c.get("plan").removeCalendar(p, c.req.valid("param").id),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/priorities",
      request: body(
        z.object({ items: z.array(PriorityRef).max(200) }).strict(),
      ),
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c.get("plan").setPriorities(p, c.req.valid("json").items),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/courses/{id}/limit",
      request: { params: id, ...body(Limit) },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("plan")
          .setCourseLimit(
            p,
            c.req.valid("param").id,
            c.req.valid("json").maxMinutesPerDay,
          ),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/tasks/{id}/limit",
      request: { params: id, ...body(Limit) },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("plan")
          .setTaskLimit(
            p,
            c.req.valid("param").id,
            c.req.valid("json").maxMinutesPerDay,
          ),
      );
    },
  );
}
