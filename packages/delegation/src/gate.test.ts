import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  ActionOutcome,
  Delegation,
  Executor,
  PlanRules,
  PlanVerdict,
} from "./index.js";
import {
  createDelegation,
  DelegationUnavailable,
  KeyConflictError,
  principal,
  StaleApprovalError,
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

const hour = 60 * 60_000,
  day = 24 * hour;

/** A manual clock. */
let now: Date;
const clock = { now: () => now };
beforeEach(() => {
  now = new Date("2026-11-10T07:00:00Z");
});

/** A scriptable fake of the Plan executor that records every dispatch it receives. */
function fakeExecutor(
  script: {
    execute?: "ok" | "reject" | "ambiguous" | "succeed-then-crash";
    lookup?: "found" | "absent" | "unknown";
  } = {},
) {
  const dispatched: { idempotencyKey: string; intent: unknown }[] = [];
  const executor: Executor = {
    async execute(req, { idempotencyKey }) {
      dispatched.push({ idempotencyKey, intent: req.intent });
      switch (script.execute ?? "ok") {
        case "ok":
          return { status: "done", effect: { studyBlockId: idempotencyKey } };
        case "reject":
          return { status: "rejected", detail: "the Plan refused it" };
        case "ambiguous":
          return { status: "ambiguous" };
        case "succeed-then-crash":
          throw new Error("worker crashed after the block was written");
      }
    },
    async lookup(key) {
      const answer = script.lookup ?? "unknown";
      return answer === "found"
        ? { status: "found", effect: { studyBlockId: key } }
        : { status: answer };
    },
  };
  return { executor, dispatched };
}

function gate(
  executor: Executor,
  deadlines: Record<string, Date> = {},
  planRules?: PlanRules,
): Delegation {
  return createDelegation({
    db: runtime,
    aiEnabled: () => true,
    clock,
    executors: { plan: executor },
    planRules,
    deadlineOf: async (_, obligationId) => deadlines[obligationId] ?? null,
  });
}

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
    obligationId,
    blockId,
    p: principal.fromSession({ studentId }),
  };
}

/** A Run of an Agent holding the given Grants on the student's Course. */
async function run(
  s: Awaited<ReturnType<typeof student>>,
  { grants = ["studyBlock.create", "studyBlock.move"] as string[] } = {},
) {
  const agentId = randomUUID(),
    runId = randomUUID();
  await admin.agent.create({
    data: {
      id: agentId,
      studentId: s.studentId,
      preset: "keep_course_organized",
      budgetMicroUsd: 100_000,
    },
  });
  await admin.grant.createMany({
    data: grants.map((kind) => ({
      id: randomUUID(),
      studentId: s.studentId,
      agentId,
      kind,
      courseId: s.courseId,
    })),
  });
  await admin.run.create({
    data: { id: runId, studentId: s.studentId, agentId },
  });
  return { agentId, runId, p: principal.fromRun(runId) };
}

const move = (s: { blockId: string }, startHour = 14) => ({
  kind: "studyBlock.move" as const,
  studyBlockId: s.blockId,
  start: new Date(Date.UTC(2026, 10, 11, startHour)),
  end: new Date(Date.UTC(2026, 10, 11, startHour + 1)),
});

describe("perform", () => {
  it("acts at once on a Grant of the Run's Agent that covers the Action", async () => {
    const s = await student();
    const r = await run(s);
    const { executor, dispatched } = fakeExecutor();

    const outcome = await gate(executor).perform(r.p, {
      key: `${r.runId}:1`,
      intent: move(s),
    });

    expect(outcome).toEqual({
      status: "done",
      actionId: expect.any(String),
      effect: { studyBlockId: expect.any(String) },
    });
    expect(dispatched).toEqual([
      { idempotencyKey: expect.any(String), intent: move(s) },
    ]);
  });

  it("dispatches once per key: a repeat returns the recorded outcome", async () => {
    const s = await student();
    const r = await run(s);
    const { executor, dispatched } = fakeExecutor();
    const g = gate(executor);

    const first = await g.perform(r.p, {
      key: `${r.runId}:1`,
      intent: move(s),
    });
    const again = await g.perform(r.p, {
      key: `${r.runId}:1`,
      intent: move(s),
    });

    expect(again).toEqual(first);
    expect(dispatched).toHaveLength(1);
  });

  it("refuses to reuse a key for a different Action", async () => {
    const s = await student();
    const r = await run(s);
    const g = gate(fakeExecutor().executor);
    await g.perform(r.p, { key: `${r.runId}:1`, intent: move(s) });

    await expect(
      g.perform(r.p, { key: `${r.runId}:1`, intent: move(s, 15) }),
    ).rejects.toThrow(KeyConflictError);
  });
});

