import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Executor, Schedules } from "./index.js";
import {
  createDelegation,
  createResponsibilities,
  principal,
} from "./index.js";

let db: TestDatabase;
/** Seeds fixtures as the migration role, outside RLS. */
let admin: PrismaClient;
/** Connects as the restricted runtime role, as the API and worker do. */
let runtime: PrismaClient;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
  runtime = createPrismaClient(createPool(db.runtimeConnectionString));
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

const now = new Date("2026-11-10T07:00:00Z");
const clock = { now: () => now };

/** Records what was asked of the Schedules, as Temporal would carry it out. */
function fakeSchedules() {
  const calls: string[] = [];
  const schedules: Schedules = {
    async create({ responsibilityId }) {
      calls.push(`create ${responsibilityId}`);
    },
    async pause(responsibilityId) {
      calls.push(`pause ${responsibilityId}`);
    },
    async unpause(responsibilityId) {
      calls.push(`unpause ${responsibilityId}`);
    },
    async delete(responsibilityId) {
      calls.push(`delete ${responsibilityId}`);
    },
  };
  return { schedules, calls };
}

const executor: Executor = {
  async execute(_, { idempotencyKey }) {
    return { status: "done", effect: { studyBlockId: idempotencyKey } };
  },
  async lookup() {
    return { status: "unknown" };
  },
};

/** A student with one Course, one Obligation in it, and one block nunio placed for it. */
async function student() {
  const studentId = randomUUID(),
    courseId = randomUUID(),
    obligationId = randomUUID(),
    blockId = randomUUID();
  await admin.user.create({
    data: {
      id: studentId,
      name: "Student",
      email: `${studentId}@example.com`,
      emailVerified: true,
    },
  });
  await admin.pilotEntitlement.create({ data: { studentId } });
  await admin.allowance.create({
    data: { studentId, limitMicroUsd: 1_000_000 },
  });
  await admin.course.create({
    data: {
      id: courseId,
      studentId,
      title: "Analysis I",
      matchTitle: "analysis i",
    },
  });
  await admin.obligation.create({
    data: {
      id: obligationId,
      studentId,
      courseId,
      matchKey: "sheet-1",
      kind: "assignment",
      enteredAt: now,
      correctedTitle: "Problem sheet 1",
    },
  });
  await admin.studyBlock.create({
    data: {
      id: blockId,
      studentId,
      obligationId,
      placedBy: "nunio",
      start: new Date("2026-11-10T09:00:00Z"),
      end: new Date("2026-11-10T10:00:00Z"),
    },
  });
  return {
    studentId,
    courseId,
    blockId,
    p: principal.fromSession({ studentId }),
  };
}

const move = (blockId: string) => ({
  kind: "studyBlock.move" as const,
  studyBlockId: blockId,
  start: new Date("2026-11-11T14:00:00Z"),
  end: new Date("2026-11-11T15:00:00Z"),
});

