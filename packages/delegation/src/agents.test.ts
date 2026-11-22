import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Executor, PlanRules, Schedules } from "./index.js";
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
    async save({ agentId, trigger, timeZone, paused }) {
      calls.push(
        `save ${agentId} ${JSON.stringify(trigger)} ${timeZone}${paused ? " paused" : ""}`,
      );
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

/** The Plan's rules, refusing nothing an Agent's Study Block Action does. */
const planRules: PlanRules = {
  check: async () => ({ refusals: [], brokenPreferences: [] }),
  taskDue: async () => null,
};

/** A student with one accepted Course, one Obligation in it, and one block nunio placed for it. */
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
      status: "accepted",
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
    obligationId,
    blockId,
    p: principal.fromSession({ studentId }),
  };
}

/** An Agent's form for the student's Course: creating Study Blocks on Immer erlaubt, daily at 06:00. */
const form = (courseId: string, budgetMicroUsd = 50_000) => ({
  name: "Analysis organisieren",
  description: "",
  emoji: "🤖",
  instructions: "Halte Analysis I organisiert.",
  courseIds: [courseId],
  capabilities: [{ id: "createStudyBlocks", mode: "always" }],
  budgetMicroUsd,
  trigger: { rhythm: "daily" as const, minute: 360 },
  modelKey: "sonnet-5.5-reasoning-high",
});
/** What the fake Schedules record for that form's Agent. */
const saved = (id: string, paused = false) =>
  `save ${id} {"rhythm":"daily","minute":360} Europe/Berlin${paused ? " paused" : ""}`;
/** A block for the student's Obligation, two days ahead. */
const block = (s: { obligationId: string }) => ({
  kind: "studyBlock.create" as const,
  workId: s.obligationId,
  start: new Date("2026-11-12T14:00:00Z"),
  end: new Date("2026-11-12T15:00:00Z"),
});

const move = (blockId: string) => ({
  kind: "studyBlock.move" as const,
  studyBlockId: blockId,
  start: new Date("2026-11-11T14:00:00Z"),
  end: new Date("2026-11-11T15:00:00Z"),
});