describe("Approval", () => {
  /** Asks in a Chat, which has no Grants, so the Action always needs the student's Approval. */
  async function asked(
    g: Delegation,
    s: Awaited<ReturnType<typeof student>>,
    intent = move(s),
  ) {
    const outcome = await g.perform(s.p, {
      key: `chat-1:message-1:${randomUUID()}`,
      intent,
    });
    return {
      outcome: outcome as Extract<
        ActionOutcome,
        { status: "awaiting_approval" }
      >,
    };
  }

  it("asks in a Chat, then acts once the student approves the exact Action shown", async () => {
    const s = await student();
    const { executor, dispatched } = fakeExecutor();
    const g = gate(executor);
    const key = "chat-1:message-1:0";

    const asking = await g.perform(s.p, { key, intent: move(s) });
    expect(asking).toEqual({
      status: "awaiting_approval",
      actionId: expect.any(String),
      fingerprint: expect.any(String),
      expiresAt: new Date(now.getTime() + 7 * day),
    });
    expect(dispatched).toEqual([]);
    if (asking.status !== "awaiting_approval") return;

    await g.decide(s.p, {
      kind: "approve",
      actionId: asking.actionId,
      fingerprint: asking.fingerprint,
    });
    expect(dispatched).toEqual([]);
    expect(await g.perform(s.p, { key, intent: move(s) })).toMatchObject({
      status: "done",
      actionId: asking.actionId,
    });
    expect(dispatched).toHaveLength(1);
  });

  it("acts on a Chat Action from its record alone, as the API does after an Approval given anywhere", async () => {
    const s = await student();
    const { executor, dispatched } = fakeExecutor();
    const g = gate(executor);
    const asking = (await g.perform(s.p, {
      key: "chat-1:message-2:0",
      intent: move(s),
    })) as Extract<ActionOutcome, { status: "awaiting_approval" }>;

    const record = await g.decide(s.p, {
      kind: "approve",
      actionId: asking.actionId,
      fingerprint: asking.fingerprint,
    });

    expect(record).toMatchObject({
      key: "chat-1:message-2:0",
      intent: move(s),
    });
    expect(
      await g.perform(s.p, { key: record.key, intent: record.intent }),
    ).toMatchObject({ status: "done", actionId: asking.actionId });
    expect(dispatched).toHaveLength(1);
  });

  it("finds a Chat's Actions by the keys they were asked under", async () => {
    const s = await student();
    const g = gate(fakeExecutor().executor);
    await g.perform(s.p, { key: "chat-2:message-1:0", intent: move(s) });
    await g.perform(s.p, { key: "chat-2:message-2:0", intent: move(s) });

    const found = await g.history(s.p, { keys: ["chat-2:message-1:0"] });

    expect(found.map((record) => record.key)).toEqual(["chat-2:message-1:0"]);
  });

  it("dispatches once however often the student clicks approve", async () => {
    const s = await student();
    const { executor, dispatched } = fakeExecutor();
    const g = gate(executor);
    const key = "chat-1:message-1:0";
    const asking = (await g.perform(s.p, { key, intent: move(s) })) as Extract<
      ActionOutcome,
      { status: "awaiting_approval" }
    >;

    const click = async () => {
      await g.decide(s.p, {
        kind: "approve",
        actionId: asking.actionId,
        fingerprint: asking.fingerprint,
      });
      return g
        .perform(s.p, { key, intent: move(s) })
        .catch((error: Error) => error.name);
    };
    const results = await Promise.all(Array.from({ length: 5 }, click));

    expect(dispatched).toHaveLength(1);
    expect(
      results.filter((r) => typeof r === "object" && r.status === "done"),
    ).not.toHaveLength(0);
    expect(
      results.every(
        (r) =>
          (typeof r === "object" && r.status === "done") ||
          r === "DelegationUnavailable",
      ),
    ).toBe(true);
  });

  it("refuses an Approval given for a fingerprint the student was not shown", async () => {
    const s = await student();
    const g = gate(fakeExecutor().executor);
    const { outcome } = await asked(g, s);

    await expect(
      g.decide(s.p, {
        kind: "approve",
        actionId: outcome.actionId,
        fingerprint: "forged",
      }),
    ).rejects.toThrow(StaleApprovalError);
  });

  it("refuses to act on an Approval once the block changed since the student was shown it", async () => {
    const s = await student();
    const { executor, dispatched } = fakeExecutor();
    const g = gate(executor);
    const key = "chat-1:message-1:0";
    const asking = (await g.perform(s.p, { key, intent: move(s) })) as Extract<
      ActionOutcome,
      { status: "awaiting_approval" }
    >;
    await g.decide(s.p, {
      kind: "approve",
      actionId: asking.actionId,
      fingerprint: asking.fingerprint,
    });
    await admin.studyBlock.update({
      where: { id: s.blockId },
      data: {
        start: new Date("2026-11-10T11:00:00Z"),
        end: new Date("2026-11-10T12:00:00Z"),
      },
    });

    expect(await g.perform(s.p, { key, intent: move(s) })).toMatchObject({
      status: "refused",
      reason: "approval_mismatch",
    });
    expect(dispatched).toEqual([]);
  });

  it("expires an unanswered request after seven days", async () => {
    const s = await student();
    const { executor, dispatched } = fakeExecutor();
    const g = gate(executor);
    const key = "chat-1:message-1:0";
    const asking = (await g.perform(s.p, { key, intent: move(s) })) as Extract<
      ActionOutcome,
      { status: "awaiting_approval" }
    >;

    now = new Date(now.getTime() + 7 * day);

    expect(await g.perform(s.p, { key, intent: move(s) })).toMatchObject({
      status: "refused",
      reason: "approval_expired",
    });
    const late = await g
      .decide(s.p, {
        kind: "approve",
        actionId: asking.actionId,
        fingerprint: asking.fingerprint,
      })
      .catch((e) => e);
    expect(late).toBeInstanceOf(StaleApprovalError);
    expect(dispatched).toEqual([]);
  });

  it.each([7 * day, 2 * day])(
    "refuses an approved Action at its expiry (%i ms)",
    async (expiry) => {
      const s = await student();
      const { executor, dispatched } = fakeExecutor();
      const deadline = new Date(now.getTime() + expiry);
      const g = gate(executor, { [s.obligationId]: deadline });
      const key = "approved-before-expiry";
      const asking = await g.perform(s.p, { key, intent: move(s) });
      expect(asking.status).toBe("awaiting_approval");
      if (asking.status !== "awaiting_approval") return;
      await g.decide(s.p, {
        kind: "approve",
        actionId: asking.actionId,
        fingerprint: asking.fingerprint,
      });

      now = deadline;

      expect(await g.perform(s.p, { key, intent: move(s) })).toMatchObject({
        status: "refused",
        reason: "approval_expired",
      });
      expect(dispatched).toEqual([]);
    },
  );

  it("refuses an approval clicked after the request expired", async () => {
    const s = await student();
    const g = gate(fakeExecutor().executor);
    const { outcome } = await asked(g, s);

    now = new Date(now.getTime() + 7 * day);

    expect(
      await g.decide(s.p, {
        kind: "approve",
        actionId: outcome.actionId,
        fingerprint: outcome.fingerprint,
      }),
    ).toMatchObject({ status: "refused", refusal: "approval_expired" });
  });

  it("caps a request's expiry at the deadline of the Obligation it is for", async () => {
    const s = await student();
    const due = new Date(now.getTime() + 2 * day);
    const g = gate(fakeExecutor().executor, { [s.obligationId]: due });

    const { outcome } = await asked(g, s);

    expect(outcome.expiresAt).toEqual(due);
  });

  it("records a denial and never acts on it", async () => {
    const s = await student();
    const { executor, dispatched } = fakeExecutor();
    const g = gate(executor);
    const key = "chat-1:message-1:0";
    const asking = await g.perform(s.p, { key, intent: move(s) });

    await g.decide(s.p, { kind: "deny", actionId: asking.actionId });

    expect(await g.perform(s.p, { key, intent: move(s) })).toMatchObject({
      status: "refused",
      reason: "approval_denied",
    });
    expect(dispatched).toEqual([]);
  });
});

