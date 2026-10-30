import { createPool, createPrismaClient } from "@nunio/db";

const studentId = process.argv[2]?.trim();
const operator = process.env.OPERATOR_ID?.trim();
const databaseURL = process.env.OPERATOR_DATABASE_URL;
if (!studentId || !operator || !databaseURL || process.argv.length !== 3) {
  console.error("Usage: revoke-pilot.js <student-id>; requires OPERATOR_ID and OPERATOR_DATABASE_URL");
  process.exit(1);
}

const prisma = createPrismaClient(createPool(databaseURL));
try {
  const entitlement = await prisma.$transaction(async tx => {
    // Forced RLS applies to every role without BYPASSRLS; scope this transaction to the student.
    await tx.$executeRaw`SELECT set_config('app.owner_id', ${studentId}, true)`;
    await tx.pilotEntitlement.updateMany({
      where: { studentId, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy: operator },
    });
    return tx.pilotEntitlement.findUnique({
      where: { studentId },
      select: { studentId: true, revokedAt: true, revokedBy: true },
    });
  });
  if (!entitlement) {
    console.error("Pilot entitlement not found");
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(entitlement));
  }
} catch {
  console.error("Could not revoke pilot access; check operator database access and applied migrations");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