describe("Agents", () => {
  it("lets its Runs act on its Course under its Grants, without asking", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: executor },
      planRules,
    });

    const created = await agents.create(s.p, form(s.courseId));
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
        key: `${runId}:1:1`,
        intent: block(s),
      }),
    ).toMatchObject({ status: "done" });
    expect(calls).toEqual([saved(created.id)]);
  });

  it("pauses: the Schedule pauses, no Run starts, and a Run under way takes no next Action", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: executor },
      planRules,
    });
    const created = await agents.create(s.p, form(s.courseId));
    if (created.status !== "ok") throw new Error(created.status);
    const runId = (await agents.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      agentId: created.id,
    }))!;

    expect(await agents.pause(s.p, created.id)).toEqual({
      status: "ok",
      runs: [{ runId, workflowId: "run-workflow" }],
    });

    expect(calls).toEqual([saved(created.id), saved(created.id, true)]);
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
        key: `${runId}:1:1`,
        intent: block(s),
      }),
    ).toMatchObject({ status: "refused", reason: "paused" });
  });

  it("resumes only when the student says so, even after exhausting its Budget", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: executor },
    });
    const created = await agents.create(s.p, form(s.courseId, 1_000));
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
    await admin.run.update({
      where: { id: runId },
      data: { status: "stopped", endedAt: now },
    });
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

    expect(calls).toEqual([saved(created.id), saved(created.id)]);
    expect(
      await agents.startRun({
        runId: randomUUID(),
        workflowId: "run-workflow",
        studentId: s.studentId,
        agentId: created.id,
      }),
    ).toEqual(expect.any(String));
  });

  it("starts its Budget over at 00:00 on the 1st in the Plan's time zone, clearing used and keeping held, and never resumes it", async () => {
    const s = await student();
    await admin.planPreference.create({
      data: { studentId: s.studentId, timeZone: "America/New_York" },
    });
    let at = new Date("2026-11-20T12:00:00Z");
    const clock = { now: () => at };
    const agents = createAgents({
      db: runtime,
      schedules: fakeSchedules().schedules,
      clock,
    });
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
    });
    const created = await agents.create(s.p, form(s.courseId, 1_000));
    if (created.status !== "ok") throw new Error(created.status);
    const run = principal.fromRun(
      (await agents.startRun({
        runId: randomUUID(),
        workflowId: "run-workflow",
        studentId: s.studentId,
        agentId: created.id,
      }))!,
    );
    const spend = (microUsd: number) =>
      gate.meter(run, { microUsd }, async () => ({
        value: "ok",
        usage: { microUsd },
      }));
    const budget = async () => (await agents.view(s.p, created.id))!;
    await spend(600);
    // A call whose outcome is unknown keeps its estimate held.
    await expect(
      gate.meter(run, { microUsd: 400 }, async () => {
        throw new Error("timeout");
      }),
    ).rejects.toThrow("timeout");
    expect(await spend(1)).toEqual({
      status: "refused",
      reason: "budget_exhausted",
    });

    // 23:59 on 30 November in New York, though already December in UTC.
    at = new Date("2026-12-01T04:59:00Z");
    expect((await budget()).budget).toEqual({
      limitMicroUsd: 1_000,
      usedMicroUsd: 600,
      heldMicroUsd: 400,
    });

    at = new Date("2026-12-01T05:00:00Z");
    expect(await budget()).toMatchObject({
      state: "paused",
      pausedBy: "budget",
      budget: { limitMicroUsd: 1_000, usedMicroUsd: 0, heldMicroUsd: 400 },
    });
    expect(await spend(1)).toEqual({
      status: "refused",
      reason: "budget_exhausted",
    });
    expect(await agents.resume(s.p, created.id)).toEqual({ status: "ok" });
    // The held estimate still counts against the new month's Budget.
    expect(await spend(600)).toMatchObject({ status: "ok" });
    expect(await spend(1)).toEqual({
      status: "refused",
      reason: "budget_exhausted",
    });
    expect((await budget()).budget).toEqual({
      limitMicroUsd: 1_000,
      usedMicroUsd: 600,
      heldMicroUsd: 400,
    });
  });

  it("stops Actions even when pausing the Schedule fails", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const created = await agents.create(s.p, form(s.courseId));
    if (created.status !== "ok") throw new Error(created.status);
    schedules.save = async () => {
      throw new Error("Temporal unavailable");
    };
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
    const agents = createAgents({ db: runtime, schedules, clock });
    const created = await agents.create(s.p, form(s.courseId));
    if (created.status !== "ok") throw new Error(created.status);
    let started!: () => void;
    let release!: () => void;
    const pauseStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pauseReleased = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = schedules.save;
    schedules.save = async (r) => {
      if (r.paused) {
        started();
        await pauseReleased;
      }
      await save(r);
    };
    const pausing = agents.pause(s.p, created.id);
    await pauseStarted;
    const resuming = agents.resume(s.p, created.id);
    // Let resume reach the database while the Schedule pause is still in flight.
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await Promise.all([pausing, resuming]);
    expect(calls).toEqual([
      saved(created.id),
      saved(created.id, true),
      saved(created.id),
    ]);
    expect(await agents.view(s.p, created.id)).toMatchObject({
      state: "active",
    });
  });

  it("records one Run when startup is retried, even after a Pause", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const created = await agents.create(s.p, form(s.courseId));
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

  it.each([
    ["pause", "before"],
    ["pause", "while"],
    ["end", "before"],
    ["end", "while"],
  ] as const)(
    "%ss without deadlocking a Run that retries the Approval it asked %s the Agent was locked (#226)",
    async (control, asked) => {
      const s = await student();
      const { schedules } = fakeSchedules();
      const agents = createAgents({ db: runtime, schedules, clock });
      const gate = createDelegation({
        db: runtime,
        aiEnabled: () => true,
        clock,
        executors: { plan: executor },
        planRules,
      });
      const created = await agents.create(s.p, form(s.courseId));
      if (created.status !== "ok") throw new Error(created.status);
      const runId = (await agents.startRun({
        runId: randomUUID(),
        workflowId: "run-workflow",
        studentId: s.studentId,
        agentId: created.id,
      }))!;
      const key = `${runId}:1:1`;
      /** Commits an open Approval the Run asked under `key`, as an earlier call of it does. */
      const ask = async () => {
        const { start, end } = block(s);
        await admin.action.create({
          data: {
            id: randomUUID(),
            studentId: s.studentId,
            runId,
            key,
            kind: "studyBlock.create",
            args: {
              workId: s.obligationId,
              start: start.toISOString(),
              end: end.toISOString(),
            },
            status: "awaiting_approval",
            approval: {
              create: {
                id: randomUUID(),
                fingerprint: "shown",
                expiresAt: new Date(now.getTime() + 60 * 60_000),
              },
            },
          },
        });
      };
      /** How many backends of this database wait on a lock. */
      const waiting = async () => {
        const [row] = await admin.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0`;
        return row!.n;
      };
      let markLocked!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => {
        markLocked = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (asked === "before") await ask();
      // Another call of the Run holds the Agent's lock while it decides.
      const holder = admin.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${created.id} FOR UPDATE`;
          markLocked();
          await released;
        },
        { timeout: 15_000 },
      );
      await locked;
      const retry = () =>
        gate.perform(principal.fromRun(runId), { key, intent: block(s) });
      let stopping: Promise<unknown> | undefined;
      let performing: Promise<unknown> | undefined;
      try {
        // Both queue on the Agent's lock: the retry first when the Approval was asked before, else the Pause or End.
        if (asked === "before") {
          performing = retry();
          await expect.poll(waiting).toBe(1);
          stopping = agents[control](s.p, created.id);
        } else {
          stopping = agents[control](s.p, created.id);
          await expect.poll(waiting).toBe(1);
          await ask();
          performing = retry();
        }
        await expect.poll(waiting).toBe(2);
      } finally {
        release();
        await holder;
      }

      const [stopped, performed] = await Promise.allSettled([
        stopping,
        performing,
      ]);
      expect(stopped).toEqual({
        status: "fulfilled",
        value: { status: "ok", runs: [{ runId, workflowId: "run-workflow" }] },
      });
      // The retry first finds the Approval still open; after the Pause or End, withdrawn. Either way it ends withdrawn.
      expect(performed).toMatchObject({
        status: "fulfilled",
        value:
          asked === "before"
            ? { status: "awaiting_approval" }
            : { status: "refused", reason: "approval_withdrawn" },
      });
      expect(await gate.history(s.p, { keys: [key] })).toMatchObject([
        { status: "refused", refusal: "approval_withdrawn" },
      ]);
    },
  );

  it("does not let a Run create Grants or control Agents", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const input = form(s.courseId);
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
    expect(calls).toEqual([saved(created.id), saved(created.id, true)]);
  });

  it("ends for good: its Grants and Schedule are gone, its history remains", async () => {
    const s = await student();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: executor },
      planRules,
    });
    const created = await agents.create(s.p, form(s.courseId));
    if (created.status !== "ok") throw new Error(created.status);
    const runId = (await agents.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      agentId: created.id,
    }))!;
    await gate.perform(principal.fromRun(runId), {
      key: `${runId}:1:1`,
      intent: block(s),
    });

    expect(await agents.end(s.p, created.id)).toEqual({
      status: "ok",
      runs: [{ runId, workflowId: "run-workflow" }],
    });

    expect(calls).toEqual([saved(created.id), `delete ${created.id}`]);
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

  it("never takes, or controls, another student's Course or Agent", async () => {
    const s = await student();
    const other = await student();
    const { schedules, calls } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const theirs = await agents.create(other.p, form(other.courseId));
    if (theirs.status !== "ok") throw new Error(theirs.status);

    expect(await agents.create(s.p, form(other.courseId))).toEqual({
      status: "gone",
    });
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
    expect(calls).toEqual([saved(theirs.id)]);
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
  it("refuses to start one on an Archived Course, or to resume one while all its Courses are Archived", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const created = await agents.create(s.p, form(s.courseId));
    if (created.status !== "ok") throw new Error(created.status);
    // Archived as the Course overview would leave it.
    await admin.course.update({
      where: { id: s.courseId },
      data: { archivedAt: now },
    });
    await agents.pauseForCourse(s.p, s.courseId);

    expect(await agents.create(s.p, form(s.courseId))).toEqual({
      status: "course_archived",
    });
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

describe("an Agent losing or getting back its Courses", () => {
  /** Another accepted Course of the student's. */
  async function course(studentId: string, title = "Lineare Algebra") {
    const id = randomUUID();
    await admin.course.create({
      data: {
        id,
        studentId,
        title,
        matchTitle: title.toLowerCase(),
        semester: "2026-ws",
        color: "sky",
        status: "accepted",
      },
    });
    return id;
  }
  const reason = async (
    agents: ReturnType<typeof createAgents>,
    p: ReturnType<typeof principal.fromSession>,
    id: string,
  ) => [
    (await agents.view(p, id))?.pausedBy,
    (await agents.list(p)).find((r) => r.id === id)?.pausedBy,
  ];

  it("reads why Fortsetzen is refused while it has no Course, and what paused it once it has one again", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const created = await agents.create(s.p, form(s.courseId));
    if (created.status !== "ok") throw new Error(created.status);
    await agents.pause(s.p, created.id);

    await agents.dropCourse(s.p, s.courseId);
    expect(await reason(agents, s.p, created.id)).toEqual([
      "no_course",
      "no_course",
    ]);
    expect(await agents.resume(s.p, created.id)).toEqual({
      status: "no_course",
    });

    const other = await course(s.studentId);
    expect(await agents.update(s.p, created.id, form(other))).toEqual({
      status: "ok",
    });
    expect(await reason(agents, s.p, created.id)).toEqual([
      "student",
      "student",
    ]);
  });

  it("reads Paused with no reason once a Course paused it no longer holds, and resumes", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const created = await agents.create(s.p, form(s.courseId));
    if (created.status !== "ok") throw new Error(created.status);
    await agents.dropCourse(s.p, s.courseId);
    expect(await reason(agents, s.p, created.id)).toEqual([
      "no_course",
      "no_course",
    ]);

    const other = await course(s.studentId);
    await agents.update(s.p, created.id, form(other));
    expect(await reason(agents, s.p, created.id)).toEqual([null, null]);
    expect(await agents.resume(s.p, created.id)).toEqual({ status: "ok" });
  });

  it("resumes on its Courses as committed, never on one leaving it meanwhile", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const created = await agents.create(s.p, form(s.courseId));
    if (created.status !== "ok") throw new Error(created.status);
    await agents.pause(s.p, created.id);
    let resuming!: Promise<unknown>;
    // The Course leaves it in a transaction still open as the student resumes.
    await admin.$transaction(async (tx) => {
      await tx.agentCourse.deleteMany({ where: { agentId: created.id } });
      resuming = agents.resume(s.p, created.id);
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(await resuming).toEqual({ status: "no_course" });
  });

  it("keeps a save that stands when its Agents cannot be brought in line with their Courses after it", async () => {
    const s = await student();
    const { schedules } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });
    const created = await agents.create(s.p, form(s.courseId));
    if (created.status !== "ok") throw new Error(created.status);
    await admin.course.update({
      where: { id: s.courseId },
      data: { archivedAt: now },
    });
    // Pausing its Schedule fails, as after the save it has no Course left to act for.
    schedules.save = async ({ paused }) => {
      if (paused) throw new Error("Temporal is down");
    };

    expect(
      await agents.update(s.p, created.id, {
        ...form(s.courseId),
        name: "Umbenannt",
      }),
    ).toEqual({ status: "ok" });
    expect(await agents.view(s.p, created.id)).toMatchObject({
      name: "Umbenannt",
      state: "paused",
      pausedBy: "course_archived",
    });
  });
});

