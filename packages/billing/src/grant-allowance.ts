import { createPool, createPrismaClient } from "@nunio/db";

const studentId = process.argv[2]?.trim();
const usd = process.argv[3]?.trim();
const operator = process.env.OPERATOR_ID?.trim();
const databaseURL = process.env.OPERATOR_DATABASE_URL;
const amount = usd?.match(/^(\d+)(?:\.(\d{1,6}))?$/);
// Whole micro-USD from the decimal string, avoiding floating-point rounding.
const amountMicroUsd = amount
  ? BigInt(amount[1]!) * 1_000_000n + BigInt((amount[2] ?? "").padEnd(6, "0"))
  : 0n;
if (
  !studentId ||
  !operator ||
  !databaseURL ||
  amountMicroUsd <= 0n ||
  process.argv.length !== 4
) {
  console.error(
    "Usage: grant-allowance.js <student-id> <usd>; usd is a positive amount such as 2.50; " +
      "requires OPERATOR_ID and OPERATOR_DATABASE_URL",
  );
  process.exit(1);
}

const prisma = createPrismaClient(createPool(databaseURL));
try {
  const granted = await prisma.$transaction(async (tx) => {
    // Forced RLS applies to every role without BYPASSRLS; scope this transaction to the student.
    await tx.$executeRaw`SELECT set_config('app.owner_id', ${studentId}, true)`;
    const { count } = await tx.allowance.updateMany({
      where: { studentId },
      data: { limitMicroUsd: { increment: amountMicroUsd } },
    });
    if (count === 0) return null;
    const grant = await tx.allowanceGrant.create({
      data: { studentId, amountMicroUsd, grantedBy: operator },
    });
    const { limitMicroUsd } = await tx.allowance.findUniqueOrThrow({
      where: { studentId },
    });
    return {
      studentId,
      grantedMicroUsd: Number(amountMicroUsd),
      limitMicroUsd: Number(limitMicroUsd),
      grantedBy: grant.grantedBy,
      grantedAt: grant.grantedAt,
    };
  });
  if (!granted) {
    console.error(
      "Allowance not found; the student needs active pilot access first",
    );
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(granted));
  }
} catch {
  console.error(
    "Could not grant Allowance; check operator database access and applied migrations",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
