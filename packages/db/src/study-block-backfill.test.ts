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
  db = await startTestDatabaseBefore("20261129100000_study_block_created_by");
  admin = createPrismaClient(createPool(db.connectionString));
}, 180_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
});

const at = (hour: number) => new Date(Date.UTC(2026, 10, 10, hour));

describe("the createdByAgentId backfill", () => {
  it("claims a block for the Agent that created it only while it sits where the Agent placed it", async () => {
    const studentId = randomUUID(),
      courseId = randomUUID(),
      obligationId = randomUUID(),
      agentId = randomUUID(),
      runId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO "user" ("id", "name", "email", "updatedAt")
      VALUES (${studentId}, 'Student', ${`${studentId}@example.com`}, now())`;
    await admin.$executeRaw`
      INSERT INTO "course" ("id", "studentId", "title", "matchTitle", "semester", "color")
      VALUES (${courseId}, ${studentId}, 'Analysis I', 'analysis i', '2026-ws', 'rose')`;
    await admin.$executeRaw`
      INSERT INTO "obligation" ("id", "studentId", "courseId", "matchKey", "kind", "enteredAt")
      VALUES (${obligationId}, ${studentId}, ${courseId}, 'sheet-1', 'assignment', ${at(0)})`;
    await admin.$executeRaw`
      INSERT INTO "agent" ("id", "studentId", "budgetMicroUsd") VALUES (${agentId}, ${studentId}, 100000)`;
    await admin.$executeRaw`
      INSERT INTO "run" ("id", "studentId", "agentId") VALUES (${runId}, ${studentId}, ${agentId})`;
    /** A block an Action placed at `hour`, as the gate and executor record it, now at `nowAt`. */
    async function placed(hour: number, nowAt: number, { inRun = true } = {}) {
      const actionId = randomUUID(),
        blockId = randomUUID(),
        idempotencyKey = `${actionId}:1`;
      // As the gate stores arguments: JSON, with dates as ISO strings.
      const args = JSON.stringify({
        workId: obligationId,
        start: at(hour),
        end: at(hour + 1),
      });
      await admin.$executeRaw`
        INSERT INTO "action" ("id", "studentId", "runId", "key", "kind", "args", "status")
        VALUES (${actionId}, ${studentId}, ${inRun ? runId : null}, ${actionId}, 'studyBlock.create',
          ${args}::jsonb, 'done')`;
      await admin.$executeRaw`
        INSERT INTO "attempt" ("id", "studentId", "actionId", "idempotencyKey", "status", "startedAt")
        VALUES (${randomUUID()}, ${studentId}, ${actionId}, ${idempotencyKey}, 'done', ${at(0)})`;
      await admin.$executeRaw`
        INSERT INTO "study_block" ("id", "studentId", "obligationId", "placedBy", "start", "end")
        VALUES (${blockId}, ${studentId}, ${obligationId}, 'nunio', ${at(nowAt)}, ${at(nowAt + 1)})`;
      await admin.$executeRaw`
        INSERT INTO "plan_effect" ("idempotencyKey", "studentId", "studyBlockId")
        VALUES (${idempotencyKey}, ${studentId}, ${blockId})`;
      return blockId;
    }
    const unmoved = await placed(9, 9);
    // Applying a Rebalance, or a move approved in a Chat, keeps `placedBy` as nunio.
    const moved = await placed(11, 14);
    const fromChat = await placed(16, 16, { inRun: false });

    await db.applyMigration();

    const claims = Object.fromEntries(
      (
        await admin.$queryRaw<
          { id: string; createdByAgentId: string | null }[]
        >`
          SELECT "id", "createdByAgentId" FROM "study_block"
          WHERE "id" IN (${unmoved}, ${moved}, ${fromChat})`
      ).map((b) => [b.id, b.createdByAgentId]),
    );
    expect(claims).toEqual({
      [unmoved]: agentId,
      [moved]: null,
      [fromChat]: null,
    });
  });
});
