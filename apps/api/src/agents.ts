import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { ActivityCursor } from "@nunio/chat";
import type { AgentScope } from "@nunio/delegation";
import {
  approvalModes,
  capabilities,
  capabilityIds,
  capabilitySections,
} from "@nunio/delegation";
import { courseColors } from "@nunio/knowledge";
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
  ErrorBody,
  errors,
  id,
  json,
  student,
} from "./outcomes.js";

/** Every pilot Agent gets the same Budget; its presets make no model calls yet. */
const defaultBudgetMicroUsd = 1_000_000;

/** One of an Agent's Courses, or one it could be given, with what the Agent will read of it. */
const AgentCourse = z
  .object({
    id: z.string(),
    title: z.string(),
    color: z.enum(courseColors),
    archived: z
      .boolean()
      .describe("The Agent still reads it but no longer acts for it."),
    topics: z.number().describe("How many Topics it has."),
    sources: z.number().describe("How many Sources it has."),
  })
  .openapi("AgentCourse");

/** One of an Agent's Capabilities, with its mode. */
const AgentCapability = z
  .object({
    id: z.enum(capabilityIds),
    mode: z
      .enum(approvalModes)
      .describe(
        "always and automatic hold a Grant; ask asks for every Action. Lernblöcke verschieben allows only ask.",
      ),
  })
  .strict()
  .openapi("AgentCapability");

/** A free-text Agent's form, saved whole. */
const AgentForm = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).describe("Its Beschreibung."),
    emoji: z.string().trim().min(1).max(16),
    instructions: z
      .string()
      .trim()
      .max(4000)
      .describe("What it should do, in the student's words."),
    courseIds: z
      .array(z.string().uuid())
      .min(1)
      .max(50)
      .describe(
        "Its Courses: accepted, unarchived ones, or ones it already has.",
      ),
    capabilities: z
      .array(AgentCapability)
      .max(capabilityIds.length)
      .describe("Its Capabilities, each at most once, on a mode it allows."),
    budgetMicroUsd: z
      .number()
      .int()
      .positive()
      .max(100_000_000)
      .describe("Its monthly Budget."),
  })
  .strict()
  .openapi("AgentForm");

