import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Executor, Principal } from "@nunio/delegation";
import { principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import type { Facts } from "@nunio/knowledge";
import { createFacts } from "@nunio/knowledge";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlanExecutor } from "./executor.js";
import type { Plan } from "./plan.js";
import { createPlan } from "./plan.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
let facts: Facts;
let plan: Plan;
let executor: Executor;
const now = new Date("2026-11-09T07:00:00Z");
const clock = { now: () => now };

beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
  facts = createFacts({
    db: runtime,
    keys: createSourceKeys({
      activeVersion: "v1",
      masters: { v1: randomBytes(32) },
    }),
    clock,
  });
  plan = createPlan({ db: runtime, facts, clock });
  executor = createPlanExecutor({ db: runtime });
}, 180_000);
afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
});

/** A student with one entered Obligation. */
async function student(): Promise<{
  studentId: string;
  p: Principal;
  obligationId: string;
}> {
  const studentId = randomUUID();
  await admin.user.create({
    data: { id: studentId, email: `${studentId}@example.com`, name: "Student" },
  });
  await admin.pilotEntitlement.create({ data: { studentId } });
  const p = principal.fromSession({ studentId });
  const entered = await facts.enterObligation(p, {
    course: { title: "Analysis I", code: "MA-101" },
    kind: "assignment",
    title: "Blatt 3",
    due: { date: "2026-11-13", time: "12:00", timeZone: null },
    destination: null,
  });
  if (entered.status !== "ok") throw new Error(entered.status);
  return { studentId, p, obligationId: entered.id };
}

const signal = new AbortController().signal;
const span = (hour: number) => ({
  start: new Date(Date.UTC(2026, 10, 10, hour)),
  end: new Date(Date.UTC(2026, 10, 10, hour + 1)),
});

