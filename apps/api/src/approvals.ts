import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { ActionRecord, Principal } from "@nunio/delegation";
import {
  principal,
  StaleApprovalError,
  UnknownActionError,
} from "@nunio/delegation";
import type { Context } from "hono";
import type { AppBindings } from "./app.js";
import {
  body,
  Done,
  ErrorBody,
  errors,
  json,
  outcomes,
  student,
} from "./outcomes.js";

const Span = z.object({ start: z.date(), end: z.date() });
export const Approval = z
  .object({
    actionId: z.string(),
    action: z
      .lazy(() => ActionShown)
      .describe("The exact Action, as the student confirms it (ADR-0010)."),
    fingerprint: z
      .string()
      .describe("Sent back unchanged to approve exactly this Action."),
    expiresAt: z.date(),
    agent: z
      .object({ id: z.string(), name: z.string() })
      .nullable()
      .describe("The Agent whose Run asked; null for a Chat."),
  })
  .openapi("Approval");

type PlanView = Awaited<ReturnType<AppBindings["Variables"]["plan"]["view"]>>;

/** A Course's title, from the Plan's Obligations or Tasks in it. */
const courseTitle = (plan: PlanView, courseId: string | null) =>
  (courseId &&
    (plan.obligations.find((o) => o.courseId === courseId)?.course ??
      plan.tasks.find((t) => t.courseId === courseId)?.course)) ||
  null;

/** One Action as the student sees it: which work, where its block is now, and where it would go. */
export function describeAction(
  plan: PlanView,
  kind: ActionRecord["kind"],
  args: unknown,
) {
  // A Task Action places nothing in time: it names the Task it adds or reopens (ADR-0022).
  if (kind === "task.create" || kind === "task.reopen") {
    const {
      title,
      courseId,
      obligationId,
      taskId,
      fixedEventId,
      role,
      estimateMinutes,
    } = args as {
      title?: string;
      courseId?: string | null;
      obligationId?: string;
      taskId?: string;
      fixedEventId?: string | null;
      role?: "preparation" | "follow_up" | null;
      estimateMinutes?: number | null;
    };
    const task = plan.tasks.find((t) => t.id === taskId);
    const event = plan.fixedEvents.find((e) => e.id === fixedEventId);
    // A new Task toward an Obligation is in the Obligation's Course.
    const obligation = obligationId
      ? plan.obligations.find((o) => o.id === obligationId)
      : undefined;
    return {
      kind,
      work: {
        title: title ?? task?.title ?? "Work that is gone",
        course:
          obligation?.course ??
          courseTitle(plan, courseId ?? task?.courseId ?? null),
      },
      from: null,
      to: null,
      task:
        kind === "task.create"
          ? {
              role: role ?? null,
              minutes: estimateMinutes ?? null,
              event: event ? { title: event.title, start: event.start } : null,
              obligation: obligation?.title ?? null,
            }
          : null,
    };
  }
  const { workId, studyBlockId, start, end } = args as {
    workId?: string;
    studyBlockId?: string;
    start: string | Date;
    end: string | Date;
  };
  const block = plan.studyBlocks.find((b) => b.id === studyBlockId);
  const task = plan.tasks.find((t) => t.id === (workId ?? block?.work.id));
  const obligation = plan.obligations.find(
    (o) => o.id === (task?.obligationId ?? workId ?? block?.work.id),
  );
  return {
    kind,
    work: {
      title: task?.title ?? obligation?.title ?? "Work that is gone",
      course: obligation?.course ?? task?.course ?? null,
    },
    // A removal names the block as the student was shown it, which stays known once it is gone (ADR-0021).
    from:
      kind === "studyBlock.remove"
        ? { start: new Date(start), end: new Date(end) }
        : block
          ? { start: block.start, end: block.end }
          : null,
    to:
      kind === "studyBlock.remove"
        ? null
        : { start: new Date(start), end: new Date(end) },
    task: null,
  };
}
export const ActionShown = z
  .object({
    kind: z.enum([
      "studyBlock.create",
      "studyBlock.move",
      "studyBlock.remove",
      "task.create",
      "task.reopen",
    ]),
    work: z.object({ title: z.string(), course: z.string().nullable() }),
    from: Span.nullable().describe(
      "Where the block is now; null for a new block or a Task Action.",
    ),
    to: Span.nullable().describe(
      "Where the block would go; null for a removal or a Task Action.",
    ),
    task: z
      .object({
        role: z.enum(["preparation", "follow_up"]).nullable(),
        minutes: z.number().int().nullable(),
        event: z.object({ title: z.string(), start: z.date() }).nullable(),
        obligation: z
          .string()
          .nullable()
          .describe(
            "The title of the Obligation it counts toward, as nunio shows it; null for none.",
          ),
      })
      .nullable()
      .describe(
        "What a new Task is for: its Course Event and role or its Obligation, and the minutes it needs; null for any other Action.",
      ),
  })
  .openapi("ActionShown");

/**
 * Performs an Action once the student approved it, wherever they did: a Chat's, which has no Run (ADR-0019,
 * delegation-gate.md "Chat origin"), or an Agent's, whose Run ended without waiting and still owns the Action
 * (ADR-0006). Its record then tells how it went.
 */
