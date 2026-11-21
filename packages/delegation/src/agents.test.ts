import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Executor, Schedules } from "./index.js";
import { createAgents, createDelegation, principal } from "./index.js";

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
    async create({ agentId }) {
      calls.push(`create ${agentId}`);
    },
    async save({ agentId, trigger, timeZone, paused }) {
      calls.push(
        `save ${agentId} ${JSON.stringify(trigger)} ${timeZone}${paused ? " paused" : ""}`,
      );
    },
    async pause(agentId) {
      calls.push(`pause ${agentId}`);
    },
    async unpause(agentId) {
      calls.push(`unpause ${agentId}`);
    },
    async delete(agentId) {
      calls.push(`delete ${agentId}`);
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

describe("Agents", () => {
  it("lets the Runs of 'keep this course organized' act on that Course without asking", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({
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

    const created = await agents.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const runId = await agents.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      agentId: created.id,
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
    const agents = createAgents({
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
    const created = await agents.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const runId = (await agents.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      agentId: created.id,
    }))!;

    // A preset's Runs record no status, so none is under way to stop.
    expect(await agents.pause(s.p, created.id)).toEqual({
      status: "ok",
      runs: [],
    });

    expect(calls).toEqual([`create ${created.id}`, `pause ${created.id}`]);
    expect(
      await agents.startRun({
        runId: randomUUID(),
        workflowId: "run-workflow",
        studentId: s.studentId,
        agentId: created.id,
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
    const agents = createAgents({
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
    const created = await agents.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 1_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const runId = (await agents.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      agentId: created.id,
    }))!;
    const call = async () => ({ value: "ok", usage: { microUsd: 1_000 } });
    await gate.meter(principal.fromRun(runId), { microUsd: 1_000 }, call);
    expect(
      await gate.meter(principal.fromRun(runId), { microUsd: 1 }, call),
    ).toEqual({ status: "refused", reason: "budget_exhausted" });
    expect(
      await agents.startRun({
        runId: randomUUID(),
        workflowId: "run-workflow",
        studentId: s.studentId,
        agentId: created.id,
      }),
    ).toBeNull();

    expect(await agents.resume(s.p, created.id)).toEqual({
      status: "ok",
    });

    expect(calls).toEqual([`create ${created.id}`, `unpause ${created.id}`]);
    expect(
      await agents.startRun({
        runId: randomUUID(),
        workflowId: "run-workflow",
        studentId: s.studentId,
        agentId: created.id,
      }),
    ).toEqual(expect.any(String));
  });

  it("stops Actions even when pausing the Schedule fails", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    schedules.pause = async () => {
      throw new Error("Temporal unavailable");
    };
    const agents = createAgents({
      db: runtime,
      schedules,
      clock,
    });
    const created = await agents.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    await expect(agents.pause(s.p, created.id)).rejects.toThrow(
      "Temporal unavailable",
    );
    expect(await agents.view(s.p, created.id)).toMatchObject({
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
    const agents = createAgents({
      db: runtime,
      schedules,
      clock,
    });
    const created = await agents.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const pausing = agents.pause(s.p, created.id);
    await pauseStarted;
    const resuming = agents.resume(s.p, created.id);
    // Let resume reach the database while the Schedule pause is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await Promise.all([pausing, resuming]);
    expect(calls).toEqual([
      `create ${created.id}`,
      `pause ${created.id}`,
      `unpause ${created.id}`,
    ]);
    expect(await agents.view(s.p, created.id)).toMatchObject({
      state: "active",
    });
  });

  it("records one Run when startup is retried, even after a Pause", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    const agents = createAgents({
      db: runtime,
      schedules,
      clock,
    });
    const created = await agents.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const ref = {
      studentId: s.studentId,
      agentId: created.id,
      runId: randomUUID(),
      workflowId: "run-workflow",
    };
    const ids = await Promise.all([agents.startRun(ref), agents.startRun(ref)]);
    expect(ids).toEqual([ref.runId, ref.runId]);
    await agents.pause(s.p, created.id);
    expect(await agents.startRun(ref)).toBe(ref.runId);
    expect(await admin.run.count({ where: { agentId: created.id } })).toBe(1);
  });

  it("does not let a Run create Grants or control Agents", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({
      db: runtime,
      schedules,
      clock,
    });
    const input = {
      preset: "keep_course_organized" as const,
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    };
    const created = await agents.create(s.p, input);
    if (created.status !== "ok") throw new Error(created.status);
    const runId = await agents.startRun({
      studentId: s.studentId,
      agentId: created.id,
      runId: randomUUID(),
      workflowId: "run-workflow",
    });
    if (!runId) throw new Error("no Run");
    const run = principal.fromRun(runId);
    await agents.pause(s.p, created.id);
    expect(await agents.create(run, input)).toEqual({
      status: "gone",
    });
    expect(await agents.resume(run, created.id)).toEqual({
      status: "gone",
    });
    expect(await agents.pause(run, created.id)).toEqual({
      status: "gone",
    });
    expect(await agents.end(run, created.id)).toEqual({
      status: "gone",
    });
    expect(await agents.view(s.p, created.id)).toMatchObject({
      state: "paused",
    });
    expect(calls).toEqual([`create ${created.id}`, `pause ${created.id}`]);
  });

  it("ends for good: its Grants and Schedule are gone, its history remains", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({
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
    const created = await agents.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const runId = (await agents.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      agentId: created.id,
    }))!;
    await gate.perform(principal.fromRun(runId), {
      key: `${runId}:1`,
      intent: move(s.blockId),
    });

    // A preset's Runs record no status, so none is under way to stop.
    expect(await agents.end(s.p, created.id)).toEqual({
      status: "ok",
      runs: [],
    });

    expect(calls).toEqual([`create ${created.id}`, `delete ${created.id}`]);
    expect(await agents.resume(s.p, created.id)).toEqual({
      status: "gone",
    });
    expect(await agents.view(s.p, created.id)).toMatchObject({
      state: "ended",
      grants: [],
    });
    expect(await gate.history(s.p, { agentId: created.id })).toMatchObject([
      { status: "done" },
    ]);
  });

  it("never delegates, or controls, another student's Course or Agent", async () => {
    const s = await student();
    const other = await student();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({
      db: runtime,
      schedules,
      clock,
    });
    const theirs = await agents.create(other.p, {
      preset: "keep_course_organized",
      courseId: other.courseId,
      budgetMicroUsd: 50_000,
    });
    if (theirs.status !== "ok") throw new Error(theirs.status);

    expect(
      await agents.create(s.p, {
        preset: "keep_course_organized",
        courseId: other.courseId,
        budgetMicroUsd: 50_000,
      }),
    ).toEqual({ status: "gone" });
    expect(await agents.pause(s.p, theirs.id)).toEqual({
      status: "gone",
    });
    expect(await agents.resume(s.p, theirs.id)).toEqual({
      status: "gone",
    });
    expect(await agents.end(s.p, theirs.id)).toEqual({
      status: "gone",
    });
    expect(await agents.view(s.p, theirs.id)).toBeNull();
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
    const agents = createAgents({
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

    const created = await agents.create(s.p, {
      preset: "prepare_for_exam",
      obligationId: examId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    const runId = (await agents.startRun({
      studentId: s.studentId,
      agentId: created.id,
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
    expect(await agents.view(s.p, created.id)).toMatchObject({
      preset: "prepare_for_exam",
      scope: { obligationId: examId },
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
    const agents = createAgents({
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
      await agents.create(s.p, {
        preset: "prepare_for_exam",
        obligationId: assignment,
        budgetMicroUsd: 50_000,
      }),
    ).toEqual({ status: "gone" });
    expect(
      await agents.create(s.p, {
        preset: "prepare_for_exam",
        obligationId: theirExam,
        budgetMicroUsd: 50_000,
      }),
    ).toEqual({ status: "gone" });
    expect(calls).toEqual([]);
  });

  it("refuses an exam the student rejected, or one in a Course they merged away or rejected", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({
      db: runtime,
      schedules,
      clock,
    });
    const prepare = (obligationId: string) =>
      agents.create(s.p, {
        preset: "prepare_for_exam",
        obligationId,
        budgetMicroUsd: 50_000,
      });
    const { examId: rejected } = await exam(s);
    await admin.obligation.update({
      where: { id: rejected },
      data: { state: "rejected" },
    });
    const inCourse = async (status: "merged" | "rejected") => {
      const courseId = randomUUID(),
        examId = randomUUID();
      await admin.course.create({
        data: {
          id: courseId,
          studentId: s.studentId,
          title: `Course ${status}`,
          matchTitle: status,
          semester: "2026-ws",
          color: "rose",
          status,
        },
      });
      await admin.obligation.create({
        data: {
          id: examId,
          studentId: s.studentId,
          courseId,
          matchKey: `exam-${status}`,
          kind: "exam",
          enteredAt: now,
          correctedTitle: "Klausur",
        },
      });
      return examId;
    };

    expect(await prepare(rejected)).toEqual({ status: "gone" });
    expect(await prepare(await inCourse("merged"))).toEqual({ status: "gone" });
    expect(await prepare(await inCourse("rejected"))).toEqual({
      status: "gone",
    });
    expect(calls).toEqual([]);
  });

  it("gives each Run its Agent's scope, exactly as its proposals take it", async () => {
    const s = await student();
    const { examId } = await exam(s);
    const agents = createAgents({
      db: runtime,
      schedules: fakeSchedules().schedules,
      clock,
    });
    const runOf = async (input: Parameters<typeof agents.create>[1]) => {
      const created = await agents.create(s.p, input);
      if (created.status !== "ok") throw new Error(created.status);
      return (await agents.startRun({
        studentId: s.studentId,
        agentId: created.id,
        runId: randomUUID(),
        workflowId: "run-workflow",
      }))!;
    };

    expect(
      await agents.scopeOfRun(
        await runOf({
          preset: "prepare_for_exam",
          obligationId: examId,
          budgetMicroUsd: 1,
        }),
      ),
    ).toEqual({ obligationId: examId });
    expect(
      await agents.scopeOfRun(
        await runOf({
          preset: "keep_course_organized",
          courseId: s.courseId,
          budgetMicroUsd: 1,
        }),
      ),
    ).toEqual({ courseId: s.courseId });
  });
});

describe("a Run the student started", () => {
  it("has no Grants, so its Actions ask first, and is recorded once however often it is started", async () => {
    const s = await student();
    const chatId = randomUUID();
    await admin.chat.create({ data: { id: chatId, studentId: s.studentId } });
    const agents = createAgents({ db: runtime, clock });
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: executor },
    });
    const run = { runId: randomUUID(), workflowId: "artifact-run", chatId };

    expect(
      await Promise.all([
        agents.startStudentRun(s.p, run),
        agents.startStudentRun(s.p, run),
      ]),
    ).toEqual([{ status: "ok" }, { status: "ok" }]);
    expect(await admin.run.findMany({ where: { id: run.runId } })).toEqual([
      expect.objectContaining({ agentId: null, chatId }),
    ]);
    expect(await agents.scopeOfRun(run.runId)).toBeNull();
    expect(
      await gate.perform(principal.fromRun(run.runId), {
        key: `${run.runId}:1`,
        intent: move(s.blockId),
      }),
    ).toMatchObject({ status: "awaiting_approval" });
  });

  it("never starts from another student's Chat, or reuses a Run started otherwise", async () => {
    const s = await student();
    const other = await student();
    const foreignChat = randomUUID();
    await admin.chat.create({
      data: { id: foreignChat, studentId: other.studentId },
    });
    const agents = createAgents({ db: runtime, clock });
    const runId = randomUUID();

    expect(
      await agents.startStudentRun(s.p, {
        runId,
        workflowId: "artifact-run",
        chatId: foreignChat,
      }),
    ).toEqual({ status: "gone" });
    expect(await admin.run.count({ where: { id: runId } })).toBe(0);
    await agents.startStudentRun(s.p, {
      runId,
      workflowId: "artifact-run",
    });
    expect(
      await agents.startStudentRun(other.p, {
        runId,
        workflowId: "artifact-run",
      }),
    ).toEqual({ status: "gone" });
    await expect(
      agents.startStudentRun(principal.fromRun(runId), {
        runId: randomUUID(),
        workflowId: "artifact-run",
      }),
    ).rejects.toThrow();
  });
});

describe("Agents on an Archived Course", () => {
  it("refuses to start one on an Archived Course, or to resume one while its Course is Archived", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    const agents = createAgents({
      db: runtime,
      schedules,
      clock,
    });
    const created = await agents.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (created.status !== "ok") throw new Error(created.status);
    // Archived as the Course overview would leave it.
    await admin.course.update({
      where: { id: s.courseId },
      data: { archivedAt: now },
    });
    await agents.pauseForCourse(s.p, s.courseId);

    expect(
      await agents.create(s.p, {
        preset: "keep_course_organized",
        courseId: s.courseId,
        budgetMicroUsd: 50_000,
      }),
    ).toEqual({ status: "course_archived" });
    expect(await agents.resume(s.p, created.id)).toEqual({
      status: "course_archived",
    });

    await admin.course.update({
      where: { id: s.courseId },
      data: { archivedAt: null },
    });
    expect(await agents.resume(s.p, created.id)).toEqual({
      status: "ok",
    });
  });
});

describe("a free-text Agent's Schedule", () => {
  /** A student whose one Course an Agent can be given, in their Plan's time zone. */
  async function withAcceptedCourse(timeZone = "Europe/Vienna") {
    const s = await student();
    await admin.course.update({
      where: { id: s.courseId },
      data: { status: "accepted" },
    });
    await admin.planPreference.create({
      data: { studentId: s.studentId, timeZone },
    });
    return s;
  }
  const form = (courseId: string, trigger: unknown) => ({
    name: "Klausur Analysis",
    description: "",
    emoji: "🤖",
    instructions: "Plane meine Klausurvorbereitung.",
    courseIds: [courseId],
    capabilities: [],
    budgetMicroUsd: 5_000_000,
    trigger: trigger as never,
    modelKey: "sonnet-5.5-reasoning-high",
  });

  it("is saved from its trigger in the Plan's time zone, updated on every save, and removed on End", async () => {
    const s = await withAcceptedCourse();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });

    const created = await agents.create(
      s.p,
      form(s.courseId, { rhythm: "daily", minute: 360 }),
    );
    if (created.status !== "ok") throw new Error(created.status);
    const id = created.id;
    expect(
      await agents.update(
        s.p,
        id,
        form(s.courseId, {
          rhythm: "weekdays",
          weekdays: [5, 1, 3],
          minute: 1170,
        }),
      ),
    ).toEqual({ status: "ok" });
    await agents.pause(s.p, id);
    await agents.resume(s.p, id);
    await agents.end(s.p, id);

    expect(calls).toEqual([
      `save ${id} {"rhythm":"daily","minute":360} Europe/Vienna`,
      `save ${id} {"rhythm":"weekdays","weekdays":[1,3,5],"minute":1170} Europe/Vienna`,
      `save ${id} {"rhythm":"weekdays","weekdays":[1,3,5],"minute":1170} Europe/Vienna paused`,
      `save ${id} {"rhythm":"weekdays","weekdays":[1,3,5],"minute":1170} Europe/Vienna`,
      `delete ${id}`,
    ]);
    expect(await agents.view(s.p, id)).toMatchObject({
      trigger: { rhythm: "weekdays", weekdays: [1, 3, 5], minute: 1170 },
    });
  });

  it("accepts only Täglich or one or more Wochentage at a minute of the day", async () => {
    const s = await withAcceptedCourse();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });

    for (const trigger of [
      { rhythm: "weekdays", weekdays: [], minute: 360 },
      { rhythm: "weekdays", weekdays: [0], minute: 360 },
      { rhythm: "weekdays", weekdays: [8], minute: 360 },
      { rhythm: "weekdays", weekdays: [1, 1], minute: 360 },
      { rhythm: "weekdays", weekdays: [1.5], minute: 360 },
      { rhythm: "daily", minute: 1440 },
      { rhythm: "daily", minute: -1 },
      { rhythm: "daily", minute: 6.5 },
      { rhythm: "daily", weekdays: [1], minute: 360 },
      { rhythm: "hourly", minute: 0 },
    ])
      expect(await agents.create(s.p, form(s.courseId, trigger))).toEqual({
        status: "invalid",
      });
    expect(calls).toEqual([]);
    expect(
      await agents.create(
        s.p,
        form(s.courseId, { rhythm: "weekdays", weekdays: [7], minute: 1439 }),
      ),
    ).toMatchObject({ status: "ok" });
  });

  it("records no Agent when its Schedule cannot be saved", async () => {
    const s = await withAcceptedCourse();
    const { schedules } = fakeSchedules();
    schedules.save = async () => {
      throw new Error("Temporal unavailable");
    };
    const agents = createAgents({ db: runtime, schedules, clock });

    await expect(
      agents.create(s.p, form(s.courseId, { rhythm: "daily", minute: 360 })),
    ).rejects.toThrow("Temporal unavailable");

    expect(await agents.list(s.p)).toEqual([]);
  });

  it("is saved for every free-text Agent not Ended, paused while it is Paused, when the worker starts", async () => {
    const s = await withAcceptedCourse("Europe/Berlin");
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const make = async (minute: number) => {
      const created = await agents.create(
        s.p,
        form(s.courseId, { rhythm: "daily", minute }),
      );
      if (created.status !== "ok") throw new Error(created.status);
      return created.id;
    };
    const active = await make(360);
    const paused = await make(420);
    const ended = await make(480);
    await agents.pause(s.p, paused);
    await agents.end(s.p, ended);
    const preset = await agents.create(s.p, {
      preset: "keep_course_organized",
      courseId: s.courseId,
      budgetMicroUsd: 50_000,
    });
    if (preset.status !== "ok") throw new Error(preset.status);
    calls.length = 0;

    await agents.saveSchedules();
    const mine = calls.filter((call) =>
      [active, paused, ended, preset.id].some((id) => call.includes(id)),
    );

    expect(mine).toEqual([
      `save ${active} {"rhythm":"daily","minute":360} Europe/Berlin`,
      `save ${paused} {"rhythm":"daily","minute":420} Europe/Berlin paused`,
    ]);
  });

  it("saves the other Agents' Schedules when one cannot be saved", async () => {
    const s = await withAcceptedCourse();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const ids: string[] = [];
    for (const minute of [360, 420]) {
      const created = await agents.create(
        s.p,
        form(s.courseId, { rhythm: "daily", minute }),
      );
      if (created.status !== "ok") throw new Error(created.status);
      ids.push(created.id);
    }
    const save = schedules.save;
    schedules.save = async (r) => {
      if (r.agentId === ids[0]) throw new Error("Temporal unavailable");
      await save(r);
    };
    calls.length = 0;

    await agents.saveSchedules();

    expect(calls.filter((call) => call.includes(ids[1]!))).toHaveLength(1);
  });
});