describe("an Agent's Schedule", () => {
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

  it("is saved for every Agent not Ended, paused while it is Paused, when the worker starts", async () => {
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
    calls.length = 0;

    const ids = await agents.saveSchedules();
    const mine = calls.filter((call) =>
      [active, paused, ended].some((id) => call.includes(id)),
    );

    expect(mine).toEqual([
      `save ${active} {"rhythm":"daily","minute":360} Europe/Berlin`,
      `save ${paused} {"rhythm":"daily","minute":420} Europe/Berlin paused`,
    ]);
    // So the worker keeps their Schedules and deletes the rest.
    expect(ids).toEqual(expect.arrayContaining([active, paused]));
    expect(ids).not.toContain(ended);
  });

  /**
   * An Agent of `s` due daily at `minute`, and its Schedule as Temporal fires it: the Run's workflow ID ends in the time
   * the Run was due, whenever the worker takes it up (`now`). A Run it starts ends at once.
   */
  async function firing(
    s: Awaited<ReturnType<typeof withAcceptedCourse>>,
    minute: number,
  ) {
    let at = new Date();
    const agents = createAgents({
      db: runtime,
      schedules: fakeSchedules().schedules,
      clock: { now: () => at },
    });
    const created = await agents.create(
      s.p,
      form(s.courseId, { rhythm: "daily", minute }),
    );
    if (created.status !== "ok") throw new Error(created.status);
    const agentId = created.id;
    const fire = async (due: string, now = due) => {
      at = new Date(now);
      const runId = await agents.startRun({
        runId: randomUUID(),
        workflowId: `agentRun/${agentId}-${due}`,
        studentId: s.studentId,
        agentId,
      });
      if (runId)
        await admin.run.update({
          where: { id: runId },
          data: { status: "done", startedAt: at, endedAt: at },
        });
      return runId;
    };
    return { agents, agentId, fire };
  }

  it("starts one Run a day in the Plan's time zone, though the hour the clocks go back fires its Uhrzeit twice", async () => {
    const s = await withAcceptedCourse("Europe/Berlin");
    const { fire } = await firing(s, 150);

    // 02:30 summer time.
    expect(await fire("2026-10-25T00:30:00Z")).toEqual(expect.any(String));
    // 02:30 again, now winter time.
    expect(await fire("2026-10-25T01:30:00Z")).toBeNull();
    // 02:30 the next day.
    expect(await fire("2026-10-26T01:30:00Z")).toEqual(expect.any(String));
  });

  it("starts each evening's Run though the worker took up the one before only after midnight", async () => {
    const s = await withAcceptedCourse("Europe/Berlin");
    const { fire } = await firing(s, 23 * 60 + 30);

    // Saturday's 23:30, taken up at 00:15 on Sunday.
    expect(await fire("2026-11-21T22:30:00Z", "2026-11-21T23:15:00Z")).toEqual(
      expect.any(String),
    );
    // Sunday's 23:30.
    expect(await fire("2026-11-22T22:30:00Z")).toEqual(expect.any(String));
  });

  it("starts a Run at a later Uhrzeit on a day the Agent has already run", async () => {
    const s = await withAcceptedCourse("Europe/Berlin");
    const { agents, agentId, fire } = await firing(s, 8 * 60);

    expect(await fire("2026-11-23T07:00:00Z")).toEqual(expect.any(String));
    expect(
      await agents.update(
        s.p,
        agentId,
        form(s.courseId, { rhythm: "daily", minute: 18 * 60 }),
      ),
    ).toEqual({ status: "ok" });
    expect(await fire("2026-11-23T17:00:00Z")).toEqual(expect.any(String));
  });

  it("saves the other Agents' Schedules when one cannot be saved, then fails, so the worker does not start", async () => {
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

    await expect(agents.saveSchedules()).rejects.toThrow(
      "Could not save 1 Agents' Schedules",
    );

    expect(calls.filter((call) => call.includes(ids[1]!))).toHaveLength(1);
  });
});

