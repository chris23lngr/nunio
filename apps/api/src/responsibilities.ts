import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { ResponsibilityScope } from "@nunio/delegation";
import { deadline } from "@nunio/planning";
import type { AppBindings } from "./app.js";
import { ActionShown, describeAction } from "./approvals.js";
import {
  archivedOutcomes,
  body,
  Created,
  created,
  Done,
  done,
  errors,
  id,
  json,
  student,
} from "./outcomes.js";

/** Every pilot Responsibility gets the same Budget; its presets make no model calls yet. */
const defaultBudgetMicroUsd = 1_000_000;

const Responsibility = z
  .object({
    id: z.string(),
    preset: z.enum(["keep_course_organized", "prepare_for_exam"]),
    course: z.object({ id: z.string(), title: z.string() }).nullable(),
    exam: z
      .object({ id: z.string(), title: z.string() })
      .nullable()
      .describe("The one exam it prepares for; null for a Course."),
    state: z.enum(["active", "paused", "ended"]),
    pausedBy: z.enum(["student", "budget", "course_archived"]).nullable(),
    grants: z.array(z.enum(["studyBlock.create", "studyBlock.move"])),
    budget: z.object({
      limitMicroUsd: z.number(),
      usedMicroUsd: z.number(),
      heldMicroUsd: z.number(),
    }),
    recentActions: z.array(
      z.object({
        id: z.string(),
        status: z.enum([
          "awaiting_approval",
          "dispatching",
          "done",
          "failed",
          "refused",
          "unconfirmed",
        ]),
        refusal: z.string().nullable(),
        at: z.date(),
        action: ActionShown,
      }),
    ),
    next: z
      .object({
        runAt: z
          .date()
          .nullable()
          .describe("When its next Run starts; null unless active."),
        action: ActionShown.nullable().describe(
          "The first Action that Run would take, as the Plan stands now.",
        ),
      })
      .describe("The next planned Action."),
  })
  .openapi("Responsibility");

type Review = Awaited<ReturnType<AppBindings["Variables"]["facts"]["review"]>>;

/** Names a Responsibility's scope as the student's review shows it: its Course and, for an exam, the exam. */
export function scopeNames(review: Review, scope: ResponsibilityScope) {
  const course =
    "courseId" in scope
      ? review.courses.find((c) => c.id === scope.courseId)
      : review.courses.find((c) =>
          c.obligations.some((o) => o.id === scope.obligationId),
        );
  return {
    course: course
      ? { id: course.id, title: course.title }
      : "courseId" in scope
        ? { id: scope.courseId, title: "A Course that is gone" }
        : null,
    exam:
      "obligationId" in scope
        ? {
            id: scope.obligationId,
            title:
              course?.obligations.find((o) => o.id === scope.obligationId)
                ?.title ?? "An exam that is gone",
          }
        : null,
  };
}

/** The next 06:00 in the student's time zone, when the Schedule starts a Run. */
function nextRun(now: Date, timeZone: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  const atSix = deadline(today, "06:00", timeZone);
  if (atSix > now) return atSix;
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return deadline(tomorrow.toISOString().slice(0, 10), "06:00", timeZone);
}

export function registerResponsibilityRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/responsibilities",
      request: body(
        z.discriminatedUnion("preset", [
          z.object({
            preset: z.literal("keep_course_organized"),
            courseId: z.string().uuid(),
          }),
          z.object({
            preset: z.literal("prepare_for_exam"),
            obligationId: z.string().uuid(),
          }),
        ]),
      ),
      responses: { 201: Created, ...archivedOutcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const input = c.req.valid("json");
      return created(
        c,
        await c
          .get("responsibilities")
          .create(p, { ...input, budgetMicroUsd: defaultBudgetMicroUsd }),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/responsibilities/{id}",
      request: { params: id },
      responses: {
        200: json(
          Responsibility,
          "Its scope, Grants, recent and next Actions, and Budget.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const r = await c
        .get("responsibilities")
        .view(p, c.req.valid("param").id);
      if (!r) return c.json({ error: "gone" }, 404);
      const plan = await c.get("plan").view(p);
      const review = await c.get("facts").review(p);
      const history = await c
        .get("delegation")
        .history(p, { responsibilityId: r.id, limit: 10 });
      const [next] =
        r.state === "active" ? await c.get("plan").intentsFor(p, r.scope) : [];
      return c.json(
        {
          id: r.id,
          preset: r.preset,
          ...scopeNames(review, r.scope),
          state: r.state,
          pausedBy: r.pausedBy,
          grants: r.grants.map((g) => g.kind),
          budget: r.budget,
          recentActions: history.map((a) => ({
            id: a.id,
            status: a.status,
            refusal: a.refusal,
            at: a.events[0]?.at ?? new Date(0),
            action: describeAction(plan, a.kind, a.args),
          })),
          next: {
            runAt:
              r.state === "active"
                ? nextRun(new Date(), plan.limits.preferences.timeZone)
                : null,
            action: next ? describeAction(plan, next.kind, next) : null,
          },
        },
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/responsibilities",
      responses: {
        200: json(
          z.array(
            Responsibility.pick({
              id: true,
              preset: true,
              course: true,
              exam: true,
              state: true,
              pausedBy: true,
            }),
          ),
          "The student's Responsibilities, newest first.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const listed = await c.get("responsibilities").list(p);
      const review = listed.length ? await c.get("facts").review(p) : null;
      return c.json(
        listed.map((r) => ({
          id: r.id,
          preset: r.preset,
          ...scopeNames(review!, r.scope),
          state: r.state,
          pausedBy: r.pausedBy,
        })),
        200,
      );
    },
  );
  for (const control of ["pause", "resume", "end"] as const) {
    routes.openapi(
      createRoute({
        method: "post",
        path: `/api/me/responsibilities/{id}/${control}`,
        request: { params: id },
        responses: { 200: Done, ...archivedOutcomes },
      }),
      async (c) => {
        const p = await student(c);
        if (!p) return c.json({ error: "unauthorized" }, 401);
        return done(
          c,
          await c.get("responsibilities")[control](p, c.req.valid("param").id),
        );
      },
    );
  }
}
