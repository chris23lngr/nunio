import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Delegation, Executor, Principal } from "@nunio/delegation";
import { createDelegation, principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import type { Facts } from "@nunio/knowledge";
import { createFacts } from "@nunio/knowledge";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPlanExecutor } from "./executor.js";
import type { Plan } from "./plan.js";
import { createPlan, planRules } from "./plan.js";

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
        createdByAgentId: null,
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

  /** A Fixed Event the student entered by hand, as the Course Event a Chat names. */
  async function event(studentId: string) {
    const id = randomUUID();
    await admin.fixedEvent.create({
      data: { id, studentId, title: "Analysis I", ...span(10) },
    });
    return id;
  }
  const followUp = (courseId: string, fixedEventId: string) => ({
    kind: "task.create" as const,
    title: "VL 3 nacharbeiten",
    courseId,
    fixedEventId,
    role: "follow_up" as const,
    estimateMinutes: 60,
  });

  it("adds no second Follow-up for a Course Event that has one, taking the existing Task as its effect", async () => {
    const s = await student();
    const { courseId } = await admin.obligation.findUniqueOrThrow({
      where: { id: s.obligationId },
    });
    const fixedEventId = await event(s.studentId);
    const first = await executor.execute(
      {
        studentId: s.studentId,
        actionId: "action-1",
        intent: followUp(courseId, fixedEventId),
      },
      { idempotencyKey: "action-1:1", signal },
    );
    if (first.status !== "done") throw new Error(first.status);

    const second = await executor.execute(
      {
        studentId: s.studentId,
        actionId: "action-2",
        intent: followUp(courseId, fixedEventId),
      },
      { idempotencyKey: "action-2:1", signal },
    );

    expect(second).toEqual(first);
    expect(
      await executor.lookup("action-2:1", { studentId: s.studentId }),
    ).toEqual({ status: "found", effect: first.effect });
    expect((await plan.view(s.p)).tasks).toHaveLength(1);
  });

  it("rejects a Follow-up for a Course Event that is gone, taking no effect", async () => {
    const s = await student();
    const { courseId } = await admin.obligation.findUniqueOrThrow({
      where: { id: s.obligationId },
    });

    expect(
      await executor.execute(
        {
          studentId: s.studentId,
          actionId: "action-1",
          intent: followUp(courseId, randomUUID()),
        },
        { idempotencyKey: "action-1:1", signal },
      ),
    ).toEqual({ status: "rejected", detail: "the Course Event is gone" });
    expect((await plan.view(s.p)).tasks).toEqual([]);
  });
});

