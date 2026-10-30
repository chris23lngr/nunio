import type { PrismaClient } from "@nunio/db";
import { withOwner, type Principal } from "./principal.js";

/** AI usage in micro-USD, as OpenRouter reports cost. */
export interface Usage {
  microUsd: number;
}

export type Metered<T> =
  | { status: "ok"; value: T; usage: Usage }
  | { status: "refused"; reason: "allowance_exhausted" | "ai_disabled" | "not_entitled" };

/** Thrown by a metered call that certainly incurred no usage, such as a provider's 4xx rejection. */
export class DefiniteFailure extends Error {
  override name = "DefiniteFailure";
}

export interface AllowanceState {
  limitMicroUsd: number;
  usedMicroUsd: number;
  heldMicroUsd: number;
}

export interface Delegation {
  /**
   * Reserves `estimate` against the Allowance, runs `call`, then settles its actual usage. A call that throws
   * after it may have been sent (a timeout, abort or network error) keeps its reservation held.
   */
  meter<T>(p: Principal, estimate: Usage,
    call: (signal: AbortSignal) => Promise<{ value: T; usage: Usage }>,
    options?: { timeoutMs?: number }): Promise<Metered<T>>;
  allowance(p: Principal): Promise<AllowanceState>;
}

export function createDelegation({ db, aiEnabled }: {
  db: PrismaClient;
  /** The global AI kill switch, checked before every reservation. */
  aiEnabled: () => boolean;
}): Delegation {
  return {
    async meter(p, estimate, call, { timeoutMs = 120_000 } = {}) {
      if (!aiEnabled()) return { status: "refused", reason: "ai_disabled" };
      const refusal = await withOwner(db, p, async (tx, studentId) => {
        const entitlement = await tx.pilotEntitlement.findUnique({ where: { studentId }, select: { revokedAt: true } });
        if (!entitlement || entitlement.revokedAt) return "not_entitled";
        // One conditional UPDATE: the row lock serializes concurrent reservations against the same Allowance.
        const reserved = await tx.$executeRaw`
          UPDATE "allowance" SET "heldMicroUsd" = "heldMicroUsd" + ${estimate.microUsd}, "updatedAt" = now()
          WHERE "studentId" = ${studentId}
            AND "limitMicroUsd" - "usedMicroUsd" - "heldMicroUsd" >= ${estimate.microUsd}`;
        return reserved === 0 ? "allowance_exhausted" : undefined;
      });
      if (refusal) return { status: "refused", reason: refusal };
      const settle = (usage: Usage) => withOwner(db, p, (tx, studentId) => tx.allowance.update({
        where: { studentId },
        data: { heldMicroUsd: { decrement: estimate.microUsd }, usedMicroUsd: { increment: usage.microUsd } },
      }));
      const { value, usage } = await call(AbortSignal.timeout(timeoutMs)).catch(async (error: unknown) => {
        if (error instanceof DefiniteFailure) await settle({ microUsd: 0 });
        throw error;
      });
      await settle(usage);
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
  };
}
