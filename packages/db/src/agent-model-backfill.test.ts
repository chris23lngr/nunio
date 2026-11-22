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
  db = await startTestDatabaseBefore("20261205100000_agent_model");
  admin = createPrismaClient(createPool(db.connectionString));
}, 180_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
});

describe("the Agent Model backfill", () => {
  it("gives every free-text Agent the Chat default, which its Runs ran on, and a preset Agent no Model", async () => {
    const studentId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO "user" ("id", "name", "email", "updatedAt")
      VALUES (${studentId}, 'Student', ${`${studentId}@example.com`}, now())`;
    const agent = async (
      data: { state?: "ended"; preset?: "keep_course_organized" } = {},
    ) => {
      const id = randomUUID();
      await admin.$executeRaw`
        INSERT INTO "agent" ("id", "studentId", "budgetMicroUsd", "state", "preset")
        VALUES (${id}, ${studentId}, 1, ${data.state ?? "active"}::"agent_state", ${data.preset ?? null})`;
      return id;
    };
    const freeText = await agent();
    const ended = await agent({ state: "ended" });
    const preset = await agent({ preset: "keep_course_organized" });

    await db.applyMigration();

    const rows = await admin.$queryRaw<{ id: string; modelKey: string }[]>`
      SELECT "id", "modelKey" FROM "agent" WHERE "studentId" = ${studentId}`;
    expect(Object.fromEntries(rows.map((a) => [a.id, a.modelKey]))).toEqual({
      [freeText]: "sonnet-5.5-reasoning-high",
      [ended]: "sonnet-5.5-reasoning-high",
      [preset]: null,
    });
  });
});
