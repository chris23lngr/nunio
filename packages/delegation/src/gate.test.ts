import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ActionOutcome, Delegation, Executor } from "./index.js";
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
): Delegation {
  return createDelegation({
    db: runtime,
    aiEnabled: () => true,
    clock,
    executors: { plan: executor },
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

/** A Run of a Responsibility holding the given Grants on the student's Course. */
async function run(
  s: Awaited<ReturnType<typeof student>>,
  { grants = ["studyBlock.create", "studyBlock.move"] as string[] } = {},
) {
  const responsibilityId = randomUUID(),
    runId = randomUUID();
  await admin.responsibility.create({
    data: {
      id: responsibilityId,
      studentId: s.studentId,
      preset: "keep_course_organized",
      budgetMicroUsd: 100_000,
    },
  });
  await admin.grant.createMany({
    data: grants.map((kind) => ({
      id: randomUUID(),
      studentId: s.studentId,
      responsibilityId,
      kind,
      courseId: s.courseId,
    })),
  });
  await admin.run.create({
    data: { id: runId, studentId: s.studentId, responsibilityId },
  });
  return { responsibilityId, runId, p: principal.fromRun(runId) };
}

const move = (s: { blockId: string }, startHour = 14) => ({
  kind: "studyBlock.move" as const,
  studyBlockId: s.blockId,
  start: new Date(Date.UTC(2026, 10, 11, startHour)),
  end: new Date(Date.UTC(2026, 10, 11, startHour + 1)),
});

describe("perform", () => {
  it("acts at once on a Grant of the Run's Responsibility that covers the Action", async () => {
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
  it("stops the next Action once the Responsibility is Paused between two", async () => {
    const s = await student();
    const r = await run(s);
    const { executor, dispatched } = fakeExecutor();
    const g = gate(executor);

    expect(
      await g.perform(r.p, { key: `${r.runId}:1`, intent: move(s, 14) }),
    ).toMatchObject({ status: "done" });
    await admin.responsibility.update({
      where: { id: r.responsibilityId },
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
          await tx.responsibility.update({
            where: { id: r.responsibilityId },
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
              where: { responsibilityId: r.responsibilityId },
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

  it("stops a Run whose Responsibility Ended", async () => {
    const s = await student();
    const r = await run(s);
    await admin.responsibility.update({
      where: { id: r.responsibilityId },
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
    await admin.responsibility.update({
      where: { id: asking.responsibilityId },
      data: { restrictions: { alwaysAsk: ["studyBlock.move"] } },
    });
    const ungranted = await run(s, { grants: [] });
    await admin.responsibility.update({
      where: { id: ungranted.responsibilityId },
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
    await admin.responsibility.update({
      where: { id: r.responsibilityId },
      data: { state: "paused", pausedBy: "student" },
    });
    await g.perform(r.p, { key: `${r.runId}:2`, intent: move(s, 16) });

    const history = await g.history(s.p, {
      responsibilityId: r.responsibilityId,
    });

    const grant = await admin.grant.findFirstOrThrow({
      where: { responsibilityId: r.responsibilityId, kind: "studyBlock.move" },
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

  it("charges a Run's model call to its Responsibility's Budget and to the Allowance", async () => {
    const s = await student();
    const r = await run(s);
    const g = gate(fakeExecutor().executor);

    expect(await g.meter(r.p, { microUsd: 3_000 }, call(1_200))).toMatchObject({
      status: "ok",
    });

    expect(
      await admin.responsibility.findUniqueOrThrow({
        where: { id: r.responsibilityId },
      }),
    ).toMatchObject({ usedMicroUsd: 1_200n, heldMicroUsd: 0n });
    expect(await g.allowance(s.p)).toEqual({
      limitMicroUsd: 1_000_000,
      usedMicroUsd: 1_200,
      heldMicroUsd: 0,
    });
  });

  it("pauses the Responsibility and asks once its Budget would be exceeded, never drawing further on the Allowance", async () => {
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
    // The first call over Budget pauses the Responsibility; the calls after it find it Paused.
    const refusals = results
      .flatMap((result) => (result.status === "refused" ? [result.reason] : []))
      .sort();
    expect(refusals).toEqual([
      "budget_exhausted",
      "paused",
      "paused",
      "paused",
      "paused",
    ]);
    expect(calls).toBe(10);
    expect(
      await admin.responsibility.findUniqueOrThrow({
        where: { id: r.responsibilityId },
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

  it("refuses a model call in a Paused Responsibility's Run", async () => {
    const s = await student();
    const r = await run(s);
    await admin.responsibility.update({
      where: { id: r.responsibilityId },
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