describe("rechecks at dispatch", () => {
  it("stops the next Action once the Agent is Paused between two", async () => {
    const s = await student();
    const r = await run(s);
    const { executor, dispatched } = fakeExecutor();
    const g = gate(executor);

    expect(
      await g.perform(r.p, { key: `${r.runId}:1`, intent: move(s, 14) }),
    ).toMatchObject({ status: "done" });
    await admin.agent.update({
      where: { id: r.agentId },
      data: { state: "paused", pausedBy: "student" },
    });

    expect(
      await g.perform(r.p, { key: `${r.runId}:2`, intent: move(s, 16) }),
    ).toMatchObject({ status: "refused", reason: "paused" });
    expect(dispatched).toHaveLength(1);
  });

  it.each(["paused", "ended", "restricted", "revoked"] as const)(
    "rechecks authority after waiting for a concurrent %s change",
    async (change) => {
      const s = await student();
      const r = await run(s);
      const { executor, dispatched } = fakeExecutor();
      let markLocked!: (pid: number) => void;
      let release!: () => void;
      const locked = new Promise<number>((resolve) => {
        markLocked = resolve;
      });
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      const update = admin.$transaction(
        async (tx) => {
          const [backend] = await tx.$queryRaw<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          await tx.agent.update({
            where: { id: r.agentId },
            data:
              change === "paused" || change === "ended"
                ? { state: change }
                : {
                    restrictions:
                      change === "restricted" ? { allowedKinds: [] } : {},
                  },
          });
          if (change === "revoked") {
            await tx.grant.deleteMany({
              where: { agentId: r.agentId },
            });
          }
          markLocked(backend!.pid);
          await released;
        },
        { timeout: 15_000 },
      );
      const blockerPid = await locked;
      const pending = gate(executor).perform(r.p, {
        key: "concurrent-change",
        intent: move(s),
      });
      try {
        // Observe the actual row-lock wait, rather than relying on query timing.
        await expect
          .poll(async () => {
            const rows = await admin.$queryRaw<{ waiting: boolean }[]>`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE ${blockerPid} = ANY(pg_blocking_pids(pid))
            ) AS waiting`;
            return rows[0]!.waiting;
          })
          .toBe(true);
      } finally {
        release();
        await update;
      }
      expect(await pending).toMatchObject(
        change === "revoked"
          ? { status: "awaiting_approval" }
          : { status: "refused", reason: change },
      );
      expect(dispatched).toEqual([]);
    },
  );

  it("stops a Run whose Agent Ended", async () => {
    const s = await student();
    const r = await run(s);
    await admin.agent.update({
      where: { id: r.agentId },
      data: { state: "ended", endedAt: now },
    });

    expect(
      await gate(fakeExecutor().executor).perform(r.p, {
        key: `${r.runId}:1`,
        intent: move(s),
      }),
    ).toMatchObject({ status: "refused", reason: "ended" });
  });

  it("never moves a Locked block, not even when asked", async () => {
    const s = await student();
    await admin.studyBlock.update({
      where: { id: s.blockId },
      data: { lockedAt: now },
    });

    expect(
      await gate(fakeExecutor().executor).perform(s.p, {
        key: "chat-1:message-1:0",
        intent: move(s),
      }),
    ).toMatchObject({ status: "refused", reason: "locked" });
  });

  it("never schedules into weekly Protected Time on the student's local day", async () => {
    const s = await student();
    // Wednesday 2026-11-11, 15:00–16:00 in Berlin is 14:00–15:00 UTC.
    await admin.protectedTime.create({
      data: {
        id: randomUUID(),
        studentId: s.studentId,
        weekday: 3,
        fromMinute: 15 * 60,
        toMinute: 16 * 60,
      },
    });
    const r = await run(s);
    const g = gate(fakeExecutor().executor);

    expect(
      await g.perform(r.p, { key: `${r.runId}:1`, intent: move(s, 14) }),
    ).toMatchObject({ status: "refused", reason: "protected_time" });
    expect(
      await g.perform(r.p, { key: `${r.runId}:2`, intent: move(s, 15) }),
    ).toMatchObject({ status: "done" });
  });

  it("never schedules into a one-off span of Protected Time", async () => {
    const s = await student();
    await admin.protectedTime.create({
      data: {
        id: randomUUID(),
        studentId: s.studentId,
        start: new Date("2026-11-11T00:00:00Z"),
        end: new Date("2026-11-12T00:00:00Z"),
      },
    });
    const r = await run(s);

    expect(
      await gate(fakeExecutor().executor).perform(r.p, {
        key: `${r.runId}:1`,
        intent: move(s),
      }),
    ).toMatchObject({ status: "refused", reason: "protected_time" });
  });

  it("refuses to act on another student's block", async () => {
    const s = await student();
    const other = await student();
    const r = await run(s);

    expect(
      await gate(fakeExecutor().executor).perform(r.p, {
        key: `${r.runId}:1`,
        intent: move(other),
      }),
    ).toMatchObject({ status: "refused", reason: "not_owner" });
  });

  it("creates a block for work in the Grant's Course without asking", async () => {
    const s = await student();
    const r = await run(s);
    const intent = {
      kind: "studyBlock.create" as const,
      workId: s.obligationId,
      start: new Date("2026-11-11T09:00:00Z"),
      end: new Date("2026-11-11T10:00:00Z"),
    };

    expect(
      await gate(fakeExecutor().executor).perform(r.p, {
        key: `${r.runId}:1`,
        intent,
      }),
    ).toMatchObject({ status: "done" });
  });

  it("creates a block for a Task in the Grant's Course without asking, though it is toward no Obligation", async () => {
    const s = await student();
    const r = await run(s);
    const taskId = randomUUID();
    await admin.task.create({
      data: {
        id: taskId,
        studentId: s.studentId,
        courseId: s.courseId,
        title: "VL 3 nacharbeiten",
      },
    });

    expect(
      await gate(fakeExecutor().executor).perform(r.p, {
        key: `${r.runId}:1`,
        intent: {
          kind: "studyBlock.create",
          workId: taskId,
          start: new Date("2026-11-11T09:00:00Z"),
          end: new Date("2026-11-11T10:00:00Z"),
        },
      }),
    ).toMatchObject({ status: "done" });
  });

  it("asks a preset Agent under an unscoped Grant: only its scoped Grants are its own", async () => {
    const s = await student();
    const r = await run(s, { grants: [] });
    await admin.grant.create({
      data: {
        id: randomUUID(),
        studentId: s.studentId,
        agentId: r.agentId,
        kind: "studyBlock.create",
      },
    });
    const taskId = randomUUID();
    await admin.task.create({
      data: {
        id: taskId,
        studentId: s.studentId,
        title: "Bewerbung schreiben",
      },
    });
    const g = gate(fakeExecutor().executor);
    const block = (workId: string) => ({
      kind: "studyBlock.create" as const,
      workId,
      start: new Date("2026-11-11T09:00:00Z"),
      end: new Date("2026-11-11T10:00:00Z"),
    });

    expect(
      await g.perform(r.p, { key: `${r.runId}:1`, intent: block(taskId) }),
    ).toMatchObject({ status: "awaiting_approval" });
    expect(
      await g.perform(r.p, {
        key: `${r.runId}:2`,
        intent: block(s.obligationId),
      }),
    ).toMatchObject({ status: "awaiting_approval" });
  });

  it("asks before adding or reopening a Task, even in a Run whose Grant covers its Course", async () => {
    const s = await student();
    const r = await run(s);
    const taskId = randomUUID();
    await admin.task.create({
      data: {
        id: taskId,
        studentId: s.studentId,
        courseId: s.courseId,
        title: "VL 3 nacharbeiten",
        doneAt: now,
      },
    });
    const g = gate(fakeExecutor().executor);

    expect(
      await g.perform(r.p, {
        key: `${r.runId}:1`,
        intent: {
          kind: "task.create",
          title: "VL 4 vorbereiten",
          courseId: s.courseId,
          fixedEventId: null,
          role: null,
          estimateMinutes: 30,
        },
      }),
    ).toMatchObject({ status: "awaiting_approval" });
    expect(
      await g.perform(r.p, {
        key: `${r.runId}:2`,
        intent: { kind: "task.reopen", taskId },
      }),
    ).toMatchObject({ status: "awaiting_approval" });
  });

  it("asks before moving a block the student placed, even with a Grant", async () => {
    const s = await student();
    await admin.studyBlock.update({
      where: { id: s.blockId },
      data: { placedBy: "student" },
    });
    const r = await run(s);

    expect(
      await gate(fakeExecutor().executor).perform(r.p, {
        key: `${r.runId}:1`,
        intent: move(s),
      }),
    ).toMatchObject({ status: "awaiting_approval" });
  });

  it("lets a Restriction turn a Grant into asking, never the reverse", async () => {
    const s = await student();
    const asking = await run(s);
    await admin.agent.update({
      where: { id: asking.agentId },
      data: { restrictions: { alwaysAsk: ["studyBlock.move"] } },
    });
    const ungranted = await run(s, { grants: [] });
    await admin.agent.update({
      where: { id: ungranted.agentId },
      data: { restrictions: { allowedKinds: ["studyBlock.move"] } },
    });
    const g = gate(fakeExecutor().executor);

    expect(
      await g.perform(asking.p, { key: `${asking.runId}:1`, intent: move(s) }),
    ).toMatchObject({ status: "awaiting_approval" });
    expect(
      await g.perform(ungranted.p, {
        key: `${ungranted.runId}:1`,
        intent: move(s),
      }),
    ).toMatchObject({ status: "awaiting_approval" });
  });
});

