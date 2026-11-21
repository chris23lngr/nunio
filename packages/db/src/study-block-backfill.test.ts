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
    "../prisma/migrations/20261129100000_study_block_created_by/migration.sql",
    import.meta.url,
  ),
  "utf8",
).split('ADD COLUMN "createdByAgentId" TEXT;')[1]!;

const at = (hour: number) => new Date(Date.UTC(2026, 10, 10, hour));

describe("the createdByAgentId backfill", () => {
  it("claims a block for the Agent that created it only while it sits where the Agent placed it", async () => {
    const studentId = randomUUID(),
      courseId = randomUUID(),
      obligationId = randomUUID(),
      agentId = randomUUID(),
      runId = randomUUID();
    await admin.user.create({
      data: {
        id: studentId,
        name: "Student",
        email: `${studentId}@example.com`,
      },
    });
    await admin.course.create({
      data: {
        id: courseId,
        studentId,
        title: "Analysis I",
        matchTitle: "analysis i",
        semester: "2026-ws",
        color: "rose",
      },
    });
    await admin.obligation.create({
      data: {
        id: obligationId,
        studentId,
        courseId,
        matchKey: "sheet-1",
        kind: "assignment",
        enteredAt: at(0),
      },
    });
    await admin.agent.create({
      data: {
        id: agentId,
        studentId,
        budgetMicroUsd: 100_000,
      },
    });
    await admin.run.create({ data: { id: runId, studentId, agentId } });
    /** A block an Action placed at `hour`, as the gate and executor record it, now at `nowAt`. */
    async function placed(hour: number, nowAt: number, { inRun = true } = {}) {
      const actionId = randomUUID(),
        blockId = randomUUID(),
        idempotencyKey = `${actionId}:1`;
      await admin.action.create({
        data: {
          id: actionId,
          studentId,
          runId: inRun ? runId : null,
          key: actionId,
          kind: "studyBlock.create",
          // As the gate stores arguments: JSON, with dates as ISO strings.
          args: JSON.parse(
            JSON.stringify({
              workId: obligationId,
              start: at(hour),
              end: at(hour + 1),
            }),
          ),
          status: "done",
        },
      });
      await admin.attempt.create({
        data: {
          id: randomUUID(),
          studentId,
          actionId,
          idempotencyKey,
          status: "done",
          startedAt: at(0),
        },
      });
      await admin.studyBlock.create({
        data: {
          id: blockId,
          studentId,
          obligationId,
          placedBy: "nunio",
          start: at(nowAt),
          end: at(nowAt + 1),
        },
      });
      await admin.planEffect.create({
        data: { idempotencyKey, studentId, studyBlockId: blockId },
      });
      return blockId;
    }
    const unmoved = await placed(9, 9);
    // Applying a Rebalance, or a move approved in a Chat, keeps `placedBy` as nunio.
    const moved = await placed(11, 14);
    const fromChat = await placed(16, 16, { inRun: false });

    await admin.$executeRawUnsafe(backfill);

    const claims = Object.fromEntries(
      (
        await admin.studyBlock.findMany({
          where: { id: { in: [unmoved, moved, fromChat] } },
        })
      ).map((b) => [b.id, b.createdByAgentId]),
    );
    expect(claims).toEqual({
      [unmoved]: agentId,
      [moved]: null,
      [fromChat]: null,
    });
  });
});
