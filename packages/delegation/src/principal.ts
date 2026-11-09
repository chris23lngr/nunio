import type { PrismaClient } from "@nunio/db";

declare const brand: unique symbol;

/** Authority is never passed in. A Principal can only be minted server-side. */
export type Principal = (
  | { kind: "student"; studentId: string }
  | { kind: "run"; runId: string }
) & {
  readonly [brand]: "Principal";
};

export const principal = {
  /** From the verified Actor that `Auth.authenticate` returned. */
  fromSession(actor: { readonly studentId: string }): Principal {
    return { kind: "student", studentId: actor.studentId } as Principal;
  },
  /** A persisted Run, resolved to its student and Responsibility on every call. */
  fromRun(runId: string): Principal {
    return { kind: "run", runId } as Principal;
  },
};

export type Transaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

/** Runs `fn` in a transaction whose RLS owner context is the Principal's student, or the student whose Run it is. */
export async function withOwner<T>(
  prisma: PrismaClient,
  p: Principal,
  fn: (tx: Transaction, studentId: string) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const studentId =
      p.kind === "student"
        ? p.studentId
        : (
            await tx.$queryRaw<
              { owner: string | null }[]
            >`SELECT run_owner(${p.runId}) AS owner`
          )[0]?.owner;
    if (!studentId)
      throw new Error(`Unknown Run ${p.kind === "run" ? p.runId : ""}`);
    await tx.$executeRaw`SELECT set_config('app.owner_id', ${studentId}, true)`;
    return fn(tx, studentId);
  });
}
