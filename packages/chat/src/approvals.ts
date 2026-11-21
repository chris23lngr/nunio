import type { PrismaClient } from "@nunio/db";
import type { Principal, Refusal } from "@nunio/delegation";
import { openApprovalAt, withOwner } from "@nunio/delegation";
import type { Tool } from "ai";
import { jsonSchema, tool } from "ai";
import { why } from "./run-actions.js";
import type { Turn } from "./turn.js";
import { fenced } from "./turn.js";

/** What the student sees of a reading of the Agent's Approvals: how many are open, and how many were answered since. */
export type ApprovalsOutput = { open: number; decided: number };

/**
 * Reads the Run's Agent's open Approvals, and those decided or expired since its previous Run, so the Run neither asks
 * twice nor ignores an answer (ADR-0006). Work and blocks are named by handle; what became of each is fenced as data
 * (ADR-0026). An Approval is open until decided, withdrawn or past its expiry, which no timer marks.
 */
export function approvalsTool(
  turn: Turn,
  {
    db,
    p,
    runId,
    timeZone,
    clock,
  }: {
    db: PrismaClient;
    p: Principal;
    runId: string;
    timeZone: string;
    clock: { now(): Date };
  },
): Tool<Record<string, never>, ApprovalsOutput> {
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const at = (instant: Date) => local.format(instant).replace(",", "");
  const span = (start: Date, end: Date) => `${at(start)}–${at(end).slice(11)}`;
  return tool({
    description:
      "Reads your requests for the student's Approval: those still open, which you must not ask for again, and those the student decided or that expired since your previous Run, with what became of each. Work, blocks and Course Events carry handles such as O1, B1 or E1, as agenda gives them.",
    inputSchema: jsonSchema<Record<string, never>>({
      type: "object",
      properties: {},
      additionalProperties: false,
    }),
    execute: async (_, { toolCallId }): Promise<ApprovalsOutput> => {
      const now = clock.now();
      const read = await withOwner(db, p, async (tx) => {
        const run = await tx.run.findUniqueOrThrow({ where: { id: runId } });
        const previous = await tx.run.findFirst({
          where: {
            agentId: run.agentId,
            status: { not: null },
            id: { not: runId },
            startedAt: { lt: run.startedAt },
          },
          orderBy: { startedAt: "desc" },
          select: { startedAt: true },
        });
        // Answers given while the previous Run was under way may have come after it read them, so they count too.
        const since = previous?.startedAt ?? new Date(0);
        const approvals = await tx.approval.findMany({
          where: {
            action: { run: { agentId: run.agentId, status: { not: null } } },
            OR: [
              { action: openApprovalAt(now) },
              { decidedAt: { gte: since } },
              // Unanswered past its expiry, or refused once a late answer came.
              {
                decision: null,
                expiresAt: { gte: since, lte: now },
                action: {
                  OR: [
                    { status: "awaiting_approval" },
                    { refusal: "approval_expired" },
                  ],
                },
              },
              // Withdrawn when the student Paused or Ended the Agent; only the refusal's event dates it.
              {
                decision: null,
                action: {
                  refusal: "approval_withdrawn",
                  events: { some: { type: "refused", at: { gte: since } } },
                },
              },
            ],
          },
          include: { action: true },
          orderBy: [
            { action: { createdAt: "asc" } },
            { action: { key: "asc" } },
          ],
        });
        const workIds = approvals.flatMap(({ action }) => {
          const { workId } = action.args as { workId?: string };
          return workId ? [workId] : [];
        });
        const obligations = new Set(
          (
            await tx.obligation.findMany({
              where: { id: { in: workIds } },
              select: { id: true },
            })
          ).map((o) => o.id),
        );
        return { approvals, obligations };
      });
      const named = (action: { kind: string; args: unknown }) => {
        const args = action.args as {
          workId?: string;
          studyBlockId?: string;
          start?: string;
          end?: string;
          title?: string;
          obligationId?: string;
          fixedEventId?: string | null;
          role?: "preparation" | "follow_up" | null;
        };
        const times =
          args.start && args.end
            ? span(new Date(args.start), new Date(args.end))
            : "";
        const work = args.workId
          ? turn.handleFor(
              read.obligations.has(args.workId) ? "obligation" : "task",
              args.workId,
            )
          : "";
        const block = args.studyBlockId
          ? turn.handleFor("block", args.studyBlockId)
          : "";
        if (action.kind === "studyBlock.create")
          return `create a Study Block for ${work} at ${times}`;
        if (action.kind === "studyBlock.move")
          return `move ${block} to ${times}`;
        if (action.kind === "studyBlock.remove")
          return `remove ${block} (${times})`;
        if (action.kind === "task.create")
          return `create the Task "${args.title}"${
            args.obligationId
              ? ` toward ${turn.handleFor("obligation", args.obligationId)}`
              : args.fixedEventId
                ? ` as the ${args.role === "preparation" ? "Preparation" : "Follow-up"} of ${turn.handleFor("event", args.fixedEventId)}`
                : ""
          }`;
        return action.kind;
      };
      const open: string[] = [];
      const answered: string[] = [];
      for (const { decision, expiresAt, action } of read.approvals) {
        if (decision === null && action.status === "awaiting_approval") {
          if (expiresAt > now)
            open.push(`- ${named(action)} · expires ${at(expiresAt)}`);
          else answered.push(`- ${named(action)} · expired unanswered`);
          continue;
        }
        let outcome: string;
        if (decision === "denied") outcome = "declined by the student";
        else if (decision === null)
          // Refused without an answer: a late one came after it expired, or it was withdrawn.
          outcome =
            action.refusal === "approval_expired"
              ? "expired unanswered"
              : `refused: ${why[action.refusal as Refusal] ?? action.refusal}`;
        else if (action.status === "done")
          outcome =
            action.kind === "studyBlock.create"
              ? `approved and done: the Study Block is ${turn.handleFor(
                  "block",
                  (action.effect as { studyBlockId: string }).studyBlockId,
                )}`
              : action.kind === "task.create"
                ? `approved and done: the Task is ${turn.handleFor(
                    "task",
                    (action.effect as { taskId: string }).taskId,
                  )}`
                : "approved and done";
        else if (action.status === "refused")
          outcome = `approved, but refused: ${why[action.refusal as Refusal] ?? action.refusal}`;
        else if (action.status === "failed")
          outcome = "approved, but it failed and did not happen";
        else if (action.status === "unconfirmed")
          outcome =
            "approved, but nunio cannot tell whether it happened, so the student resolves it";
        else outcome = "approved and being carried out";
        answered.push(`- ${named(action)} · ${outcome}`);
      }
      turn.give(
        toolCallId,
        fenced("approvals", [
          "Open, the student has not decided yet; do not ask for these again:",
          ...(open.length ? open : ["none"]),
          "Decided or expired since your previous Run:",
          ...(answered.length ? answered : ["none"]),
        ]),
      );
      return { open: open.length, decided: answered.length };
    },
    toModelOutput: turn.modelOutput,
  });
}
