import type { PrismaClient } from "@nunio/db";

declare const brand: unique symbol;

/** Authority is never passed in. A Principal can only be minted server-side. */
export type Principal = ({ kind: "student"; studentId: string } | { kind: "run"; runId: string }) & {
  readonly [brand]: "Principal";
};

export const principal = {
  /** From the verified Actor that `Auth.authenticate` returned. */
  fromSession(actor: { readonly studentId: string }): Principal {
    return { kind: "student", studentId: actor.studentId } as Principal;
  },
  /** Grants nothing until Phase 9 resolves persisted Runs to their student and Grants. */
  fromRun(runId: string): Principal {
    return { kind: "run", runId } as Principal;
  },
};

type Transaction = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Runs `fn` in a transaction whose RLS owner context is the Principal's student. */
export async function withOwner<T>(prisma: PrismaClient, p: Principal, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  if (p.kind !== "student") throw new Error("Run principals are not authorized until Phase 9");
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.owner_id', ${p.studentId}, true)`;
    return fn(tx);
  });
}