const Agent = z
  .object({
    id: z.string(),
    preset: z
      .enum(["keep_course_organized", "prepare_for_exam"])
      .nullable()
      .describe("Null for a free-text Agent."),
    name: z
      .string()
      .describe("Empty for a preset Agent, which is named after its scope."),
    description: z.string(),
    emoji: z.string(),
    instructions: z.string(),
    courses: z
      .array(AgentCourse)
      .describe("A free-text Agent's Courses; none for a preset Agent."),
    course: z.object({ id: z.string(), title: z.string() }).nullable(),
    exam: z
      .object({ id: z.string(), title: z.string() })
      .nullable()
      .describe("The one exam it prepares for; null for a Course."),
    state: z.enum(["active", "paused", "ended"]),
    pausedBy: z.enum(["student", "budget", "course_archived"]).nullable(),
    running: z
      .boolean()
      .describe(
        "One of its Runs is under way; another cannot start until it ends.",
      ),
    capabilities: z
      .array(AgentCapability)
      .describe(
        "A free-text Agent's Capabilities in the capability set's order; none for a preset Agent.",
      ),
    grants: z.array(
      z.enum(["studyBlock.create", "studyBlock.move", "studyBlock.remove"]),
    ),
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
  .openapi("Agent");

/** One of an Agent's Runs in its Aktivität list. */
const ActivityRun = z
  .object({
    id: z.string(),
    status: z.enum(["running", "done", "stopped", "failed"]),
    trigger: z.enum(["schedule", "manual"]),
    startedAt: z.date(),
    endedAt: z.date().nullable().describe("Null while it runs."),
    stopReason: z
      .string()
      .nullable()
      .describe(
        "Why it stopped or failed, such as budget_exhausted, paused, model_unavailable, model_ended_early or cancelled; null when done, or when a failure gave none.",
      ),
    openApprovals: z
      .number()
      .int()
      .describe(
        "Its Approvals still open and unexpired; while any is, it needs the student's Approval (Freigabe benötigt).",
      ),
  })
  .openapi("ActivityRun");

/** A Course or Source a Verlauf entry names, by its name now. */
const Named = z.object({
  id: z.string(),
  title: z.string().nullable().describe("Null once it is deleted (gelöscht)."),
});

/** One entry of a Run's Verlauf, which nunio renders from structured events, never from what the model wrote. */
const VerlaufEntrySchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("start"),
      at: z.date(),
      trigger: z.enum(["schedule", "manual"]),
    }),
    z.object({
      type: z.literal("read"),
      at: z.date(),
      step: z.number().int(),
      plan: z.boolean().describe("It read the Plan."),
      courses: z.array(Named).describe("The Courses whose Facts it read."),
      sources: z.array(Named).describe("The Sources it drew on."),
    }),
    z.object({
      type: z.literal("action"),
      at: z.date(),
      step: z.number().int(),
      capability: z.string().describe("The Capability whose tool was called."),
      action: z
        .object({
          kind: ActionShown.shape.kind,
          work: z
            .object({
              title: z
                .string()
                .nullable()
                .describe("Null when its title can no longer be read."),
              course: z.string().nullable(),
            })
            .nullable()
            .describe(
              "Its Obligation or Task as it is now, Archived Courses included; null once deleted (gelöscht).",
            ),
          start: z
            .date()
            .nullable()
            .describe(
              "Where the block was put or removed from; null for an Action that places nothing in time.",
            ),
          end: z.date().nullable(),
        })
        .nullable()
        .describe(
          "Null when the call named nothing the Run read, so nothing was asked.",
        ),
      outcome: z.enum([
        "done",
        "awaiting_approval",
        "refused",
        "failed",
        "unconfirmed",
      ]),
      refusal: z
        .string()
        .nullable()
        .describe(
          "Why it was refused, such as run_cap, open_approvals_cap, out_of_scope or locked; invalid when nothing was asked.",
        ),
      brokenPreferences: z
        .array(z.enum(["outside_study_window", "daily_limit", "work_limit"]))
        .describe("Preferences it broke under Immer erlaubt."),
    }),
    z.object({
      type: z.literal("end"),
      at: z.date(),
      status: z.enum(["done", "stopped", "failed"]),
      reason: z.string().nullable().describe("As the Run's stopReason."),
    }),
  ])
  .openapi("VerlaufEntry");

/** An `activity` cursor in the URL: the last Run's start and ID. */
const encodeCursor = ({ startedAt, id }: ActivityCursor) =>
  Buffer.from(`${startedAt.toISOString()}|${id}`).toString("base64url");
const Cursor = z.string().transform((cursor, ctx): ActivityCursor => {
  const [at = "", id = ""] = Buffer.from(cursor, "base64url")
    .toString()
    .split("|");
  const startedAt = new Date(at);
  if (Number.isNaN(startedAt.getTime()) || !id) {
    ctx.addIssue({ code: "custom", message: "Not a cursor." });
    return z.NEVER;
  }
  return { startedAt, id };
});

type Review = Awaited<ReturnType<AppBindings["Variables"]["facts"]["review"]>>;

