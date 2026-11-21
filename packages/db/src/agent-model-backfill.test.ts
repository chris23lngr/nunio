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

/** The migration's backfill: everything after the statements that add the column and its foreign key. */
const backfill = readFileSync(
  new URL(
    "../prisma/migrations/20261205100000_agent_model/migration.sql",
    import.meta.url,
  ),
  "utf8",
).split("ON UPDATE CASCADE;")[1]!;

describe("the Agent Model backfill", () => {
  it("gives every free-text Agent the Chat default, which its Runs ran on, and a preset Agent no Model", async () => {
    const studentId = randomUUID();
    await admin.user.create({
      data: {
        id: studentId,
        name: "Student",
        email: `${studentId}@example.com`,
      },
    });
    const agent = (data: { preset?: string; state?: "ended" }) =>
      admin.agent.create({
        data: { id: randomUUID(), studentId, budgetMicroUsd: 1, ...data },
      });
    const freeText = await agent({});
    const ended = await agent({ state: "ended" });
    const preset = await agent({ preset: "keep_course_organized" });

    await admin.$executeRawUnsafe(backfill);

    const models = Object.fromEntries(
      (
        await admin.agent.findMany({
          where: { studentId },
          select: { id: true, modelKey: true },
        })
      ).map((a) => [a.id, a.modelKey]),
    );
    expect(models).toEqual({
      [freeText.id]: "sonnet-5.5-reasoning-high",
      [ended.id]: "sonnet-5.5-reasoning-high",
      [preset.id]: null,
    });
  });
});
