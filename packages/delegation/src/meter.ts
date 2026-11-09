import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createGate, type ActionOutcome, type ActionRecord, type Approve, type Clock, type Deny, type Executors, type HistoryQuery, type Resolve } from "./gate.js";
import type { ActionIntent } from "./kinds.js";
import { withOwner, type Principal, type Transaction } from "./principal.js";

/** AI usage in micro-USD, as OpenRouter reports cost. */
export interface Usage {
  microUsd: number;
}

export type Metered<T> =
  | { status: "ok"; value: T; usage: Usage }
  | { status: "refused"; reason: "allowance_exhausted" | "ai_disabled" | "not_entitled" | "deletion_pending"
    | "budget_exhausted" | "paused" | "ended" };

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
  perform(p: Principal, req: { key: string; intent: ActionIntent }): Promise<ActionOutcome>;
  /** The student's answer to a request for Approval, or their resolution of an Unconfirmed Action. Never dispatches. */
  decide(student: Principal, d: Approve | Deny | Resolve): Promise<ActionRecord>;
  reconcile(): Promise<number>;
  history(student: Principal, q?: HistoryQuery): Promise<ActionRecord[]>;
  /**
   * Reserves `estimate` against the Allowance, runs `call`, then settles its actual usage. A call that throws
   * after it may have been sent (a timeout, abort or network error) keeps its reservation held.
   */
  meter<T>(p: Principal, estimate: Usage,
    call: (signal: AbortSignal) => Promise<{ value: T; usage: Usage }>,
    options?: { timeoutMs?: number }): Promise<Metered<T>>;
  allowance(p: Principal): Promise<AllowanceState>;
  held(p: Principal): Promise<HeldReservation[]>;
}

/** Why the student may not start new work: no active Pilot Entitlement, or a pending deletion. */
export async function accessRefusal(tx: Transaction, studentId: string) {
  const entitlement = await tx.pilotEntitlement.findUnique({ where: { studentId }, select: { revokedAt: true } });
  if (!entitlement || entitlement.revokedAt) return "not_entitled" as const;
  if (await tx.deletionRequest.findUnique({ where: { studentId } })) return "deletion_pending" as const;
  return undefined;
}

export function createDelegation({ db, aiEnabled, clock = { now: () => new Date() }, executors, deadlineOf }: {
  db: PrismaClient;
  /** The global AI kill switch, checked before every reservation. */
  aiEnabled: () => boolean;
  clock?: Clock;
  /** Needed only to perform Actions. */
  executors?: Executors;
  /** An Obligation's deadline, which caps how long a request for Approval stays open. */
  deadlineOf?: (studentId: string, obligationId: string) => Promise<Date | null>;
}): Delegation {
  return {
    ...createGate({ db, clock, executors, deadlineOf }),
    async meter(p, estimate, call, { timeoutMs = 120_000 } = {}) {
      if (!aiEnabled()) return { status: "refused", reason: "ai_disabled" };
      const reservationId = randomUUID();
      let responsibilityId: string | null = null;
      const refusal = await withOwner(db, p, async (tx, studentId) => {
        const denied = await accessRefusal(tx, studentId);
        if (denied) return denied;
        if (p.kind === "run") {
          responsibilityId = (await tx.run.findUnique({ where: { id: p.runId } }))?.responsibilityId ?? null;
        }
        if (responsibilityId) {
          // One conditional UPDATE against the Budget too; its row lock serializes the Responsibility's Runs.
          const budgeted = await tx.$executeRaw`
            UPDATE "responsibility" SET "heldMicroUsd" = "heldMicroUsd" + ${estimate.microUsd}
            WHERE "id" = ${responsibilityId} AND "state" = 'active'
              AND "budgetMicroUsd" - "usedMicroUsd" - "heldMicroUsd" >= ${estimate.microUsd}`;
          if (budgeted === 0) {
            const { state } = await tx.responsibility.findUniqueOrThrow({ where: { id: responsibilityId }, select: { state: true } });
            if (state !== "active") return state;
            // Budget exhaustion pauses in the reserving transaction; only the student resumes it.
            await tx.responsibility.update({ where: { id: responsibilityId }, data: { state: "paused", pausedBy: "budget" } });
            return "budget_exhausted";
          }
        }
        // One conditional UPDATE: the row lock serializes concurrent reservations against the same Allowance.
        const reserved = await tx.$executeRaw`
          UPDATE "allowance" SET "heldMicroUsd" = "heldMicroUsd" + ${estimate.microUsd}, "updatedAt" = now()
          WHERE "studentId" = ${studentId}
            AND "limitMicroUsd" - "usedMicroUsd" - "heldMicroUsd" >= ${estimate.microUsd}`;
        if (reserved === 0) {
          if (responsibilityId) {
            await tx.responsibility.update({ where: { id: responsibilityId }, data: { heldMicroUsd: { decrement: estimate.microUsd } } });
          }
          return "allowance_exhausted";
        }
        await tx.$executeRaw`
          INSERT INTO "usage_reservation" ("id", "studentId", "estimateMicroUsd", "responsibilityId")
          VALUES (${reservationId}, ${studentId}, ${estimate.microUsd}, ${responsibilityId})`;
        return undefined;
      });
      if (refusal) return { status: "refused", reason: refusal };
      const settle = (usage: Usage, status: "settled" | "released") => withOwner(db, p, async (tx, studentId) => {
        // The Responsibility before the Allowance, in the order reserving locks them, so the two never deadlock.
        if (responsibilityId) {
          await tx.responsibility.update({
            where: { id: responsibilityId },
            data: { heldMicroUsd: { decrement: estimate.microUsd }, usedMicroUsd: { increment: usage.microUsd } },
          });
        }
        await tx.allowance.update({
          where: { studentId },
          data: { heldMicroUsd: { decrement: estimate.microUsd }, usedMicroUsd: { increment: usage.microUsd } },
        });
        await tx.usageReservation.update({
          where: { id: reservationId },
          data: { status, actualMicroUsd: usage.microUsd, settledAt: new Date() },
        });
      });
      const { value, usage } = await call(AbortSignal.timeout(timeoutMs)).catch(async (error: unknown) => {
        if (error instanceof DefiniteFailure) {
          await settle({ microUsd: 0 }, "released");
        } else {
          // The estimate is already counted; marking it held only makes it findable for the founder.
          await withOwner(db, p, tx => tx.usageReservation.update({ where: { id: reservationId }, data: { status: "held" } }));
        }
        throw error;
      });
      await settle(usage, "settled");
      return { status: "ok", value, usage };
    },

    async allowance(p) {
      const row = await withOwner(db, p, (tx, studentId) => tx.allowance.findUnique({ where: { studentId } }));
      // Students without pilot access have no Allowance row; they have nothing to spend.
      if (!row) return { limitMicroUsd: 0, usedMicroUsd: 0, heldMicroUsd: 0 };
      return {
        limitMicroUsd: Number(row.limitMicroUsd),
        usedMicroUsd: Number(row.usedMicroUsd),
        heldMicroUsd: Number(row.heldMicroUsd),
      };
    },

    async held(p) {
      const rows = await withOwner(db, p, (tx, studentId) => tx.usageReservation.findMany({
        where: { studentId, status: "held" },
        orderBy: { reservedAt: "asc" },
        select: { id: true, estimateMicroUsd: true, reservedAt: true },
      }));
      return rows.map(row => ({ ...row, estimateMicroUsd: Number(row.estimateMicroUsd) }));
    },
  };
}