describe("dispatch and recovery", () => {
  it("records a definite rejection as failed", async () => {
    const s = await student();
    const r = await run(s);

    expect(
      await gate(fakeExecutor({ execute: "reject" }).executor).perform(r.p, {
        key: `${r.runId}:1`,
        intent: move(s),
      }),
    ).toMatchObject({ status: "failed", detail: "the Plan refused it" });
  });

  it("never dispatches an Unconfirmed Action again; only the student resolves it", async () => {
    const s = await student();
    const r = await run(s);
    const { executor, dispatched } = fakeExecutor({ execute: "ambiguous" });
    const g = gate(executor);

    const outcome = await g.perform(r.p, {
      key: `${r.runId}:1`,
      intent: move(s),
    });
    expect(outcome).toMatchObject({ status: "unconfirmed" });
    expect(
      await g.perform(r.p, { key: `${r.runId}:1`, intent: move(s) }),
    ).toEqual(outcome);
    expect(dispatched).toHaveLength(1);

    expect(
      await g.decide(s.p, {
        kind: "resolve",
        actionId: outcome.actionId,
        resolution: "happened",
      }),
    ).toMatchObject({ status: "done" });
    await expect(
      g.decide(s.p, {
        kind: "resolve",
        actionId: outcome.actionId,
        resolution: "happened",
      }),
    ).rejects.toThrow(StaleApprovalError);
  });

  it("gives Unconfirmed, after exactly one dispatch, when a crash follows a remote success nobody can confirm", async () => {
    const s = await student();
    const r = await run(s);
    const { executor, dispatched } = fakeExecutor({
      execute: "succeed-then-crash",
      lookup: "unknown",
    });

    expect(
      await gate(executor).perform(r.p, {
        key: `${r.runId}:1`,
        intent: move(s),
      }),
    ).toMatchObject({ status: "unconfirmed" });
    expect(dispatched).toHaveLength(1);
  });

  it("confirms a crashed dispatch the executor finds under its key, without dispatching again", async () => {
    const s = await student();
    const r = await run(s);
    const { executor, dispatched } = fakeExecutor({
      execute: "succeed-then-crash",
      lookup: "found",
    });

    expect(
      await gate(executor).perform(r.p, {
        key: `${r.runId}:1`,
        intent: move(s),
      }),
    ).toMatchObject({ status: "done" });
    expect(dispatched).toHaveLength(1);
  });

  it("retries with the same key only when the executor reports the dispatch absent", async () => {
    const s = await student();
    const r = await run(s);
    let calls = 0;
    const keys: string[] = [];
    const executor: Executor = {
      async execute(_, { idempotencyKey }) {
        keys.push(idempotencyKey);
        if (calls++ === 0) throw new Error("connection reset before sending");
        return { status: "done", effect: {} };
      },
      async lookup() {
        return { status: "absent" };
      },
    };

    expect(
      await gate(executor).perform(r.p, {
        key: `${r.runId}:1`,
        intent: move(s),
      }),
    ).toMatchObject({ status: "done" });
    expect(new Set(keys).size).toBe(1);
  });

  it("yields a retryable error after a failed recovery dispatch and preserves its key", async () => {
    const s = await student();
    const r = await run(s);
    const keys: string[] = [];
    let available = false;
    let failures = 0;
    const executor: Executor = {
      async execute(_, { idempotencyKey }) {
        keys.push(idempotencyKey);
        // Cap the broken implementation's loop so the regression fails without hanging.
        if (available || ++failures > 2) return { status: "done", effect: {} };
        throw new Error("provider unavailable");
      },
      async lookup() {
        return { status: "absent" };
      },
    };
    const g = gate(executor);
    await expect(
      g.perform(r.p, { key: "outage", intent: move(s) }),
    ).rejects.toThrow(DelegationUnavailable);
    expect(keys).toHaveLength(2);
    expect(
      await admin.attempt.findMany({ where: { studentId: s.studentId } }),
    ).toMatchObject([{ status: "in_flight" }]);

    now = new Date(now.getTime() + hour);
    failures = 1;
    // Scheduled recovery also yields after one failed retry.
    await expect(g.reconcile()).rejects.toThrow(DelegationUnavailable);
    expect(keys).toHaveLength(3);
    available = true;
    await expect(
      g.perform(r.p, { key: "outage", intent: move(s) }),
    ).resolves.toMatchObject({ status: "done" });
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(1);
    expect(
      await admin.attempt.count({ where: { studentId: s.studentId } }),
    ).toBe(1);
  });

  it("lets reconcile recover a dispatch left in flight by a worker that died", async () => {
    const s = await student();
    const r = await run(s);
    const executor: Executor = {
      execute: () => new Promise(() => {}), // The worker dies mid-call: no answer ever comes.
      async lookup(key) {
        return { status: "found", effect: { studyBlockId: key } };
      },
    };
    const g = gate(executor);
    void g.perform(r.p, { key: `${r.runId}:1`, intent: move(s) });
    await expect
      .poll(() =>
        admin.attempt.count({
          where: { studentId: s.studentId, status: "in_flight" },
        }),
      )
      .toBe(1);

    expect(await g.reconcile()).toBe(0);
    now = new Date(now.getTime() + hour);
    expect(await g.reconcile()).toBeGreaterThanOrEqual(1);

    expect(
      await g.perform(r.p, { key: `${r.runId}:1`, intent: move(s) }),
    ).toMatchObject({ status: "done" });
  });
});

