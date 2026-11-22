import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./index.js";
import { createPool, createPrismaClient } from "./index.js";
import type { DatabaseBeforeMigration } from "./testing.js";
import { startTestDatabaseBefore } from "./testing.js";

let db: DatabaseBeforeMigration;
/** Seeds fixtures as the migration role, in raw SQL since the schema is still the one before the migration. */
let admin: PrismaClient;

beforeAll(async () => {
  db = await startTestDatabaseBefore("20261207100000_agent_budget_month");
  admin = createPrismaClient(createPool(db.connectionString));
}, 180_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
});

const monthIn = (timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}`;
};

describe("the Agent Budget month backfill", () => {
  it("counts what each Agent used so far for the current month in its Plan's time zone, keeping the amount", async () => {
    const student = async (timeZone?: string) => {
      const studentId = randomUUID();
      await admin.$executeRaw`
        INSERT INTO "user" ("id", "name", "email", "updatedAt")
        VALUES (${studentId}, 'Student', ${`${studentId}@example.com`}, now())`;
      if (timeZone)
        await admin.$executeRaw`
          INSERT INTO "plan_preference" ("studentId", "timeZone")
          VALUES (${studentId}, ${timeZone})`;
      const id = randomUUID();
      await admin.$executeRaw`
        INSERT INTO "agent" ("id", "studentId", "budgetMicroUsd", "usedMicroUsd")
        VALUES (${id}, ${studentId}, 5000000, 1200000)`;
      return { id };
    };
    const kiritimati = await student("Pacific/Kiritimati");
    const berlin = await student();

    await db.applyMigration();

    const rows = await admin.$queryRaw<
      { id: string; budgetMonth: string; usedMicroUsd: bigint }[]
    >`
      SELECT "id", "budgetMonth", "usedMicroUsd" FROM "agent"
      WHERE "id" IN (${kiritimati.id}, ${berlin.id})`;
    expect(Object.fromEntries(rows.map((r) => [r.id, r]))).toEqual({
      [kiritimati.id]: {
        id: kiritimati.id,
        budgetMonth: monthIn("Pacific/Kiritimati"),
        usedMicroUsd: 1_200_000n,
      },
      [berlin.id]: {
        id: berlin.id,
        budgetMonth: monthIn("Europe/Berlin"),
        usedMicroUsd: 1_200_000n,
      },
    });
  });
});