describe("Agent Templates", () => {
  async function withAcceptedCourse() {
    const s = await student();
    await admin.course.update({
      where: { id: s.courseId },
      data: { status: "accepted" },
    });
    return s;
  }
  const templateForm = (courseId: string, templateId?: string | null) => ({
    name: "Klausur vorbereiten",
    description: "Plant deine Vorbereitung bis zum Prüfungstag.",
    emoji: "🎯",
    instructions: "Bereite mich auf die nächste Klausur vor.",
    courseIds: [courseId],
    capabilities: [{ id: "createStudyBlocks", mode: "automatic" as const }],
    budgetMicroUsd: 5_000_000,
    trigger: { rhythm: "daily" as const, minute: 360 },
    modelKey: "sonnet-5.5-reasoning-high",
    ...(templateId !== undefined ? { templateId } : {}),
  });

  it("records a valid templateId on create, rejects unknown ones, and keeps it across edits", async () => {
    const s = await withAcceptedCourse();
    const { schedules } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });

    expect(
      await agents.create(s.p, templateForm(s.courseId, "not_a_template")),
    ).toEqual({ status: "invalid" });

    const created = await agents.create(
      s.p,
      templateForm(s.courseId, "prepareExam"),
    );
    if (created.status !== "ok") throw new Error(created.status);
    expect(await agents.view(s.p, created.id)).toMatchObject({
      templateId: "prepareExam",
    });

    const edited = await agents.update(s.p, created.id, {
      ...templateForm(s.courseId),
      name: "Eigener Name",
    });
    expect(edited).toEqual({ status: "ok" });
    expect(await agents.view(s.p, created.id)).toMatchObject({
      name: "Eigener Name",
      templateId: "prepareExam",
    });
  });

  it("counts distinct other students per Template, including Ended Agents and excluding Deleted and own ones", async () => {
    const alice = await withAcceptedCourse();
    const bob = await withAcceptedCourse();
    const carol = await withAcceptedCourse();
    const { schedules } = fakeSchedules();
    const agents = createAgents({ db: runtime, schedules, clock });

    const countFor = async (p: typeof alice.p, id: string) =>
      (await agents.templates(p)).find((t) => t.id === id)!.othersCount;

    const baseline = await countFor(bob.p, "prepareExam");

    // Alice saves two Agents from prepareExam: counted once for Bob, zero for Alice.
    const a1 = await agents.create(
      alice.p,
      templateForm(alice.courseId, "prepareExam"),
    );
    const a2 = await agents.create(
      alice.p,
      templateForm(alice.courseId, "prepareExam"),
    );
    if (a1.status !== "ok" || a2.status !== "ok")
      throw new Error("create failed");

    expect(await countFor(alice.p, "prepareExam")).toBe(baseline);
    expect(await countFor(bob.p, "prepareExam")).toBe(baseline + 1);

    // Carol saves one from prepareExam and ends it: Ended Agents stay counted.
    const c1 = await agents.create(
      carol.p,
      templateForm(carol.courseId, "prepareExam"),
    );
    if (c1.status !== "ok") throw new Error(c1.status);
    await agents.end(carol.p, c1.id);
    expect(await countFor(bob.p, "prepareExam")).toBe(baseline + 2);

    // Deleting Alice's first Agent leaves her second; deleting both drops her from the count.
    await agents.delete(alice.p, a1.id);
    expect(await countFor(bob.p, "prepareExam")).toBe(baseline + 2);
    await agents.delete(alice.p, a2.id);
    expect(await countFor(bob.p, "prepareExam")).toBe(baseline + 1);
  });
});