/** Names an Agent's scope as the student's review shows it: its Course and, for an exam, the exam. */
export function scopeNames(review: Review, scope: AgentScope | null) {
  if (!scope) return { course: null, exam: null };
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

export function registerAgentRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/agents",
      description:
        "Create a free-text Agent from its form, or a pilot preset until the Agents cutover.",
      request: body(
        z.union([
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
          AgentForm,
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
          .get("agents")
          .create(
            p,
            "preset" in input
              ? { ...input, budgetMicroUsd: defaultBudgetMicroUsd }
              : input,
          ),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/agents/{id}",
      description:
        "Save a free-text Agent's whole form; its next Run reads it. A preset Agent has no form (400).",
      request: { params: id, ...body(AgentForm) },
      responses: { 200: Done, ...archivedOutcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("agents")
          .update(p, c.req.valid("param").id, c.req.valid("json")),
      );
    },
  );
  // Before "/api/me/agents/{id}", which would otherwise take "courses" for an id.
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/agents/courses",
      responses: {
        200: json(
          z.array(AgentCourse),
          "The Courses an Agent can be given: the student's accepted, unarchived ones.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const offered = (await c.get("courses").list(p)).courses.filter(
        (course) => course.status === "accepted" && !course.archived,
      );
      const sizes = await c.get("courses").sizes(
        p,
        offered.map((course) => course.id),
      );
      return c.json(
        offered.map((course) => ({
          id: course.id,
          title: course.title,
          color: course.color,
          archived: false,
          ...sizes.get(course.id)!,
        })),
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/agents/capabilities",
      responses: {
        200: json(
          z.array(
            z
              .object({
                id: z.enum(capabilityIds),
                section: z.string().describe("The drawer section it is in."),
                title: z.string(),
                description: z.string(),
                modes: z
                  .array(z.enum(approvalModes))
                  .describe(
                    "The modes it allows, the first its default when added; a single one is fixed.",
                  ),
              })
              .openapi("Capability"),
          ),
          "Every Capability an Agent can have, in drawer order.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return c.json(
        capabilityIds.map((id) => {
          const { section, title, description, modes } = capabilities[id];
          return {
            id,
            section: capabilitySections[section],
            title,
            description,
            modes: [...modes],
          };
        }),
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/agents/{id}",
      request: { params: id },
      responses: {
        200: json(
          Agent,
          "Its scope, Grants, recent and next Actions, and Budget.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const r = await c.get("agents").view(p, c.req.valid("param").id);
      if (!r) return c.json({ error: "gone" }, 404);
      const plan = await c.get("plan").view(p);
      const review = await c.get("facts").review(p);
      const history = await c
        .get("delegation")
        .history(p, { agentId: r.id, limit: 10 });
      const sizes = await c.get("courses").sizes(
        p,
        r.courses.map((course) => course.id),
      );
      // Only a preset Agent runs yet, on its daily Schedule.
      const scheduled = r.state === "active" && r.scope;
      const [next] = scheduled
        ? await c.get("plan").intentsFor(p, r.scope!)
        : [];
      return c.json(
        {
          id: r.id,
          preset: r.preset,
          name: r.name,
          description: r.description,
          emoji: r.emoji,
          instructions: r.instructions,
          courses: r.courses.map((course) => ({
            ...course,
            color: course.color as (typeof courseColors)[number],
            ...sizes.get(course.id)!,
          })),
          capabilities: r.capabilities,
          ...scopeNames(review, r.scope),
          state: r.state,
          pausedBy: r.pausedBy,
          running: r.running,
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
            runAt: scheduled
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
      path: "/api/me/agents",
      responses: {
        200: json(
          z.array(
            Agent.pick({
              id: true,
              preset: true,
              name: true,
              emoji: true,
              course: true,
              exam: true,
              state: true,
              pausedBy: true,
            }),
          ),
          "The student's Agents, newest first.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const listed = await c.get("agents").list(p);
      const review = listed.length ? await c.get("facts").review(p) : null;
      return c.json(
        listed.map((r) => ({
          id: r.id,
          preset: r.preset,
          name: r.name,
          emoji: r.emoji,
          ...scopeNames(review!, r.scope),
          state: r.state,
          pausedBy: r.pausedBy,
        })),
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/agents/{id}/runs",
      description:
        "Start a free-text Agent's Run now (Jetzt starten), with its saved configuration. Nothing is queued.",
      request: { params: id },
      responses: {
        201: json(z.object({ id: z.string() }), "The Run, now under way."),
        400: json(ErrorBody, "A preset Agent has no such Run."),
        409: json(
          ErrorBody,
          "One of its Runs is still under way (error running), or it is Paused (error paused) or Ended (error ended).",
        ),
        503: json(
          ErrorBody,
          "The Run could not start (error not_started); nothing is under way, so asking again may start it.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      if (p.kind !== "student") return c.json({ error: "gone" }, 404);
      const agentId = c.req.valid("param").id;
      const requested = await c.get("agents").requestRun(p, agentId);
      if (requested.status === "gone") return c.json({ error: "gone" }, 404);
      if (requested.status === "invalid")
        return c.json({ error: "invalid" }, 400);
      if (requested.status !== "ok")
        return c.json({ error: requested.status }, 409);
      try {
        await c.get("runWorkflows").startAgentRun({
          studentId: p.studentId,
          agentId,
          runId: requested.runId,
          workflowId: requested.workflowId,
        });
      } catch {
        await c.get("agents").failRun(p, requested.runId);
        return c.json({ error: "not_started" }, 503);
      }
      return c.json({ id: requested.runId }, 201);
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/agents/{id}/runs",
      description: "A free-text Agent's Runs for its Aktivität, newest first.",
      request: {
        params: id,
        query: z.object({
          limit: z.coerce.number().int().min(1).max(50),
          cursor: Cursor.optional(),
        }),
      },
      responses: {
        200: json(
          z.object({
            runs: z.array(ActivityRun),
            nextCursor: z
              .string()
              .nullable()
              .describe("Pass it back for older Runs; null at the oldest."),
          }),
          "One page of its Runs.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const page = await c
        .get("activity")
        .runs(p, c.req.valid("param").id, c.req.valid("query"));
      if (!page) return c.json({ error: "gone" }, 404);
      return c.json(
        {
          runs: page.runs,
          nextCursor: page.nextCursor && encodeCursor(page.nextCursor),
        },
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/agents/{id}/runs/{runId}",
      request: {
        params: z.object({ id: z.string().uuid(), runId: z.string().uuid() }),
      },
      responses: {
        200: json(
          ActivityRun.extend({
            costMicroUsd: z
              .number()
              .int()
              .describe(
                "What it cost: settled usage plus what its calls in flight hold.",
              ),
            budgetMicroUsd: z
              .number()
              .int()
              .describe("The Agent's monthly Budget it counts against."),
            summary: z
              .string()
              .nullable()
              .describe(
                "The Agent's own words on what it did; null without a final message, or once a Source it drew on is deleted.",
              ),
            summaryGone: z
              .boolean()
              .describe(
                "It had a summary, gone with a Source it drew on that was deleted since.",
              ),
            verlauf: z.array(VerlaufEntrySchema),
          }).openapi("ActivityRunDetail"),
          "The Run, with its cost, summary and Verlauf.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const { id: agentId, runId } = c.req.valid("param");
      const run = await c.get("activity").run(p, agentId, runId);
      if (!run) return c.json({ error: "gone" }, 404);
      return c.json(
        {
          ...run,
          verlauf: run.verlauf.map((entry) =>
            entry.type === "action" && entry.action
              ? {
                  ...entry,
                  action: {
                    ...entry.action,
                    kind: entry.action.kind as z.infer<
                      typeof ActionShown
                    >["kind"],
                  },
                }
              : entry,
          ),
        },
        200,
      );
    },
  );
  for (const control of ["pause", "resume", "end"] as const) {
    routes.openapi(
      createRoute({
        method: "post",
        path: `/api/me/agents/{id}/${control}`,
        request: { params: id },
        responses: { 200: Done, ...archivedOutcomes },
      }),
      async (c) => {
        const p = await student(c);
        if (!p) return c.json({ error: "unauthorized" }, 401);
        return done(
          c,
          await c.get("agents")[control](p, c.req.valid("param").id),
        );
      },
    );
  }
}