export async function performApproved(
  c: Context<AppBindings>,
  p: Principal,
  record: ActionRecord,
) {
  if (record.approval?.decision !== "approved") return record;
  const delegation = c.get("delegation");
  // An Integration Action's tool arguments are sealed: the gate opens them first. A Run's Action goes through the
  // gate as the Run's, so its Agent's state, Courses and Capabilities decide it now.
  await Promise.resolve(record.intent ?? delegation.intentOf(p, record))
    .then((intent) =>
      delegation.perform(record.runId ? principal.fromRun(record.runId) : p, {
        key: record.key,
        intent,
      }),
    )
    .catch((error: unknown) =>
      console.error(
        JSON.stringify({
          msg: "approved Action failed",
          actionId: record.id,
          error: String(error),
        }),
      ),
    );
  return (await delegation.history(p, { ids: [record.id] }))[0] ?? record;
}

/** The Actions awaiting the student's Approval, or those of one Run, each as the exact Action the card shows. */
export async function approvalsOf(
  c: Context<AppBindings>,
  p: Principal,
  q: { runId?: string } = {},
) {
  const now = new Date();
  // An expired Approval no longer counts; a Chat's has no Run to close it, so it is left out here (ADR-0019).
  const asking = (
    await c.get("delegation").history(p, { status: "awaiting_approval", ...q })
  ).filter((a) => a.approval && a.approval.expiresAt > now);
  if (!asking.length) return [];
  const plan = await c.get("plan").view(p);
  const agents = new Map<string, string>();
  for (const id of new Set(
    asking.flatMap((a) => (a.agentId ? [a.agentId] : [])),
  )) {
    const r = await c.get("agents").view(p, id);
    if (r) agents.set(id, r.name);
  }
  return asking.map((a: ActionRecord) => ({
    actionId: a.id,
    action: describeAction(plan, a.kind, a.args),
    fingerprint: a.approval!.fingerprint,
    expiresAt: a.approval!.expiresAt,
    agent: a.agentId
      ? { id: a.agentId, name: agents.get(a.agentId) ?? "" }
      : null,
  }));
}

export function registerApprovalRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/approvals",
      responses: {
        200: json(
          z.array(Approval),
          "Actions awaiting the student's Approval.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return c.json(await approvalsOf(c, p), 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/approvals/{actionId}",
      request: {
        params: z.object({ actionId: z.string().uuid() }),
        ...body(
          z.discriminatedUnion("decision", [
            z.object({
              decision: z.literal("approve"),
              fingerprint: z.string(),
            }),
            z.object({ decision: z.literal("deny") }),
          ]),
        ),
      },
      responses: {
        200: Done,
        ...outcomes,
        409: json(
          ErrorBody,
          "Nothing was approved: the Action changed since the student was shown it (error changed), the request expired (error expired), or it was already answered or shown with another fingerprint (error stale).",
        ),
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const { actionId } = c.req.valid("param");
      const decision = c.req.valid("json");
      let record: ActionRecord;
      try {
        record = await c
          .get("delegation")
          .decide(
            p,
            decision.decision === "approve"
              ? { kind: "approve", actionId, fingerprint: decision.fingerprint }
              : { kind: "deny", actionId },
          );
      } catch (error) {
        if (error instanceof UnknownActionError)
          return c.json({ error: "gone" }, 404);
        // The card was not the open request: another fingerprint, or already answered or expired.
        if (error instanceof StaleApprovalError)
          return c.json({ error: "stale" }, 409);
        throw error;
      }
      const applied = await performApproved(c, p, record);
      // The card showed an Action that is no longer what the gate would do, or a request that had expired.
      if (applied.refusal === "approval_mismatch")
        return c.json({ error: "changed" }, 409);
      if (applied.refusal === "approval_expired")
        return c.json({ error: "expired" }, 409);
      return c.json({ status: "ok" as const }, 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/actions/unconfirmed",
      responses: {
        200: json(
          z.array(
            z.object({
              actionId: z.string(),
              action: z.lazy(() => ActionShown),
            }),
          ),
          "Actions nunio attempted but cannot confirm; only the student resolves them.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const unconfirmed = await c
        .get("delegation")
        .history(p, { status: "unconfirmed" });
      if (!unconfirmed.length) return c.json([], 200);
      const plan = await c.get("plan").view(p);
      return c.json(
        unconfirmed.map((a) => ({
          actionId: a.id,
          action: describeAction(plan, a.kind, a.args),
        })),
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/actions/{actionId}/resolve",
      request: {
        params: z.object({ actionId: z.string().uuid() }),
        ...body(
          z.object({ resolution: z.enum(["happened", "did_not_happen"]) }),
        ),
      },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const { actionId } = c.req.valid("param");
      try {
        // Only the student resolves an Unconfirmed Action; nunio never retries it.
        await c.get("delegation").decide(p, {
          kind: "resolve",
          actionId,
          resolution: c.req.valid("json").resolution,
        });
      } catch (error) {
        if (error instanceof UnknownActionError)
          return c.json({ error: "gone" }, 404);
        if (error instanceof StaleApprovalError)
          return c.json({ error: "stale" }, 409);
        throw error;
      }
      return c.json({ status: "ok" as const }, 200);
    },
  );
}