describe("history", () => {
  it("shows each Action with the authority it used and the refusals in between", async () => {
    const s = await student();
    const r = await run(s);
    const g = gate(fakeExecutor().executor);
    await g.perform(r.p, { key: `${r.runId}:1`, intent: move(s, 14) });
    await admin.agent.update({
      where: { id: r.agentId },
      data: { state: "paused", pausedBy: "student" },
    });
    await g.perform(r.p, { key: `${r.runId}:2`, intent: move(s, 16) });

    const history = await g.history(s.p, {
      agentId: r.agentId,
    });

    const grant = await admin.grant.findFirstOrThrow({
      where: { agentId: r.agentId, kind: "studyBlock.move" },
    });
    expect(
      history.map((a) => ({
        status: a.status,
        refusal: a.refusal,
        authority: a.authority,
        events: a.events.map((e) => e.type),
      })),
    ).toEqual([
      {
        status: "refused",
        refusal: "paused",
        authority: null,
        events: ["proposed", "refused"],
      },
      {
        status: "done",
        refusal: null,
        authority: { grantId: grant.id },
        events: ["proposed", "dispatched", "done"],
      },
    ]);
  });

  it("shows only the Actions asked for by ID, whatever their status", async () => {
    const s = await student();
    const r = await run(s);
    const g = gate(fakeExecutor().executor);
    const first = await g.perform(r.p, {
      key: `${r.runId}:1`,
      intent: move(s, 14),
    });
    await g.perform(r.p, { key: `${r.runId}:2`, intent: move(s, 16) });

    const history = await g.history(s.p, { ids: [first.actionId] });

    expect(history.map((a) => a.id)).toEqual([first.actionId]);
  });

  it("shows a student none of another student's Actions", async () => {
    const s = await student();
    const other = await student();
    const r = await run(other);
    const g = gate(fakeExecutor().executor);
    await g.perform(r.p, { key: `${r.runId}:1`, intent: move(other) });

    expect(await g.history(s.p, {})).toEqual([]);
  });
});

