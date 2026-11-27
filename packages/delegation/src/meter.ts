import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { renewBudget } from "./budget.js";
import type {
  ActionArgs,
  ActionOutcome,
  ActionRecord,
  Approve,
  Clock,
  Deny,
  Executors,
  HistoryQuery,
  PlanRules,
  Resolve,
} from "./gate.js";
import { createGate, withdrawApprovals } from "./gate.js";
import type { ActionIntent } from "./kinds.js";
import type { Principal, Transaction } from "./principal.js";
import { principal, withOwner } from "./principal.js";

/** AI usage in micro-USD, as OpenRouter reports cost. */
export interface Usage {
  microUsd: number;
}

export type Metered<T> =
  | { status: "ok"; value: T; usage: Usage }
  | {
      status: "refused";
      reason:
        | "allowance_exhausted"
        | "ai_disabled"
        | "not_entitled"
        | "deletion_pending"
        | "budget_exhausted"
        | "paused"
        | "ended";
    };

/** Thrown by a metered call that certainly incurred no usage, such as a provider's 4xx rejection. */
export class DefiniteFailure extends Error {
  override name = "DefiniteFailure";
}

export interface AllowanceState {
  limitMicroUsd: number;
  usedMicroUsd: number;
  heldMicroUsd: number;
}

/** A call whose outcome is unknown; its estimate stays counted until the founder settles it. */
export interface HeldReservation {
  id: string;
  estimateMicroUsd: number;
  reservedAt: Date;
}

export interface Delegation {
  /** Takes one Action exactly once per key, on a Grant or the student's Approval, rechecked at dispatch. */
  perform(
    p: Principal,
    req: { key: string; intent: ActionIntent },
  ): Promise<ActionOutcome>;
  /** The student's answer to a request for Approval, or their resolution of an Unconfirmed Action. Never dispatches. */
  decide(
    student: Principal,
    d: Approve | Deny | Resolve,
  ): Promise<ActionRecord>;
  /** Recovers in-flight dispatches, and performs or refuses approved Actions nobody went on to perform. */
  reconcile(): Promise<number>;
  history(student: Principal, q?: HistoryQuery): Promise<ActionRecord[]>;
  /** A stored Action as `perform` takes it again; an Integration Action's tool arguments are opened for it. */
  intentOf(
    student: Principal,
    record: Pick<ActionRecord, "id">,
  ): Promise<ActionIntent>;
  /**
   * Reserves `estimate` against the Allowance, runs `call`, then settles its actual usage. A call that throws
   * after it may have been sent (a timeout, abort or network error) keeps its reservation held.
   */
  meter<T>(
    p: Principal,
    estimate: Usage,
    call: (signal: AbortSignal) => Promise<{ value: T; usage: Usage }>,
    options?: { timeoutMs?: number },
  ): Promise<Metered<T>>;
  allowance(p: Principal): Promise<AllowanceState>;
  held(p: Principal): Promise<HeldReservation[]>;
}

/** Why the student may not start new work: no active Pilot Entitlement, or a pending deletion. */
export async function accessRefusal(tx: Transaction, studentId: string) {
  const entitlement = await tx.pilotEntitlement.findUnique({
    where: { studentId },
    select: { revokedAt: true },
  });
  if (!entitlement || entitlement.revokedAt) return "not_entitled" as const;
  if (await tx.deletionRequest.findUnique({ where: { studentId } }))
    return "deletion_pending" as const;
  return undefined;
}