describe("the Plan executor", () => {
  it("creates one Study Block nunio placed, however often the same key is executed", async () => {
    const s = await student();
    const intent = {
      kind: "studyBlock.create" as const,
      workId: s.obligationId,
      ...span(9),
    };

    const first = await executor.execute(
      { studentId: s.studentId, actionId: "action-1", intent },
      { idempotencyKey: "action-1:1", signal },
    );
    const again = await executor.execute(
      { studentId: s.studentId, actionId: "action-1", intent },
      { idempotencyKey: "action-1:1", signal },
    );

    expect(again).toEqual(first);
    expect((await plan.view(s.p)).studyBlocks).toEqual([
      {
        id: expect.any(String),
        work: { kind: "obligation", id: s.obligationId },
        ...span(9),
        placedBy: "nunio",
        locked: false,
      },
    ]);
  });

  it("creates a block for a Task", async () => {
    const s = await student();
    const task = await plan.addTask(s.p, {
      title: "Questions 1-4",
      obligationId: s.obligationId,
    });
    if (task.status !== "ok") throw new Error(task.status);
    const intent = {
      kind: "studyBlock.create" as const,
      workId: task.id,
      ...span(9),
    };

    await executor.execute(
      { studentId: s.studentId, actionId: "action-1", intent },
      { idempotencyKey: "action-1:1", signal },
    );

    expect((await plan.view(s.p)).studyBlocks).toMatchObject([
      { work: { kind: "task", id: task.id } },
    ]);
  });

  it("rejects a block for work that no longer exists, taking no effect", async () => {
    const s = await student();
    const intent = {
      kind: "studyBlock.create" as const,
      workId: randomUUID(),
      ...span(9),
    };

    expect(
      await executor.execute(
        { studentId: s.studentId, actionId: "action-1", intent },
        { idempotencyKey: "action-1:1", signal },
      ),
    ).toEqual({ status: "rejected", detail: "the work is gone" });
    expect((await plan.view(s.p)).studyBlocks).toEqual([]);
  });

  it("moves a block once per key, keeping who placed it", async () => {
    const s = await student();
    const placed = await plan.placeBlock(s.p, {
      work: { kind: "obligation", id: s.obligationId },
      ...span(9),
    });
    if (placed.status !== "ok") throw new Error(placed.status);
    const intent = {
      kind: "studyBlock.move" as const,
      studyBlockId: placed.id,
      ...span(14),
    };

    const moved = await executor.execute(
      { studentId: s.studentId, actionId: "action-1", intent },
      { idempotencyKey: "action-1:1", signal },
    );
    await plan.moveBlock(s.p, placed.id, span(16));
    const again = await executor.execute(
      { studentId: s.studentId, actionId: "action-1", intent },
      { idempotencyKey: "action-1:1", signal },
    );

    expect(moved).toEqual({
      status: "done",
      effect: { studyBlockId: placed.id },
    });
    expect(again).toEqual(moved);
    expect((await plan.view(s.p)).studyBlocks).toMatchObject([
      { id: placed.id, ...span(16), placedBy: "student" },
    ]);
  });

  it("removes a block once per key", async () => {
    const s = await student();
    const placed = await plan.placeBlock(s.p, {
      work: { kind: "obligation", id: s.obligationId },
      ...span(9),
    });
    if (placed.status !== "ok") throw new Error(placed.status);
    const intent = {
      kind: "studyBlock.remove" as const,
      studyBlockId: placed.id,
      workId: s.obligationId,
      ...span(9),
    };

    const removed = await executor.execute(
      { studentId: s.studentId, actionId: "action-1", intent },
      { idempotencyKey: "action-1:1", signal },
    );
    const again = await executor.execute(
      { studentId: s.studentId, actionId: "action-1", intent },
      { idempotencyKey: "action-1:1", signal },
    );

    expect(removed).toEqual({
      status: "done",
      effect: { studyBlockId: placed.id },
    });
    expect(again).toEqual(removed);
    expect((await plan.view(s.p)).studyBlocks).toEqual([]);
  });

  it("rejects moving a block that no longer exists", async () => {
    const s = await student();
    const intent = {
      kind: "studyBlock.move" as const,
      studyBlockId: randomUUID(),
      ...span(14),
    };

    expect(
      await executor.execute(
        { studentId: s.studentId, actionId: "action-1", intent },
        { idempotencyKey: "action-1:1", signal },
      ),
    ).toEqual({ status: "rejected", detail: "the block is gone" });
  });

  it("reports a key's effect as found once taken, and absent before", async () => {
    const s = await student();
    const intent = {
      kind: "studyBlock.create" as const,
      workId: s.obligationId,
      ...span(9),
    };

    expect(
      await executor.lookup("action-1:1", { studentId: s.studentId }),
    ).toEqual({ status: "absent" });
    const done = await executor.execute(
      { studentId: s.studentId, actionId: "action-1", intent },
      { idempotencyKey: "action-1:1", signal },
    );

    if (done.status !== "done") throw new Error(done.status);
    expect(
      await executor.lookup("action-1:1", { studentId: s.studentId }),
    ).toEqual({ status: "found", effect: done.effect });
  });

  it("finds no other student's effect under the same key", async () => {
    const s = await student();
    const other = await student();
    const intent = {
      kind: "studyBlock.create" as const,
      workId: other.obligationId,
      ...span(9),
    };
    await executor.execute(
      { studentId: other.studentId, actionId: "action-1", intent },
      { idempotencyKey: "action-1:1", signal },
    );

    expect(
      await executor.lookup("action-1:1", { studentId: s.studentId }),
    ).toEqual({ status: "absent" });
  });

  it("adds one Task in a Course, however often the same key is executed, and reopens a done one", async () => {
    const s = await student();
    const { courseId } = await admin.obligation.findUniqueOrThrow({
      where: { id: s.obligationId },
    });
    const intent = {
      kind: "task.create" as const,
      title: "VL 3 nacharbeiten",
      courseId,
      fixedEventId: null,
      role: null,
      estimateMinutes: 60,
    };

    const first = await executor.execute(
      { studentId: s.studentId, actionId: "action-1", intent },
      { idempotencyKey: "action-1:1", signal },
    );
    const again = await executor.execute(
      { studentId: s.studentId, actionId: "action-1", intent },
      { idempotencyKey: "action-1:1", signal },
    );

    expect(again).toEqual(first);
    const [task] = (await plan.view(s.p)).tasks;
    expect((await plan.view(s.p)).tasks).toEqual([
      expect.objectContaining({
        title: "VL 3 nacharbeiten",
        courseId,
        estimate: { minutes: 60, estimatedBy: "student", rationale: null },
        done: false,
      }),
    ]);
    expect(first).toEqual({ status: "done", effect: { taskId: task!.id } });

    await plan.completeTask(s.p, task!.id, true);
    expect(
      await executor.execute(
        {
          studentId: s.studentId,
          actionId: "action-2",
          intent: { kind: "task.reopen", taskId: task!.id },
        },
        { idempotencyKey: "action-2:1", signal },
      ),
    ).toEqual({ status: "done", effect: { taskId: task!.id } });
    expect((await plan.view(s.p)).tasks).toEqual([
      expect.objectContaining({ id: task!.id, done: false }),
    ]);
  });
});