describe("Responsibilities", () => {
  it("lets the Runs of 'keep this course organized' act on that Course without asking", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const responsibilities = createResponsibilities({
      db: runtime,
      schedules,
      clock,
    });
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: executor },
    });

    const created = await responsibilities.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const runId = await responsibilities.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      responsibilityId: created.id,
    });
    if (!runId) throw new Error("no Run");

    expect(
      await gate.perform(principal.fromRun(runId), {
        key: `${runId}:1`,
        intent: move(s.blockId),
      }),
    ).toMatchObject({ status: "done" });
    expect(calls).toEqual([`create ${created.id}`]);
  });

  it("pauses: the Schedule pauses, no Run starts, and a Run under way takes no next Action", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const responsibilities = createResponsibilities({
      db: runtime,
      schedules,
      clock,
    });
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: executor },
    });
    const created = await responsibilities.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const runId = (await responsibilities.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      responsibilityId: created.id,
    }))!;

    expect(await responsibilities.pause(s.p, created.id)).toEqual({
      status: "ok",
    });

    expect(calls).toEqual([`create ${created.id}`, `pause ${created.id}`]);
    expect(
      await responsibilities.startRun({
        runId: randomUUID(),
        workflowId: "run-workflow",
        studentId: s.studentId,
        responsibilityId: created.id,
      }),
    ).toBeNull();
    expect(
      await gate.perform(principal.fromRun(runId), {
        key: `${runId}:1`,
        intent: move(s.blockId),
      }),
    ).toMatchObject({ status: "refused", reason: "paused" });
  });

  it("resumes only when the student says so, even after exhausting its Budget", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const responsibilities = createResponsibilities({
      db: runtime,
      schedules,
      clock,
    });
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: executor },
    });
    const created = await responsibilities.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 1_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const runId = (await responsibilities.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      responsibilityId: created.id,
    }))!;
    const call = async () => ({ value: "ok", usage: { microUsd: 1_000 } });
    await gate.meter(principal.fromRun(runId), { microUsd: 1_000 }, call);
    expect(
      await gate.meter(principal.fromRun(runId), { microUsd: 1 }, call),
    ).toEqual({ status: "refused", reason: "budget_exhausted" });
    expect(
      await responsibilities.startRun({
        runId: randomUUID(),
        workflowId: "run-workflow",
        studentId: s.studentId,
        responsibilityId: created.id,
      }),
    ).toBeNull();

    expect(await responsibilities.resume(s.p, created.id)).toEqual({
      status: "ok",
    });

    expect(calls).toEqual([`create ${created.id}`, `unpause ${created.id}`]);
    expect(
      await responsibilities.startRun({
        runId: randomUUID(),
        workflowId: "run-workflow",
        studentId: s.studentId,
        responsibilityId: created.id,
      }),
    ).toEqual(expect.any(String));
  });

  it("stops Actions even when pausing the Schedule fails", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    schedules.pause = async () => {
      throw new Error("Temporal unavailable");
    };
    const responsibilities = createResponsibilities({
      db: runtime,
      schedules,
      clock,
    });
    const created = await responsibilities.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    await expect(responsibilities.pause(s.p, created.id)).rejects.toThrow(
      "Temporal unavailable",
    );
    expect(await responsibilities.view(s.p, created.id)).toMatchObject({
      state: "paused",
    });
  });

  it("orders concurrent pause and resume with their Schedule changes", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    let started!: () => void;
    let release!: () => void;
    const pauseStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pauseReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    schedules.pause = async (id) => {
      started();
      await pauseReleased;
      calls.push(`pause ${id}`);
    };
    const responsibilities = createResponsibilities({
      db: runtime,
      schedules,
      clock,
    });
    const created = await responsibilities.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const pausing = responsibilities.pause(s.p, created.id);
    await pauseStarted;
    const resuming = responsibilities.resume(s.p, created.id);
    // Let resume reach the database while the Schedule pause is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await Promise.all([pausing, resuming]);
    expect(calls).toEqual([
      `create ${created.id}`,
      `pause ${created.id}`,
      `unpause ${created.id}`,
    ]);
    expect(await responsibilities.view(s.p, created.id)).toMatchObject({
      state: "active",
    });
  });

  it("records one Run when startup is retried, even after a Pause", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    const responsibilities = createResponsibilities({
      db: runtime,
      schedules,
      clock,
    });
    const created = await responsibilities.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const ref = {
      studentId: s.studentId,
      responsibilityId: created.id,
      runId: randomUUID(),
      workflowId: "run-workflow",
    };
    const ids = await Promise.all([
      responsibilities.startRun(ref),
      responsibilities.startRun(ref),
    ]);
    expect(ids).toEqual([ref.runId, ref.runId]);
    await responsibilities.pause(s.p, created.id);
    expect(await responsibilities.startRun(ref)).toBe(ref.runId);
    expect(
      await admin.run.count({ where: { responsibilityId: created.id } }),
    ).toBe(1);
  });

  it("does not let a Run create Grants or control Responsibilities", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const responsibilities = createResponsibilities({
      db: runtime,
      schedules,
      clock,
    });
    const input = {
      preset: "keep_course_organized" as const,
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    };
    const created = await responsibilities.create(s.p, input);
    if (created.status !== "ok") throw new Error(created.status);
    const runId = await responsibilities.startRun({
      studentId: s.studentId,
      responsibilityId: created.id,
      runId: randomUUID(),
      workflowId: "run-workflow",
    });
    if (!runId) throw new Error("no Run");
    const run = principal.fromRun(runId);
    await responsibilities.pause(s.p, created.id);
    expect(await responsibilities.create(run, input)).toEqual({
      status: "gone",
    });
    expect(await responsibilities.resume(run, created.id)).toEqual({
      status: "gone",
    });
    expect(await responsibilities.pause(run, created.id)).toEqual({
      status: "gone",
    });
    expect(await responsibilities.end(run, created.id)).toEqual({
      status: "gone",
    });
    expect(await responsibilities.view(s.p, created.id)).toMatchObject({
      state: "paused",
    });
    expect(calls).toEqual([`create ${created.id}`, `pause ${created.id}`]);
  });

  it("ends for good: its Grants and Schedule are gone, its history remains", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const responsibilities = createResponsibilities({
      db: runtime,
      schedules,
      clock,
    });
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: executor },
    });
    const created = await responsibilities.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const runId = (await responsibilities.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      responsibilityId: created.id,
    }))!;
    await gate.perform(principal.fromRun(runId), {
      key: `${runId}:1`,
      intent: move(s.blockId),
    });

    expect(await responsibilities.end(s.p, created.id)).toEqual({
      status: "ok",
    });

    expect(calls).toEqual([`create ${created.id}`, `delete ${created.id}`]);
    expect(await responsibilities.resume(s.p, created.id)).toEqual({
      status: "gone",
    });
    expect(await responsibilities.view(s.p, created.id)).toMatchObject({
      state: "ended",
      grants: [],
    });
    expect(
      await gate.history(s.p, { responsibilityId: created.id }),
    ).toMatchObject([{ status: "done" }]);
  });

  it("never delegates, or controls, another student's Course or Responsibility", async () => {
    const s = await student();
    const other = await student();
    const { schedules, calls } = fakeSchedules();
    const responsibilities = createResponsibilities({
      db: runtime,
      schedules,
      clock,
    });
    const theirs = await responsibilities.create(other.p, {
      preset: "keep_course_organized",
      courseId: other.courseId,
      budgetMicroUsd: 50_000,
    });
    if (theirs.status !== "ok") throw new Error(theirs.status);

    expect(
      await responsibilities.create(s.p, {
        preset: "keep_course_organized",
        courseId: other.courseId,
        budgetMicroUsd: 50_000,
      }),
    ).toEqual({ status: "gone" });
    expect(await responsibilities.pause(s.p, theirs.id)).toEqual({
      status: "gone",
    });
    expect(await responsibilities.resume(s.p, theirs.id)).toEqual({
      status: "gone",
    });
    expect(await responsibilities.end(s.p, theirs.id)).toEqual({
      status: "gone",
    });
    expect(await responsibilities.view(s.p, theirs.id)).toBeNull();
    expect(calls).toEqual([`create ${theirs.id}`]);
  });
});