export function createDelegation({
  db,
  aiEnabled,
  clock = { now: () => new Date() },
  executors,
  planRules,
  actionArgs,
  deadlineOf,
}: {
  db: PrismaClient;
  /** The global AI kill switch, checked before every reservation. */
  aiEnabled: () => boolean;
  clock?: Clock;
  /** Needed only to perform Actions. */
  executors?: Executors;
  /** Needed only to perform a free-text Agent's Study Block Actions. */
  planRules?: PlanRules;
  /** Needed only for Integration Actions: seals and opens their tool arguments. */
  actionArgs?: ActionArgs;
  /** An Obligation's deadline, which caps how long a request for Approval stays open. */
  deadlineOf?: (
    studentId: string,
    obligationId: string,
  ) => Promise<Date | null>;
}): Delegation {
  return {
    ...createGate({ db, clock, executors, planRules, actionArgs, deadlineOf }),
    async meter(p, estimate, call, { timeoutMs = 120_000 } = {}) {
      if (!aiEnabled()) return { status: "refused", reason: "ai_disabled" };
      const reservationId = randomUUID();
      let agentId: string | null = null;
      // The Run whose cost the call is: the Run itself, or the Agent's Run that started this Artifact Run.
      let runId: string | null = p.kind === "run" ? p.runId : null;
      // Settled as the student, so a call outlives its Run or Agent being deleted while it is in flight.
      let owner: Principal = p;
      const refusal = await withOwner(db, p, async (tx, studentId) => {
        owner = principal.fromSession({ studentId });
        const denied = await accessRefusal(tx, studentId);
        if (denied) return denied;
        if (p.kind === "run") {
          const run = await tx.run.findUnique({
            where: { id: p.runId },
            select: {
              agentId: true,
              startedByRunId: true,
              startedBy: { select: { agentId: true } },
            },
          });
          agentId = run?.agentId ?? run?.startedBy?.agentId ?? null;
          runId = run?.startedByRunId ?? p.runId;
        }
        if (agentId) {
          await renewBudget(tx, agentId, clock.now());
          // One conditional UPDATE against the Budget too; its row lock serializes the Agent's Runs.
          const budgeted = await tx.$executeRaw`
            UPDATE "agent" SET "heldMicroUsd" = "heldMicroUsd" + ${estimate.microUsd}
            WHERE "id" = ${agentId} AND "state" = 'active'
              AND "budgetMicroUsd" - "usedMicroUsd" - "heldMicroUsd" >= ${estimate.microUsd}`;
          if (budgeted === 0) {
            // Budget exhaustion pauses in the reserving transaction; only the student resumes it. Only an active Agent
            // pauses, so an End or Pause that committed since the reservation stands. Like any Pause, it withdraws the
            // Agent's open Approvals (ADR-0006), here under the Agent's lock as Pause does.
            const paused = await tx.agent.updateMany({
              where: { id: agentId, state: "active" },
              data: { state: "paused", pausedBy: "budget" },
            });
            if (paused.count === 0) {
              const { state, pausedBy } = await tx.agent.findUniqueOrThrow({
                where: { id: agentId },
                select: { state: true, pausedBy: true },
              });
              return state === "active" || pausedBy === "budget"
                ? "budget_exhausted"
                : state;
            }
            await withdrawApprovals(tx, { studentId, agentId }, clock.now());
            return "budget_exhausted";
          }
        }
        // One conditional UPDATE: the row lock serializes concurrent reservations against the same Allowance.
        const reserved = await tx.$executeRaw`
          UPDATE "allowance" SET "heldMicroUsd" = "heldMicroUsd" + ${estimate.microUsd}, "updatedAt" = now()
          WHERE "studentId" = ${studentId}
            AND "limitMicroUsd" - "usedMicroUsd" - "heldMicroUsd" >= ${estimate.microUsd}`;
        if (reserved === 0) {
          if (agentId) {
            await tx.agent.update({
              where: { id: agentId },
              data: { heldMicroUsd: { decrement: estimate.microUsd } },
            });
          }
          return "allowance_exhausted";
        }
        await tx.$executeRaw`
          INSERT INTO "usage_reservation" ("id", "studentId", "estimateMicroUsd", "agentId", "runId")
          VALUES (${reservationId}, ${studentId}, ${estimate.microUsd}, ${agentId}, ${runId})`;
        return undefined;
      });
      if (refusal) return { status: "refused", reason: refusal };
      const settle = (usage: Usage, status: "settled" | "released") =>
        withOwner(db, owner, async (tx, studentId) => {
          // The Agent before the Allowance, in the order reserving locks them, so the two never deadlock. An Agent
          // deleted meanwhile has no Budget left to settle; the Allowance still is.
          if (agentId) {
            // A call that began last month counts against the month it ends in.
            await renewBudget(tx, agentId, clock.now());
            await tx.agent.updateMany({
              where: { id: agentId },
              data: {
                heldMicroUsd: { decrement: estimate.microUsd },
                usedMicroUsd: { increment: usage.microUsd },
              },
            });
          }
          await tx.allowance.update({
            where: { studentId },
            data: {
              heldMicroUsd: { decrement: estimate.microUsd },
              usedMicroUsd: { increment: usage.microUsd },
            },
          });
          await tx.usageReservation.update({
            where: { id: reservationId },
            data: {
              status,
              actualMicroUsd: usage.microUsd,
              settledAt: new Date(),
            },
          });
        });
      const { value, usage } = await call(AbortSignal.timeout(timeoutMs)).catch(
        async (error: unknown) => {
          if (error instanceof DefiniteFailure) {
            await settle({ microUsd: 0 }, "released");
          } else {
            // The estimate is already counted; marking it held only makes it findable for the founder.
            await withOwner(db, owner, (tx) =>
              tx.usageReservation.update({
                where: { id: reservationId },
                data: { status: "held" },
              }),
            );
          }
          throw error;
        },
      );
      await settle(usage, "settled");
      return { status: "ok", value, usage };
    },

    async allowance(p) {
      const row = await withOwner(db, p, (tx, studentId) =>
        tx.allowance.findUnique({ where: { studentId } }),
      );
      // Students without pilot access have no Allowance row; they have nothing to spend.
      if (!row) return { limitMicroUsd: 0, usedMicroUsd: 0, heldMicroUsd: 0 };
      return {
        limitMicroUsd: Number(row.limitMicroUsd),
        usedMicroUsd: Number(row.usedMicroUsd),
        heldMicroUsd: Number(row.heldMicroUsd),
      };
    },

    async held(p) {
      const rows = await withOwner(db, p, (tx, studentId) =>
        tx.usageReservation.findMany({
          where: { studentId, status: "held" },
          orderBy: { reservedAt: "asc" },
          select: { id: true, estimateMicroUsd: true, reservedAt: true },
        }),
      );
      return rows.map((row) => ({
        ...row,
        estimateMicroUsd: Number(row.estimateMicroUsd),
      }));
    },
  };
}
