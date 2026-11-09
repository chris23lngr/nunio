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

/** One Action as the student sees it: which work, where its block is now, and where it would go. */
export function describeAction(
  plan: PlanView,
  kind: ActionRecord["kind"],
  args: unknown,
) {
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
      course: obligation?.course ?? null,
    },
    from: block ? { start: block.start, end: block.end } : null,
    to: { start: new Date(start), end: new Date(end) },
  };
}
export const ActionShown = z
  .object({
    kind: z.enum(["studyBlock.create", "studyBlock.move"]),
    work: z.object({ title: z.string(), course: z.string().nullable() }),
    from: Span.nullable().describe(
      "Where the block is now; null for a new block.",
    ),
    to: Span,
  })
  .openapi("ActionShown");

/** The Actions awaiting the student's Approval, each as the exact Action the card shows. */
async function approvalsOf(c: Context<AppBindings>, p: Principal) {
  const asking = await c
    .get("delegation")
    .history(p, { status: "awaiting_approval" });
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
      // Only after the decision committed: the Run then asks the gate again.
      if (record.runId && record.workflowId) {
        await c
          .get("runWorkflows")
          .signalDecided(
            { workflowId: record.workflowId, runId: record.runId },
            actionId,
          );
      }
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