describe("an Agent's Study Block Actions through the gate", () => {
  let gate: Delegation;
  beforeAll(() => {
    gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: executor },
      planRules,
    });
  });

  /** A Run of a free-text Agent on the student's Course, with these Capabilities, and a Grant for each that holds one. */
  async function agentRun(
    s: Awaited<ReturnType<typeof student>>,
    held: Record<string, "always" | "automatic" | "ask">,
  ) {
    const { courseId } = await admin.obligation.findUniqueOrThrow({
      where: { id: s.obligationId },
    });
    await admin.course.update({
      where: { id: courseId },
      data: { status: "accepted" },
    });
    const agentId = randomUUID(),
      runId = randomUUID();
    const kinds: Record<string, string> = {
      createStudyBlocks: "studyBlock.create",
      moveOwnStudyBlocks: "studyBlock.move",
      moveStudyBlocks: "studyBlock.move",
      createTasks: "task.create",
    };
    await admin.agent.create({
      data: {
        id: agentId,
        studentId: s.studentId,
        name: "Analysis",
        budgetMicroUsd: 100_000,
        courses: { create: { courseId } },
        capabilities: {
          create: Object.entries(held).map(([capability, mode]) => ({
            capability,
            mode,
          })),
        },
      },
    });
    await admin.grant.createMany({
      data: [
        ...new Set(
          Object.entries(held)
            .filter(([, mode]) => mode !== "ask")
            .map(([id]) => kinds[id]!),
        ),
      ].map((kind) => ({
        id: randomUUID(),
        studentId: s.studentId,
        agentId,
        kind,
      })),
    });
    await admin.run.create({
      data: { id: runId, studentId: s.studentId, agentId },
    });
    let n = 0;
    const r = principal.fromRun(runId);
    return {
      /** Asks the gate for one Action of this Run, each under a new key. */
      perform: (intent: Parameters<Delegation["perform"]>[1]["intent"]) =>
        gate.perform(r, { key: `${runId}:${++n}`, intent }),
    };
  }
  const create = (s: { obligationId: string }, hour: number) => ({
    kind: "studyBlock.create" as const,
    workId: s.obligationId,
    ...span(hour),
  });
  const move = (studyBlockId: string, hour: number) => ({
    kind: "studyBlock.move" as const,
    studyBlockId,
    ...span(hour),
  });
  const own = {
    createStudyBlocks: "automatic",
    moveOwnStudyBlocks: "automatic",
    moveStudyBlocks: "ask",
  } as const;

  it("adds an Agent's Task toward an Obligation, its Estimate counting as nunio's, while a Chat's stays the student's", async () => {
    const s = await student();
    const agent = await agentRun(s, { createTasks: "automatic" });
    const task = {
      kind: "task.create" as const,
      title: "Aufgabe 2 rechnen",
      courseId: null,
      obligationId: s.obligationId,
      fixedEventId: null,
      role: null,
      estimateMinutes: 90,
    };

    const done = await agent.perform(task);
    if (done.status !== "done") throw new Error(done.status);
    const asked = await gate.perform(s.p, {
      key: "chat-1:message-1:0",
      intent: { ...task, title: "Aufgabe 3 rechnen" },
    });
    if (asked.status !== "awaiting_approval") throw new Error(asked.status);
    await gate.decide(s.p, {
      kind: "approve",
      actionId: asked.actionId,
      fingerprint: asked.fingerprint,
    });
    await gate.perform(s.p, {
      key: "chat-1:message-1:0",
      intent: { ...task, title: "Aufgabe 3 rechnen" },
    });

    const toward = { obligationId: s.obligationId, courseId: null };
    expect((await plan.view(s.p)).tasks).toEqual([
      expect.objectContaining({
        ...toward,
        id: (done.effect as { taskId: string }).taskId,
        title: "Aufgabe 2 rechnen",
        estimate: { minutes: 90, estimatedBy: "nunio", rationale: null },
      }),
      expect.objectContaining({
        ...toward,
        title: "Aufgabe 3 rechnen",
        estimate: { minutes: 90, estimatedBy: "student", rationale: null },
      }),
    ]);
  });

  it("lets an Agent move the block it created, until the student moves it", async () => {
    const s = await student();
    const agent = await agentRun(s, own);

    const created = await agent.perform(create(s, 9));
    if (created.status !== "done") throw new Error(created.status);
    const { studyBlockId } = created.effect as { studyBlockId: string };
    expect(await agent.perform(move(studyBlockId, 11))).toMatchObject({
      status: "done",
    });
    await plan.moveBlock(s.p, studyBlockId, span(13));

    expect(await agent.perform(move(studyBlockId, 15))).toMatchObject({
      status: "awaiting_approval",
    });
  });

  it("counts a block created after an Approval as the Agent's own", async () => {
    const s = await student();
    const agent = await agentRun(s, { ...own, createStudyBlocks: "ask" });
    const asked = await agent.perform(create(s, 9));
    if (asked.status !== "awaiting_approval") throw new Error(asked.status);
    await gate.decide(s.p, {
      kind: "approve",
      actionId: asked.actionId,
      fingerprint: asked.fingerprint,
    });
    const [record] = await gate.history(s.p, { ids: [asked.actionId] });
    const created = await gate.perform(principal.fromRun(record!.runId!), {
      key: record!.key,
      intent: record!.intent,
    });
    if (created.status !== "done") throw new Error(created.status);

    expect(
      await agent.perform(
        move((created.effect as { studyBlockId: string }).studyBlockId, 11),
      ),
    ).toMatchObject({ status: "done" });
  });

  it("no longer counts a block as the Agent's own once the student moved it through a Chat", async () => {
    const s = await student();
    const agent = await agentRun(s, own);
    const created = await agent.perform(create(s, 9));
    if (created.status !== "done") throw new Error(created.status);
    const { studyBlockId } = created.effect as { studyBlockId: string };
    const key = "chat-1:message-1:0";
    const asked = await gate.perform(s.p, {
      key,
      intent: move(studyBlockId, 11),
    });
    if (asked.status !== "awaiting_approval") throw new Error(asked.status);
    await gate.decide(s.p, {
      kind: "approve",
      actionId: asked.actionId,
      fingerprint: asked.fingerprint,
    });
    expect(
      await gate.perform(s.p, { key, intent: move(studyBlockId, 11) }),
    ).toMatchObject({ status: "done" });

    expect(await agent.perform(move(studyBlockId, 15))).toMatchObject({
      status: "awaiting_approval",
    });
  });

  it("refuses, on any mode, what plan.check refuses: the past and overlaps", async () => {
    const s = await student();
    const agent = await agentRun(s, { ...own, createStudyBlocks: "always" });
    await admin.fixedEvent.create({
      data: {
        id: randomUUID(),
        studentId: s.studentId,
        title: "Analysis I",
        ...span(12),
      },
    });
    const created = await agent.perform(create(s, 9));
    if (created.status !== "done") throw new Error(created.status);

    expect(
      await agent.perform({
        ...create(s, 9),
        start: new Date("2026-11-09T06:00:00Z"),
        end: new Date("2026-11-09T07:00:00Z"),
      }),
    ).toMatchObject({ status: "refused", reason: "past" });
    expect(await agent.perform(create(s, 12))).toMatchObject({
      status: "refused",
      reason: "fixed_event",
    });
    expect(await agent.perform(create(s, 9))).toMatchObject({
      status: "refused",
      reason: "study_block",
    });
  });

  it("asks on Automatisch for a block outside the study window, and places it on Immer erlaubt with a note", async () => {
    const s = await student();
    // 03:00 in Berlin, before the default study window opens at 09:00.
    const early = create(s, 2);
    const automatic = await agentRun(s, own);
    expect(await automatic.perform(early)).toMatchObject({
      status: "awaiting_approval",
    });

    const always = await agentRun(s, { createStudyBlocks: "always" });
    const done = await always.perform(early);
    expect(done).toMatchObject({ status: "done" });
    const [record] = await gate.history(s.p, { ids: [done.actionId] });
    expect(
      record!.events.find((e) => e.type === "dispatched")?.detail,
    ).toMatchObject({ brokenPreferences: ["outside_study_window"] });
  });
});
