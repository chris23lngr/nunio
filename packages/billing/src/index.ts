/**
 * Pilot entitlements and the Allowance.
 */
import type { PrismaClient } from "@nunio/db";
import { withOwner, type Principal } from "@nunio/delegation";

export type PilotStatus = "none" | "active" | "revoked";

/** Grants pilot access with the default Allowance; repeating it changes neither. */
export async function activatePilot(prisma: PrismaClient, student: Principal): Promise<void> {
  await withOwner(prisma, student, async (tx, studentId) => {
    await tx.pilotEntitlement.upsert({ where: { studentId }, create: { studentId }, update: {} });
    // Only the student ID: the runtime role may not choose its own limit, so the column default applies.
    await tx.$executeRaw`INSERT INTO "allowance" ("studentId") VALUES (${studentId}) ON CONFLICT DO NOTHING`;
  });
}

/** Whether the student was ever granted pilot access; reads inside the caller's owner-context transaction. */
export async function hasPilotEntitlement(tx: Pick<PrismaClient, "pilotEntitlement">, studentId: string): Promise<boolean> {
  return await tx.pilotEntitlement.findUnique({ where: { studentId }, select: { studentId: true } }) !== null;
}

export async function pilotStatus(prisma: PrismaClient, student: Principal): Promise<PilotStatus> {
  const entitlement = await withOwner(prisma, student, (tx, studentId) => tx.pilotEntitlement.findUnique({
    where: { studentId },
    select: { revokedAt: true },
  }));
  if (!entitlement) return "none";
  return entitlement.revokedAt ? "revoked" : "active";
}