describe("meter in a Run", () => {
  const call = (microUsd: number) => async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { value: "ok", usage: { microUsd } };
  };

  it("charges a Run's model call to its Agent's Budget and to the Allowance", async () => {
    const s = await student();
    const r = await run(s);
    const g = gate(fakeExecutor().executor);

    expect(await g.meter(r.p, { microUsd: 3_000 }, call(1_200))).toMatchObject({
      status: "ok",
    });

    expect(
      await admin.agent.findUniqueOrThrow({
        where: { id: r.agentId },
      }),
    ).toMatchObject({ usedMicroUsd: 1_200n, heldMicroUsd: 0n });
    expect(await g.allowance(s.p)).toEqual({
      limitMicroUsd: 1_000_000,
      usedMicroUsd: 1_200,
      heldMicroUsd: 0,
    });
  });

  it("pauses the Agent and asks once its Budget would be exceeded, never drawing further on the Allowance", async () => {
    const s = await student();
    const r = await run(s);
    const g = gate(fakeExecutor().executor);
    let calls = 0;

    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        g.meter(r.p, { microUsd: 10_000 }, async () => {
          calls++;
          return call(10_000)();
        }),
      ),
    );

    expect(results.filter((result) => result.status === "ok")).toHaveLength(10);
    // The first call over Budget pauses the Agent; the calls after it find it Paused for its Budget.
    const refusals = results
      .flatMap((result) => (result.status === "refused" ? [result.reason] : []))
      .sort();
    expect(refusals).toEqual(Array(5).fill("budget_exhausted"));
    expect(calls).toBe(10);
    expect(
      await admin.agent.findUniqueOrThrow({
        where: { id: r.agentId },
      }),
    ).toMatchObject({
      state: "paused",
      pausedBy: "budget",
      usedMicroUsd: 100_000n,
    });
    expect(await g.allowance(s.p)).toMatchObject({ usedMicroUsd: 100_000 });
    expect(
      await g.perform(r.p, { key: `${r.runId}:1`, intent: move(s) }),
    ).toMatchObject({ status: "refused", reason: "paused" });
  });

  it("refuses a model call in a Paused Agent's Run", async () => {
    const s = await student();
    const r = await run(s);
    await admin.agent.update({
      where: { id: r.agentId },
      data: { state: "paused", pausedBy: "student" },
    });

    expect(
      await gate(fakeExecutor().executor).meter(
        r.p,
        { microUsd: 100 },
        call(100),
      ),
    ).toEqual({ status: "refused", reason: "paused" });
  });
});

describe("durable Approval decision delivery", () => {
  it.each(["approve", "deny"] as const)(
    "retries a %s wake after delivery loses its acknowledgement, then stops retrying",
    async (kind) => {
      const s = await student();
      const other = await student();
      const r = await run(s, { grants: [] });
      const workflowId = `workflow-${r.runId}`;
      await admin.run.update({ where: { id: r.runId }, data: { workflowId } });
      const { executor, dispatched } = fakeExecutor();
      const g = gate(executor);
      const asking = await g.perform(r.p, {
        key: `${r.runId}:1`,
        intent: move(s),
      });
      if (asking.status !== "awaiting_approval") throw new Error(asking.status);
      const notices: { actionId: string; workflowId: string; runId: string }[] =
        [];
      const notify = async (notice: (typeof notices)[number]) => {
        notices.push(notice);
      };
      // Neither an unanswered Approval nor another student's Principal can produce a wake.
      expect(await g.notifyDecision(s.p, asking.actionId, notify)).toBe(false);
      await g.decide(
        s.p,
        kind === "approve"
          ? { kind, actionId: asking.actionId, fingerprint: asking.fingerprint }
          : { kind, actionId: asking.actionId },
      );
      expect(await g.notifyDecision(other.p, asking.actionId, notify)).toBe(
        false,
      );
      expect(notices).toEqual([]);
      // Temporal accepted the signal, but the sender lost the reply before acknowledging it in Postgres.
      await expect(
        g.notifyDecision(s.p, asking.actionId, async (notice) => {
          await notify(notice);
          throw new Error("lost delivery reply");
        }),
      ).rejects.toThrow("lost delivery reply");
      expect(
        (await g.history(s.p))[0]!.events.some(
          (e) => e.type === "decision_notified",
        ),
      ).toBe(false);
      const restarted = gate(executor);
      await restarted.reconcile(notify);
      expect(notices).toEqual(
        Array(2).fill({
          actionId: asking.actionId,
          workflowId,
          runId: r.runId,
        }),
      );
      expect(await restarted.reconcile(notify)).toBe(0);
      expect(notices).toHaveLength(2);
      expect(dispatched).toEqual([]);
    },
  );
});

