/**
 * Pilot entitlements and the Allowance.
 */
import type { PrismaClient } from "@nunio/db";

export type PilotStatus = "none" | "active" | "revoked";

export async function activatePilot(prisma: PrismaClient, studentId: string): Promise<void> {
  await prisma.pilotEntitlement.upsert({
    where: { studentId },
    create: { studentId },
    update: {},
  });
}

export async function pilotStatus(prisma: PrismaClient, studentId: string): Promise<PilotStatus> {
  const entitlement = await prisma.pilotEntitlement.findUnique({
    where: { studentId },
    select: { revokedAt: true },
  });
  if (!entitlement) return "none";
  return entitlement.revokedAt ? "revoked" : "active";
}
