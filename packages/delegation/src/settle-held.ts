import { createPool, createPrismaClient } from "@nunio/db";

const studentId = process.argv[2]?.trim();
const reservationId = process.argv[3]?.trim();
const usd = process.argv[4]?.trim();
const operator = process.env.OPERATOR_ID?.trim();
const databaseURL = process.env.OPERATOR_DATABASE_URL;
const amount = usd?.match(/^(\d+)(?:\.(\d{1,6}))?$/);
if (!studentId || !reservationId || !amount || !operator || !databaseURL || process.argv.length !== 5) {
  console.error("Usage: settle-held.js <student-id> <reservation-id> <usd>; usd is the call's actual cost "
    + "from OpenRouter, 0 if it was not charged; requires OPERATOR_ID and OPERATOR_DATABASE_URL");
  process.exit(1);
}
// Whole micro-USD from the decimal string, avoiding floating-point rounding.
const actualMicroUsd = BigInt(amount[1]!) * 1_000_000n + BigInt((amount[2] ?? "").padEnd(6, "0"));
const status = actualMicroUsd === 0n ? "released" : "settled";

const prisma = createPrismaClient(createPool(databaseURL));
try {
  const settled = await prisma.$transaction(async tx => {
    // Forced RLS applies to every role without BYPASSRLS; scope this transaction to the student.
    await tx.$executeRaw`SELECT set_config('app.owner_id', ${studentId}, true)`;
    // Only a held reservation can be settled, so repeating the command never charges twice.
    const [reservation] = await tx.$queryRaw<{ estimateMicroUsd: bigint; settledAt: Date; responsibilityId: string | null }[]>`
      UPDATE "usage_reservation"
      SET "status" = ${status}::"reservation_status", "actualMicroUsd" = ${actualMicroUsd},
          "settledAt" = now(), "settledBy" = ${operator}
      WHERE "id" = ${reservationId} AND "studentId" = ${studentId} AND "status" = 'held'
      RETURNING "estimateMicroUsd", "settledAt", "responsibilityId"`;
    if (!reservation) return null;
    // A Run's call also counts against its Responsibility's Budget; locked before the Allowance, as meter does.
    if (reservation.responsibilityId) {
      await tx.responsibility.update({
        where: { id: reservation.responsibilityId },
        data: { heldMicroUsd: { decrement: reservation.estimateMicroUsd }, usedMicroUsd: { increment: actualMicroUsd } },
      });
    }
    await tx.allowance.update({
      where: { studentId },
      data: { heldMicroUsd: { decrement: reservation.estimateMicroUsd }, usedMicroUsd: { increment: actualMicroUsd } },
    });
    return { reservationId, studentId, status, estimateMicroUsd: Number(reservation.estimateMicroUsd),
      actualMicroUsd: Number(actualMicroUsd), settledBy: operator, settledAt: reservation.settledAt };
  });
  if (!settled) {
    console.error("Held reservation not found for this student");
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(settled));
  }
} catch {
  console.error("Could not settle the reservation; check operator database access and applied migrations");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
