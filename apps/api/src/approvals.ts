import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { ActionRecord, Principal } from "@nunio/delegation";
import { StaleApprovalError, UnknownActionError } from "@nunio/delegation";
import type { Context } from "hono";
import type { AppBindings } from "./app.js";
import { body, Done, errors, json, outcomes, student } from "./outcomes.js";

const Span = z.object({ start: z.date(), end: z.date() });
const Approval = z
  .object({
    actionId: z.string(),
    action: z
      .lazy(() => ActionShown)
      .describe("The exact Action, as the student confirms it (ADR-0010)."),
    fingerprint: z
      .string()
      .describe("Sent back unchanged to approve exactly this Action."),
    expiresAt: z.date(),
    responsibility: z.object({ id: z.string(), preset: z.string() }).nullable(),
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
    const { title, courseId, taskId } = args as {
      title?: string;
      courseId?: string | null;
      taskId?: string;
    };
    const task = plan.tasks.find((t) => t.id === taskId);
    return {
      kind,
      work: {
        title: title ?? task?.title ?? "Work that is gone",
        course: courseTitle(plan, courseId ?? task?.courseId ?? null),
      },
      from: null,
      to: null,
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
  })
  .openapi("ActionShown");

/**
 * Performs a Chat's Action once the student approved it, wherever they did: it has no Run to do so (ADR-0019,
 * delegation-gate.md "Chat origin"). Its record then tells how it went.
 */
export async function performApproved(
  c: Context<AppBindings>,
  p: Principal,
  record: ActionRecord,
) {
  if (record.runId !== null || record.approval?.decision !== "approved")
    return record;
  const delegation = c.get("delegation");
  await delegation
    .perform(p, { key: record.key, intent: record.intent })
    .catch((error: unknown) =>
      console.error(
        JSON.stringify({
          msg: "approved Chat Action failed",
          actionId: record.id,
          error: String(error),
        }),
      ),
    );
  return (await delegation.history(p, { ids: [record.id] }))[0] ?? record;
}

/** The Actions awaiting the student's Approval, each as the exact Action the card shows. */
async function approvalsOf(c: Context<AppBindings>, p: Principal) {
  const now = new Date();
  // An expired Approval no longer counts; a Chat's has no Run to close it, so it is left out here (ADR-0019).
  const asking = (
    await c.get("delegation").history(p, { status: "awaiting_approval" })
  ).filter((a) => a.approval && a.approval.expiresAt > now);
  if (!asking.length) return [];
  const plan = await c.get("plan").view(p);
  const presets = new Map<string, string>();
  for (const id of new Set(
    asking.flatMap((a) => (a.responsibilityId ? [a.responsibilityId] : [])),
  )) {
    const r = await c.get("responsibilities").view(p, id);
    if (r) presets.set(id, r.preset);
  }
  return asking.map((a: ActionRecord) => ({
    actionId: a.id,
    action: describeAction(plan, a.kind, a.args),
    fingerprint: a.approval!.fingerprint,
    expiresAt: a.approval!.expiresAt,
    responsibility: a.responsibilityId
      ? {
          id: a.responsibilityId,
          preset: presets.get(a.responsibilityId) ?? "",
        }
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
      responses: { 200: Done, ...outcomes },
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
      await performApproved(c, p, record);
      // A committed decision is the durable outbox; reconciliation retries an unacknowledged wake.
      await c
        .get("delegation")
        .notifyDecision(p, record.id, ({ workflowId, runId, actionId }) =>
          c.get("runWorkflows").signalDecided({ workflowId, runId }, actionId),
        )
        .catch((error: unknown) => {
          console.error(
            "Approval decision saved; reconciliation will retry its wake",
            error,
          );
        });
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
