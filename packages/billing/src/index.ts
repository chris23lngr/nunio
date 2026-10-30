/**
 * Pilot entitlements and the Allowance.
 */
import type { PrismaClient } from "@nunio/db";
import { withOwner, type Principal } from "@nunio/delegation";

export type PilotStatus = "none" | "active" | "revoked";

export async function activatePilot(prisma: PrismaClient, student: Principal): Promise<void> {
  await withOwner(prisma, student, (tx, studentId) => tx.pilotEntitlement.upsert({
    where: { studentId },
    create: { studentId },
    update: {},
  }));
}

export async function pilotStatus(prisma: PrismaClient, student: Principal): Promise<PilotStatus> {
  const entitlement = await withOwner(prisma, student, (tx, studentId) => tx.pilotEntitlement.findUnique({
    where: { studentId },
    select: { revokedAt: true },
  }));
  if (!entitlement) return "none";
  return entitlement.revokedAt ? "revoked" : "active";
}