describe("a free-text Agent's Actions", () => {
  /** A Run of a free-text Agent on the student's Course, with these Capabilities and a Grant for each on a Grant-holding mode. */
  async function agentRun(
    s: Awaited<ReturnType<typeof student>>,
    held: Record<string, "always" | "automatic" | "ask">,
  ) {
    const agentId = randomUUID(),
      runId = randomUUID();
    // The Agent form offers only accepted Courses.
    await admin.course.update({
      where: { id: s.courseId },
      data: { status: "accepted" },
    });
    await admin.agent.create({
      data: {
        id: agentId,
        studentId: s.studentId,
        name: "Analysis",
        budgetMicroUsd: 100_000,
        courses: { create: { courseId: s.courseId } },
        capabilities: {
          create: Object.entries(held).map(([capability, mode]) => ({
            capability,
            mode,
          })),
        },
      },
    });
    const kinds = {
      createStudyBlocks: "studyBlock.create",
      moveOwnStudyBlocks: "studyBlock.move",
      moveStudyBlocks: "studyBlock.move",
      removeOwnStudyBlocks: "studyBlock.remove",
      createTasks: "task.create",
    } as Record<string, string>;
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
    return { agentId, runId, p: principal.fromRun(runId) };
  }
  /** The Plan's rules, answering every Study Block Action with one verdict, and every Preparation as due then. */
  function rules(
    verdict: PlanVerdict = { refusals: [], brokenPreferences: [] },
    due: Date | null = null,
  ) {
    const checked: unknown[] = [];
    const planRules: PlanRules = {
      async check(_, intent) {
        checked.push(intent);
        return verdict;
      },
      async taskDue(_, task) {
        return task.fixedEventId ? due : null;
      },
    };
    return { planRules, checked };
  }
  const create = (s: { obligationId: string }, workId = s.obligationId) => ({
    kind: "studyBlock.create" as const,
    workId,
    start: new Date("2026-11-12T09:00:00Z"),
    end: new Date("2026-11-12T10:00:00Z"),
  });

  it("creates a block in its Course on Automatisch, by the Plan's rules", async () => {
    const s = await student();
    const r = await agentRun(s, { createStudyBlocks: "automatic" });
    const { planRules, checked } = rules();
    const { executor, dispatched } = fakeExecutor();

    expect(
      await gate(executor, {}, planRules).perform(r.p, {
        key: `${r.runId}:1`,
        intent: create(s),
      }),
    ).toMatchObject({ status: "done" });
    expect(checked).toEqual([create(s)]);
    expect(dispatched).toHaveLength(1);
  });

  it("refuses work outside its Courses, and in a Course since Archived", async () => {
    const s = await student();
    const r = await agentRun(s, { createStudyBlocks: "always" });
    const taskId = randomUUID();
    await admin.task.create({
      data: {
        id: taskId,
        studentId: s.studentId,
        title: "Bewerbung schreiben",
      },
    });
    const g = gate(fakeExecutor().executor, {}, rules().planRules);

    expect(
      await g.perform(r.p, { key: `${r.runId}:1`, intent: create(s, taskId) }),
    ).toMatchObject({ status: "refused", reason: "out_of_scope" });
    await admin.course.update({
      where: { id: s.courseId },
      data: { archivedAt: now },
    });
    expect(
      await g.perform(r.p, { key: `${r.runId}:2`, intent: create(s) }),
    ).toMatchObject({ status: "refused", reason: "out_of_scope" });
  });

  it("refuses an approved Action for a Course removed from the Agent since it asked", async () => {
    const s = await student();
    const r = await agentRun(s, { createStudyBlocks: "ask" });
    const { executor, dispatched } = fakeExecutor();
    const g = gate(executor, {}, rules().planRules);
    const key = `${r.runId}:1`;
    const asking = await g.perform(r.p, { key, intent: create(s) });
    if (asking.status !== "awaiting_approval") throw new Error(asking.status);
    await admin.agentCourse.deleteMany({ where: { agentId: r.agentId } });
    await g.decide(s.p, {
      kind: "approve",
      actionId: asking.actionId,
      fingerprint: asking.fingerprint,
    });

    expect(await g.perform(r.p, { key, intent: create(s) })).toMatchObject({
      status: "refused",
      reason: "out_of_scope",
    });
    expect(dispatched).toEqual([]);
  });

  it("moves its own block on Automatisch, and asks to move a block it did not create", async () => {
    const s = await student();
    const r = await agentRun(s, {
      moveOwnStudyBlocks: "automatic",
      moveStudyBlocks: "ask",
    });
    const later = {
      start: new Date("2026-11-12T09:00:00Z"),
      end: new Date("2026-11-12T10:00:00Z"),
    };
    await admin.studyBlock.update({
      where: { id: s.blockId },
      data: { ...later, createdByAgentId: r.agentId },
    });
    const othersId = randomUUID();
    await admin.studyBlock.create({
      data: {
        id: othersId,
        studentId: s.studentId,
        obligationId: s.obligationId,
        placedBy: "nunio",
        start: new Date("2026-11-13T09:00:00Z"),
        end: new Date("2026-11-13T10:00:00Z"),
      },
    });
    const g = gate(fakeExecutor().executor, {}, rules().planRules);

    expect(
      await g.perform(r.p, { key: `${r.runId}:1`, intent: move(s) }),
    ).toMatchObject({ status: "done" });
    expect(
      await g.perform(r.p, {
        key: `${r.runId}:2`,
        intent: move({ blockId: othersId }, 16),
      }),
    ).toMatchObject({ status: "awaiting_approval" });
  });

  it("refuses what the Plan's rules refuse, without asking, on any mode", async () => {
    const s = await student();
    const r = await agentRun(s, { createStudyBlocks: "ask" });
    const g = gate(
      fakeExecutor().executor,
      {},
      rules({ refusals: ["fixed_event"], brokenPreferences: [] }).planRules,
    );

    expect(
      await g.perform(r.p, { key: `${r.runId}:1`, intent: create(s) }),
    ).toMatchObject({ status: "refused", reason: "fixed_event" });
  });

  it("notes the Preferences an Action breaks on Immer erlaubt", async () => {
    const s = await student();
    const r = await agentRun(s, { createStudyBlocks: "always" });
    const g = gate(
      fakeExecutor().executor,
      {},
      rules({ refusals: [], brokenPreferences: ["daily_limit"] }).planRules,
    );

    const done = await g.perform(r.p, {
      key: `${r.runId}:1`,
      intent: create(s),
    });

    expect(done).toMatchObject({ status: "done" });
    const [record] = await g.history(s.p, { runId: r.runId });
    expect(record!.events.find((e) => e.type === "dispatched")).toMatchObject({
      detail: { brokenPreferences: ["daily_limit"] },
    });
  });
  describe("Tasks (#154)", () => {
    const task = (
      args: Partial<{
        courseId: string | null;
        obligationId: string;
        fixedEventId: string;
        role: "preparation" | "follow_up";
      }>,
    ) => ({
      kind: "task.create" as const,
      title: "Thema X wiederholen",
      courseId: null,
      fixedEventId: null,
      role: null,
      estimateMinutes: 45,
      ...args,
    });
    /** A Course Event of the Course, from a confirmed series. */
    async function courseEvent(studentId: string, courseId: string) {
      const calendarId = randomUUID(),
        seriesId = randomUUID(),
        eventId = randomUUID();
      await admin.calendarSource.create({
        data: { id: calendarId, studentId, name: "Stundenplan.ics" },
      });
      await admin.eventSeries.create({
        data: {
          id: seriesId,
          studentId,
          calendarId,
          title: `Vorlesung ${seriesId}`,
          courseId,
          confirmedAt: now,
        },
      });
      await admin.fixedEvent.create({
        data: {
          id: eventId,
          studentId,
          calendarId,
          seriesId,
          title: "Vorlesung",
          start: new Date("2026-11-12T10:00:00Z"),
          end: new Date("2026-11-12T12:00:00Z"),
        },
      });
      return eventId;
    }

    it("creates a Task in its Course, toward one of its Obligations, and for one of its Course Events on Automatisch", async () => {
      const s = await student();
      const r = await agentRun(s, { createTasks: "automatic" });
      const eventId = await courseEvent(s.studentId, s.courseId);
      const { executor, dispatched } = fakeExecutor();
      const g = gate(executor, {}, rules().planRules);
      const intents = [
        task({ courseId: s.courseId }),
        task({ obligationId: s.obligationId }),
        task({
          courseId: s.courseId,
          fixedEventId: eventId,
          role: "preparation",
        }),
      ];

      for (const [i, intent] of intents.entries())
        expect(
          await g.perform(r.p, { key: `${r.runId}:1:${i + 1}`, intent }),
        ).toMatchObject({ status: "done" });
      expect(dispatched.map((d) => d.intent)).toEqual(intents);
    });

    it("asks on Nachfragen", async () => {
      const s = await student();
      const r = await agentRun(s, { createTasks: "ask" });

      expect(
        await gate(fakeExecutor().executor, {}, rules().planRules).perform(
          r.p,
          { key: `${r.runId}:1:1`, intent: task({ courseId: s.courseId }) },
        ),
      ).toMatchObject({ status: "awaiting_approval" });
    });

    it("asks on Automatisch for a Task due within the next 24 hours", async () => {
      const s = await student();
      const r = await agentRun(s, { createTasks: "automatic" });
      const eventId = await courseEvent(s.studentId, s.courseId);
      const soon = new Date(now.getTime() + 20 * hour);
      const g = gate(
        fakeExecutor().executor,
        { [s.obligationId]: soon },
        rules(undefined, soon).planRules,
      );

      expect(
        await g.perform(r.p, {
          key: `${r.runId}:1:1`,
          intent: task({ obligationId: s.obligationId }),
        }),
      ).toMatchObject({ status: "awaiting_approval" });
      expect(
        await g.perform(r.p, {
          key: `${r.runId}:1:2`,
          intent: task({
            courseId: s.courseId,
            fixedEventId: eventId,
            role: "preparation",
          }),
        }),
      ).toMatchObject({ status: "awaiting_approval" });
    });

    it("refuses a Task in no Course, in another Course, toward another Course's Obligation, or for another Course's event", async () => {
      const s = await student();
      const other = await student();
      // The other Course is the same student's, just not one of the Agent's.
      const otherCourseId = randomUUID(),
        otherObligationId = randomUUID();
      await admin.course.create({
        data: {
          id: otherCourseId,
          studentId: s.studentId,
          title: "Lineare Algebra",
          matchTitle: "lineare algebra",
          semester: "2026-ws",
          color: "sky",
          status: "accepted",
        },
      });
      await admin.obligation.create({
        data: {
          id: otherObligationId,
          studentId: s.studentId,
          courseId: otherCourseId,
          matchKey: "sheet-1",
          kind: "assignment",
          enteredAt: now,
          correctedTitle: "Blatt 1",
        },
      });
      const otherEventId = await courseEvent(s.studentId, otherCourseId);
      const r = await agentRun(s, { createTasks: "always" });
      const { executor, dispatched } = fakeExecutor();
      const g = gate(executor, {}, rules().planRules);
      const intents = [
        task({}),
        task({ courseId: otherCourseId }),
        task({ obligationId: otherObligationId }),
        // Named with the Agent's Course, but the event is another Course's.
        task({
          courseId: s.courseId,
          fixedEventId: otherEventId,
          role: "follow_up",
        }),
      ];

      for (const [i, intent] of intents.entries())
        expect(
          await g.perform(r.p, { key: `${r.runId}:1:${i + 1}`, intent }),
        ).toMatchObject({ status: "refused", reason: "out_of_scope" });
      expect(
        await g.perform(r.p, {
          key: `${r.runId}:2:1`,
          intent: task({ obligationId: other.obligationId }),
        }),
      ).toMatchObject({ status: "refused", reason: "not_owner" });
      expect(dispatched).toEqual([]);
    });
  });
});