/** An exam in the student's Course, with one block nunio placed for it. */
async function exam(s: Awaited<ReturnType<typeof student>>) {
  const examId = randomUUID(),
    examBlockId = randomUUID();
  await admin.obligation.create({
    data: {
      id: examId,
      studentId: s.studentId,
      courseId: s.courseId,
      matchKey: "exam",
      kind: "exam",
      enteredAt: now,
      correctedTitle: "Klausur",
    },
  });
  await admin.studyBlock.create({
    data: {
      id: examBlockId,
      studentId: s.studentId,
      obligationId: examId,
      placedBy: "nunio",
      start: new Date("2026-11-10T11:00:00Z"),
      end: new Date("2026-11-10T12:00:00Z"),
    },
  });
  return { examId, examBlockId };
}

describe("'prepare me for this exam'", () => {
  it("lets its Runs act on that exam's blocks without asking, and asks for any other work in the Course", async () => {
    const s = await student();
    const { examId, examBlockId } = await exam(s);
    const responsibilities = createResponsibilities({
      db: runtime,
      schedules: fakeSchedules().schedules,
      clock,
    });
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: executor },
    });

    const created = await responsibilities.create(s.p, {
      preset: "prepare_for_exam",
      obligationId: examId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const runId = (await responsibilities.startRun({
      studentId: s.studentId,
      responsibilityId: created.id,
      runId: randomUUID(),
      workflowId: "run-workflow",
    }))!;

    expect(
      await gate.perform(principal.fromRun(runId), {
        key: `${runId}:1`,
        intent: move(examBlockId),
      }),
    ).toMatchObject({ status: "done" });
    expect(
      await gate.perform(principal.fromRun(runId), {
        key: `${runId}:2`,
        intent: move(s.blockId),
      }),
    ).toMatchObject({ status: "awaiting_approval" });
    expect(await responsibilities.view(s.p, created.id)).toMatchObject({
      preset: "prepare_for_exam",
      scope: { courseId: s.courseId, obligationId: examId },
      grants: [
        { kind: "studyBlock.create", obligationId: examId },
        { kind: "studyBlock.move", obligationId: examId },
      ],
    });
  });

  it("is only for an exam of the student's own", async () => {
    const s = await student();
    const other = await student();
    const { examId: theirExam } = await exam(other);
    const { schedules, calls } = fakeSchedules();
    const responsibilities = createResponsibilities({
      db: runtime,
      schedules,
      clock,
    });
    const assignment = (
      await admin.obligation.findFirstOrThrow({
        where: { studentId: s.studentId, kind: "assignment" },
      })
    ).id;

    expect(
      await responsibilities.create(s.p, {
        preset: "prepare_for_exam",
        obligationId: assignment,
        budgetMicroUsd: 50_000,
      }),
    ).toEqual({ status: "gone" });
    expect(
      await responsibilities.create(s.p, {
        preset: "prepare_for_exam",
        obligationId: theirExam,
        budgetMicroUsd: 50_000,
      }),
    ).toEqual({ status: "gone" });
    expect(calls).toEqual([]);
  });
});
