import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./index.js";
import { createPool, createPrismaClient } from "./index.js";
import type { TestDatabase } from "./testing.js";
import { startTestDatabase } from "./testing.js";

let db: TestDatabase;
/** Seeds fixtures and runs the backfill as the migration role. */
let admin: PrismaClient;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
}, 180_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
});

/** The migration's backfill: everything after the statement that adds the column. */
const backfill = readFileSync(
  new URL(
    "../prisma/migrations/20261207100000_agent_budget_month/migration.sql",
    import.meta.url,
  ),
  "utf8",
).split('ADD COLUMN "budgetMonth" TEXT;')[1]!;

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
      await admin.user.create({
        data: {
          id: studentId,
          name: "Student",
          email: `${studentId}@example.com`,
        },
      });
      if (timeZone)
        await admin.planPreference.create({ data: { studentId, timeZone } });
      return admin.agent.create({
        data: {
          id: randomUUID(),
          studentId,
          budgetMicroUsd: 5_000_000,
          usedMicroUsd: 1_200_000,
        },
      });
    };
    const kiritimati = await student("Pacific/Kiritimati");
    const berlin = await student();

    await admin.$executeRawUnsafe(backfill);

    const rows = await admin.agent.findMany({
      where: { id: { in: [kiritimati.id, berlin.id] } },
      select: { id: true, budgetMonth: true, usedMicroUsd: true },
    });
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
