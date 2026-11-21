import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { ActivityCursor } from "@nunio/chat";
import type { AgentScope, AgentTrigger, Principal } from "@nunio/delegation";
import {
  approvalModes,
  capabilities,
  capabilityIds,
  capabilitySections,
} from "@nunio/delegation";
import { courseColors } from "@nunio/knowledge";
import { deadline, hhmm } from "@nunio/planning";
import type { Context } from "hono";
import type { AppBindings } from "./app.js";
import {
  ActionShown,
  Approval,
  approvalsOf,
  describeAction,
} from "./approvals.js";
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

/** Saving the form with a Model Chat does not offer, other than the one the Agent has. */
const modelUnavailable = {
  422: json(
    ErrorBody,
    "Its Model is not offered in Chat (error model_unavailable); pick another.",
  ),
};

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
      .nullable()
      .describe(
        "always and automatic hold a Grant; ask asks for every Action. Lernblöcke verschieben allows only ask. Null for a Capability that is no Action, such as Karteikarten erstellen, which is simply on.",
      ),
  })
  .strict()
  .openapi("AgentCapability");

/** A minute of the day, as the Uhrzeit. */
const Minute = z
  .number()
  .int()
  .min(0)
  .max(24 * 60 - 1);

/** When its Schedule starts a Run, in the Plan's time zone: the v1 rhythms only. */
const Trigger = z
  .discriminatedUnion("rhythm", [
    z.object({ rhythm: z.literal("daily"), minute: Minute }).strict(),
    z
      .object({
        rhythm: z.literal("weekdays"),
        weekdays: z
          .array(z.number().int().min(1).max(7))
          .min(1)
          .max(7)
          .refine((days) => new Set(days).size === days.length, {
            message: "Each Wochentag at most once.",
          })
          .describe("Its Wochentage, ISO: 1 is Monday, 7 is Sunday."),
        minute: Minute,
      })
      .strict(),
  ])
  .describe(
    "Täglich (daily) or on chosen Wochentage (weekdays), at a minute of the day (Uhrzeit) in the Plan's time zone.",
  )
  .openapi("AgentTrigger");

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
    trigger: Trigger,
    modelKey: z
      .string()
      .min(1)
      .max(200)
      .describe(
        "The Model its Runs run on: one of the Models Chat offers (GET /api/me/models), or the one it already has.",
      ),
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
    trigger: Trigger.describe(
      "When its Schedule starts a Run; a preset Agent's is Täglich at 06:00.",
    ),
    modelKey: z
      .string()
      .nullable()
      .describe(
        "The Model its Runs run on, which Chat may have stopped offering since; null for a preset Agent.",
      ),
    state: z.enum(["active", "paused", "ended"]),
    pausedBy: z
      .enum(["student", "budget", "course_archived", "no_course"])
      .nullable(),
    running: z
      .boolean()
      .describe(
        "One of its Runs is under way; another cannot start until it ends.",
      ),
    approvalRunId: z
      .string()
      .nullable()
      .describe(
        "The oldest of its Runs with an Approval still open, which Freigaben bestätigen opens; null when none is.",
      ),
    capabilities: z
      .array(AgentCapability)
      .describe(
        "A free-text Agent's Capabilities in the capability set's order; none for a preset Agent.",
      ),
    grants: z.array(
      z.enum(["studyBlock.create", "studyBlock.move", "studyBlock.remove"]),
    ),
    budget: z
      .object({
        limitMicroUsd: z.number(),
        usedMicroUsd: z.number(),
        heldMicroUsd: z.number(),
      })
      .describe(
        "Its monthly Budget: what it used this month, counted from 00:00 on the 1st in the Plan's time zone, and what calls still in flight hold.",
      ),
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
      approvals: z.boolean().describe("It read its Agent's Approvals."),
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
              obligation: z
                .string()
                .nullable()
                .optional()
                .describe(
                  "For a new Task toward an Obligation, that Obligation's title now; null when it can no longer be read.",
                ),
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
      type: z.literal("artifact"),
      at: z.date(),
      step: z.number().int(),
      capability: z
        .string()
        .describe(
          "The Lernmaterial Capability whose tool was called, such as createFlashcards.",
        ),
      kind: z.enum(["flashcards", "practice_set"]),
      topics: z
        .array(Named)
        .describe(
          "The Topics it was for; none when the call named no Topic of the Agent's Courses.",
        ),
      outcome: z
        .enum(["started", "refused"])
        .describe("Whether its Artifact Run started."),
      refusal: z
        .string()
        .nullable()
        .describe(
          "Why none started, such as run_cap (the Run already started one); invalid when the call named no Topic it read.",
        ),
    }),
    z.object({
      type: z.literal("notice"),
      at: z.date(),
      step: z.number().int(),
      capability: z
        .string()
        .describe("The Capability whose tool was called: notifyStudent."),
      outcome: z
        .enum(["sent", "refused"])
        .describe(
          "Whether the Notice was sent; its text is read in the Inbox, never here.",
        ),
      refusal: z
        .string()
        .nullable()
        .describe(
          "Why none was sent, such as run_cap (the Run already sent one) or paused; invalid when its text was empty, too long or held a link.",
        ),
    }),
    z.object({
      type: z.literal("approval"),
      at: z
        .date()
        .describe(
          "When the student decided, when it expired unanswered, or when it was withdrawn.",
        ),
      action: z.object({
        kind: ActionShown.shape.kind,
        work: z
          .object({
            title: z.string().nullable(),
            course: z.string().nullable(),
            obligation: z.string().nullable().optional(),
          })
          .nullable()
          .describe("As in an action entry; null once deleted (gelöscht)."),
        start: z.date().nullable(),
        end: z.date().nullable(),
      }),
      decision: z
        .enum(["approved", "denied", "expired", "withdrawn"])
        .describe(
          "The student's answer; expired when none came in time (expiry writes nothing, it shows once it passed); withdrawn when the Agent was Paused or Ended before the student answered.",
        ),
      outcome: z
        .enum(["done", "refused", "failed", "unconfirmed", "pending"])
        .nullable()
        .describe(
          "What the gate made of an approved Action, pending while it is performed; null unless approved.",
        ),
      refusal: z
        .string()
        .nullable()
        .describe(
          "Why the gate refused the approved Action, such as out_of_scope or approval_mismatch (it changed since it was asked).",
        ),
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

/** The trigger's next Uhrzeit on one of its days, in the student's time zone, when the Schedule starts a Run. */
function nextRun(now: Date, timeZone: string, trigger: AgentTrigger) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  for (let offset = 0; ; offset++) {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    const weekday = day.getUTCDay() || 7;
    if (trigger.rhythm === "weekdays" && !trigger.weekdays.includes(weekday))
      continue;
    const at = deadline(
      day.toISOString().slice(0, 10),
      hhmm(trigger.minute),
      timeZone,
    );
    if (at > now) return at;
  }
}

/**
 * Tells the Agent's Runs under way to stop at once; one whose workflow no longer runs is ended as failed (#174). The
 * database already refuses their next step and Action, so a Run Temporal cannot be reached about stops at that.
 */
async function stopRuns(
  c: Context<AppBindings>,
  p: Principal,
  runs: { runId: string; workflowId: string }[],
  reason: "paused" | "ended",
) {
  for (const run of runs) {
    try {
      if (!(await c.get("runWorkflows").stopAgentRun(run.workflowId, reason)))
        await c.get("agents").failRun(p, run.runId);
    } catch (error) {
      console.error("Could not stop an Agent's Run", error);
    }
  }
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
      responses: { 201: Created, ...archivedOutcomes, ...modelUnavailable },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const input = c.req.valid("json");
      const result = await c
        .get("agents")
        .create(
          p,
          "preset" in input
            ? { ...input, budgetMicroUsd: defaultBudgetMicroUsd }
            : input,
        );
      if (result.status === "model_unavailable")
        return c.json({ error: "model_unavailable" }, 422);
      return created(c, result);
    },
  );
  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/agents/{id}",
      description:
        "Save a free-text Agent's whole form; its next Run reads it. A preset Agent has no form (400).",
      request: { params: id, ...body(AgentForm) },
      responses: { 200: Done, ...archivedOutcomes, ...modelUnavailable },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("agents")
        .update(p, c.req.valid("param").id, c.req.valid("json"));
      if (result.status === "model_unavailable")
        return c.json({ error: "model_unavailable" }, 422);
      return done(c, result);
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
                    "The modes it allows, the first its default when added; a single one is fixed, and none means it is no Action and simply on or off.",
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
      // Only a preset Agent's next Action can be told in advance.
      const [next] =
        r.state === "active" && r.scope
          ? await c.get("plan").intentsFor(p, r.scope)
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
          trigger: r.trigger,
          modelKey: r.modelKey,
          ...scopeNames(review, r.scope),
          state: r.state,
          pausedBy: r.pausedBy,
          running: r.running,
          approvalRunId: r.approvalRunId,
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
                ? nextRun(
                    new Date(),
                    plan.limits.preferences.timeZone,
                    r.trigger,
                  )
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
              description: true,
              emoji: true,
              course: true,
              exam: true,
              state: true,
              pausedBy: true,
              approvalRunId: true,
            }).extend({
              badge: z
                .enum(["paused", "approval_needed", "running", "ended"])
                .nullable()
                .describe(
                  "Its one badge: Pausiert, Freigabe benötigt (a Run has an open Approval), Läuft gerade (a Run is under way) or Beendet; null when none applies.",
                ),
            }),
          ),
          "The student's Agents, Ended ones included: Paused first, then those needing an Approval, then running ones, then those without a badge, Ended last; newest first within each.",
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
          description: r.description,
          emoji: r.emoji,
          ...scopeNames(review!, r.scope),
          state: r.state,
          pausedBy: r.pausedBy,
          badge: r.badge,
          approvalRunId: r.approvalRunId,
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
            approvals: z
              .array(Approval)
              .describe(
                "Its open, unexpired Approvals (Freigaben), each as nunio renders the Action, never as the model put it.",
              ),
          }).openapi("ActivityRunDetail"),
          "The Run, with its cost, summary, Verlauf and open Approvals.",
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
            (entry.type === "action" || entry.type === "approval") &&
            entry.action
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
          approvals: await approvalsOf(c, p, { runId }),
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
        description: {
          pause:
            "Pause the Agent: its Run under way stops at its next step or Action, and its open Approvals are withdrawn for good.",
          resume:
            "Resume a Paused Agent, whoever paused it; no withdrawn Approval comes back.",
          end: "End the Agent for good: its Grants go, its Run under way stops at its next step or Action, and its open Approvals are withdrawn. Its Activity stays.",
        }[control],
        request: { params: id },
        responses: {
          200: Done,
          ...archivedOutcomes,
          409:
            control === "resume"
              ? json(
                  ErrorBody,
                  "It has no Course to act for: all its Courses are Archived (error course_archived), or it has none (error no_course).",
                )
              : archivedOutcomes[409],
        },
      }),
      async (c) => {
        const p = await student(c);
        if (!p) return c.json({ error: "unauthorized" }, 401);
        const agentId = c.req.valid("param").id;
        if (control === "resume")
          return done(c, await c.get("agents").resume(p, agentId));
        const result = await c.get("agents")[control](p, agentId);
        if (result.status === "ok")
          await stopRuns(
            c,
            p,
            result.runs,
            control === "pause" ? "paused" : "ended",
          );
        return done(c, result);
      },
    );
  }
  routes.openapi(
    createRoute({
      method: "delete",
      path: "/api/me/agents/{id}",
      description:
        "Delete the Agent for good (Löschen), with its Activity and its Schedule; its Runs' workflows still running are cancelled.",
      request: { params: id },
      responses: {
        200: Done,
        503: json(
          ErrorBody,
          "Its Schedule could not be deleted (error not_deleted), so nothing was; asking again may delete it.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      let result: Awaited<
        ReturnType<AppBindings["Variables"]["agents"]["delete"]>
      >;
      try {
        result = await c.get("agents").delete(p, c.req.valid("param").id);
      } catch (error) {
        console.error("Could not delete an Agent", error);
        return c.json({ error: "not_deleted" }, 503);
      }
      if (result.status !== "ok") return c.json({ error: "gone" }, 404);
      // Best effort: a workflow left running finds its Run gone and changes nothing.
      for (const workflowId of result.workflows)
        await c
          .get("runWorkflows")
          .cancelRun(workflowId)
          .catch((error: unknown) =>
            console.error("Could not cancel a deleted Agent's Run", error),
          );
      return c.json({ status: "ok" as const }, 200);
    },
  );
}
