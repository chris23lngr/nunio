import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { ActionIntent, Executor } from "@nunio/delegation";
import {
  createDelegation,
  createResponsibilities,
  InvalidIntentError,
  principal,
} from "@nunio/delegation";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { WorkflowBundle } from "@temporalio/worker";
import { bundleWorkflowCode, Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDecisionNotifier } from "./decision-notifier.js";
import { ensureReconcileSchedule } from "./reconcile-schedule.js";
import { createRunActivities } from "./run-activities.js";
import { approvalDecidedSignal } from "./workflows.js";

const taskQueue = "runs-test";
let env: TestWorkflowEnvironment;
let workflowBundle: WorkflowBundle;
let db: TestDatabase;
/** Seeds fixtures as the migration role, outside RLS. */
let admin: PrismaClient;
/** Connects as the restricted runtime role, as the worker does. */
let runtime: PrismaClient;

beforeAll(async () => {
  [env, workflowBundle, db] = await Promise.all([
    TestWorkflowEnvironment.createLocal(),
    bundleWorkflowCode({
      workflowsPath: new URL("./workflows.ts", import.meta.url).pathname,
    }),
    startTestDatabase(),
  ]);
  admin = createPrismaClient(createPool(db.connectionString));
  runtime = createPrismaClient(createPool(db.runtimeConnectionString));
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await Promise.all([env?.teardown(), db?.stop()]);
});

/** A fake Plan executor that records each dispatch. */
function fakeExecutor() {
  const dispatched: string[] = [];
  const executor: Executor = {
    async execute(_, { idempotencyKey }) {
      dispatched.push(idempotencyKey);
      return { status: "done", effect: { studyBlockId: idempotencyKey } };
    },
    async lookup() {
      return { status: "unknown" };
    },
  };
  return { executor, dispatched };
}

const noSchedules = {
  create: async () => {},
  pause: async () => {},
  unpause: async () => {},
  delete: async () => {},
};
const clock = { now: () => new Date() };

/** A student with one Course, one Obligation in it, blocks nunio or the student placed, and "keep this course organized". */
async function student({
  placedBy = "nunio" as "nunio" | "student",
  blocks = 1,
} = {}) {
  const studentId = randomUUID(),
    courseId = randomUUID(),
    obligationId = randomUUID();
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
      enteredAt: new Date(),
      correctedTitle: "Problem sheet 1",
    },
  });
  const blockIds = Array.from({ length: blocks }, () => randomUUID());
  for (const [i, id] of blockIds.entries()) {
    await admin.studyBlock.create({
      data: {
        id,
        studentId,
        obligationId,
        placedBy,
        start: new Date(Date.UTC(2026, 11, 1, 9 + i)),
        end: new Date(Date.UTC(2026, 11, 1, 10 + i)),
      },
    });
  }
  const p = principal.fromSession({ studentId });
  const responsibilities = createResponsibilities({
    db: runtime,
    schedules: noSchedules,
    clock,
  });
  const created = await responsibilities.create(p, {
    preset: "keep_course_organized",
    courseId,
    budgetMicroUsd: 50_000,
  });
  if (created.status !== "ok") throw new Error(created.status);
  return {
    studentId,
    obligationId,
    blockIds,
    p,
    responsibilityId: created.id,
    responsibilities,
  };
}

const moveTo = (blockId: string, day: number): ActionIntent => ({
  kind: "studyBlock.move",
  studyBlockId: blockId,
  start: new Date(Date.UTC(2026, 11, day, 14)),
  end: new Date(Date.UTC(2026, 11, day, 15)),
});

/** A worker running the Run workflow with real Run activities over the given gate and proposal. */
async function worker(
  s: Awaited<ReturnType<typeof student>>,
  executor: Executor,
  intents: ActionIntent[],
  deadline?: Date,
) {
  const delegation = createDelegation({
    db: runtime,
    aiEnabled: () => true,
    clock,
    executors: { plan: executor },
    deadlineOf: async () => deadline ?? null,
  });
  return Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowBundle,
    activities: createRunActivities({
      db: runtime,
      delegation,
      notifyDecision: createDecisionNotifier(env.client),
      responsibilities: s.responsibilities,
      propose: async () => intents,
    }),
  });
}

describe("a Responsibility's Run", () => {
  it("performs each Action its Grants cover, once", async () => {
    const s = await student({ blocks: 2 });
    const { executor, dispatched } = fakeExecutor();

    const result = await (
      await worker(s, executor, [
        moveTo(s.blockIds[0]!, 2),
        moveTo(s.blockIds[1]!, 3),
      ])
    ).runUntil(
      env.client.workflow.execute("responsibilityRun", {
        taskQueue,
        workflowId: `run-${randomUUID()}`,
        args: [
          { studentId: s.studentId, responsibilityId: s.responsibilityId },
        ],
      }),
    );

    expect(result).toEqual({ status: "done" });
    expect(dispatched).toHaveLength(2);
  });

  it("reuses the Run after startup commits but its Activity completion is lost", async () => {
    const s = await student();
    const start = s.responsibilities.startRun;
    let calls = 0;
    s.responsibilities.startRun = async (ref) => {
      const id = await start(ref);
      if (++calls === 1) throw new Error("lost Activity completion");
      return id;
    };
    const { executor } = fakeExecutor();
    expect(
      await (await worker(s, executor, [])).runUntil(
        env.client.workflow.execute("responsibilityRun", {
          taskQueue,
          workflowId: `retry-start-${randomUUID()}`,
          args: [
            { studentId: s.studentId, responsibilityId: s.responsibilityId },
          ],
        }),
      ),
    ).toEqual({ status: "done" });
    expect(calls).toBe(2);
    expect(
      await admin.run.count({
        where: { responsibilityId: s.responsibilityId },
      }),
    ).toBe(1);
  });

  it("consumes an Approval signal received before the Activity reply", async () => {
    const workflowId = `early-approval-${randomUUID()}`;
    let calls = 0;
    const w = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle,
      activities: {
        startRun: async () => "early-run",
        proposeActions: async () => [moveTo("block", 2)],
        performAction: async () => {
          if (++calls === 1) {
            await env.client.workflow
              .getHandle(workflowId)
              .signal(approvalDecidedSignal, "early-action");
            return {
              status: "awaiting_approval",
              actionId: "early-action",
              fingerprint: "fp",
              expiresAt: "2099-01-01T00:00:00Z",
            };
          }
          return { status: "done", actionId: "early-action", effect: {} };
        },
      },
    });
    expect(
      await w.runUntil(
        env.client.workflow.execute("responsibilityRun", {
          taskQueue,
          workflowId,
          workflowExecutionTimeout: "4 seconds",
          args: [{ studentId: "student", responsibilityId: "responsibility" }],
        }),
      ),
    ).toEqual({ status: "done" });
    expect(calls).toBe(2);
  });

  it("does not retry invalid Action intents", async () => {
    let calls = 0;
    const w = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle,
      activities: {
        startRun: async () => "invalid-run",
        proposeActions: async () => [moveTo("block", 2)],
        performAction: async () => {
          calls++;
          throw new InvalidIntentError("invalid");
        },
      },
    });
    await expect(
      w.runUntil(
        env.client.workflow.execute("responsibilityRun", {
          taskQueue,
          workflowId: `invalid-${randomUUID()}`,
          workflowExecutionTimeout: "7 seconds",
          args: [{ studentId: "student", responsibilityId: "responsibility" }],
        }),
      ),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("waits for the student's Approval, then acts once the API signals their decision", async () => {
    const s = await student({ placedBy: "student" });
    const { executor, dispatched } = fakeExecutor();
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
    });

    const result = await (
      await worker(s, executor, [moveTo(s.blockIds[0]!, 2)])
    ).runUntil(async () => {
      const handle = await env.client.workflow.start("responsibilityRun", {
        taskQueue,
        workflowId: `run-${randomUUID()}`,
        args: [
          { studentId: s.studentId, responsibilityId: s.responsibilityId },
        ],
      });
      const asking = await awaitingApproval(s.p);
      await gate.decide(s.p, {
        kind: "approve",
        actionId: asking.id,
        fingerprint: asking.approval!.fingerprint,
      });
      await handle.signal(approvalDecidedSignal, asking.id);
      return handle.result();
    });

    expect(result).toEqual({ status: "done" });
    expect(dispatched).toHaveLength(1);
  });
});

describe("a Pause during a Run", () => {
  it("stops the next Action and ends the Run", async () => {
    const s = await student({ blocks: 2 });
    await admin.studyBlock.update({
      where: { id: s.blockIds[0]! },
      data: { placedBy: "student" },
    });
    const { executor, dispatched } = fakeExecutor();

    const result = await (
      await worker(s, executor, [
        moveTo(s.blockIds[0]!, 2),
        moveTo(s.blockIds[1]!, 3),
      ])
    ).runUntil(async () => {
      const handle = await env.client.workflow.start("responsibilityRun", {
        taskQueue,
        workflowId: `run-${randomUUID()}`,
        args: [
          { studentId: s.studentId, responsibilityId: s.responsibilityId },
        ],
      });
      const asking = await awaitingApproval(s.p);
      await s.responsibilities.pause(s.p, s.responsibilityId);
      await handle.signal(approvalDecidedSignal, asking.id);
      return handle.result();
    });

    expect(result).toEqual({ status: "stopped", reason: "paused" });
    expect(dispatched).toEqual([]);
  });
});

describe("an Action nobody can confirm", () => {
  it("is never retried: the Run raises an Intervention and ends", async () => {
    const s = await student({ blocks: 2 });
    const dispatched: string[] = [];
    const ambiguous: Executor = {
      async execute(_, { idempotencyKey }) {
        dispatched.push(idempotencyKey);
        return { status: "ambiguous" };
      },
      async lookup() {
        return { status: "unknown" };
      },
    };

    const result = await (
      await worker(s, ambiguous, [
        moveTo(s.blockIds[0]!, 2),
        moveTo(s.blockIds[1]!, 3),
      ])
    ).runUntil(
      env.client.workflow.execute("responsibilityRun", {
        taskQueue,
        workflowId: `run-${randomUUID()}`,
        args: [
          { studentId: s.studentId, responsibilityId: s.responsibilityId },
        ],
      }),
    );

    expect(result).toEqual({ status: "stopped", reason: "unconfirmed" });
    expect(dispatched).toHaveLength(1);
    expect(
      await admin.intervention.findMany({
        where: { studentId: s.studentId },
        select: { kind: true },
      }),
    ).toEqual([{ kind: "unconfirmed" }]);
  });
});

describe("an unanswered request for Approval", () => {
  it("expires at the Obligation's deadline, takes no Action, and raises one Intervention", async () => {
    const s = await student({ placedBy: "student" });
    const { executor, dispatched } = fakeExecutor();
    const deadline = new Date(Date.now() + 3_000);

    const result = await (
      await worker(s, executor, [moveTo(s.blockIds[0]!, 2)], deadline)
    ).runUntil(
      env.client.workflow.execute("responsibilityRun", {
        taskQueue,
        workflowId: `run-${randomUUID()}`,
        args: [
          { studentId: s.studentId, responsibilityId: s.responsibilityId },
        ],
      }),
    );

    expect(result).toEqual({ status: "done" });
    expect(dispatched).toEqual([]);
    const [action] = await createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
    }).history(s.p, {});
    expect(action).toMatchObject({
      status: "refused",
      refusal: "approval_expired",
    });
    // Phase 10's inbox will read Interventions; until then the record itself is what can be observed.
    expect(
      await admin.intervention.findMany({
        where: { studentId: s.studentId },
        select: { kind: true, actionId: true },
      }),
    ).toEqual([{ kind: "approval_expired", actionId: action!.id }]);
  });
});

describe("repeated Approval clicks", () => {
  it("dispatch the Action once", async () => {
    const s = await student({ placedBy: "student" });
    const { executor, dispatched } = fakeExecutor();
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
    });

    const result = await (
      await worker(s, executor, [moveTo(s.blockIds[0]!, 2)])
    ).runUntil(async () => {
      const handle = await env.client.workflow.start("responsibilityRun", {
        taskQueue,
        workflowId: `run-${randomUUID()}`,
        args: [
          { studentId: s.studentId, responsibilityId: s.responsibilityId },
        ],
      });
      const asking = await awaitingApproval(s.p);
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          await gate.decide(s.p, {
            kind: "approve",
            actionId: asking.id,
            fingerprint: asking.approval!.fingerprint,
          });
          await handle.signal(approvalDecidedSignal, asking.id);
        }),
      );
      return handle.result();
    });

    expect(result).toEqual({ status: "done" });
    expect(dispatched).toHaveLength(1);
  });
});

describe("a worker restart while a Run awaits Approval", () => {
  it("loses neither the Approval nor the continuation", {
    timeout: 90_000,
  }, async () => {
    const s = await student({ placedBy: "student" });
    const { executor, dispatched } = fakeExecutor();
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
    });
    const workflowId = `run-${randomUUID()}`;

    // The first worker stops for good while the Run waits.
    const asking = await (
      await worker(s, executor, [moveTo(s.blockIds[0]!, 2)])
    ).runUntil(async () => {
      await env.client.workflow.start("responsibilityRun", {
        taskQueue,
        workflowId,
        args: [
          { studentId: s.studentId, responsibilityId: s.responsibilityId },
        ],
      });
      return awaitingApproval(s.p);
    });
    await gate.decide(s.p, {
      kind: "approve",
      actionId: asking.id,
      fingerprint: asking.approval!.fingerprint,
    });
    await env.client.workflow
      .getHandle(workflowId)
      .signal(approvalDecidedSignal, asking.id);

    // A new worker, as after a deploy, picks the Run up where it waited.
    const result = await (
      await worker(s, executor, [moveTo(s.blockIds[0]!, 2)])
    ).runUntil(env.client.workflow.getHandle(workflowId).result());

    expect(result).toEqual({ status: "done" });
    expect(dispatched).toHaveLength(1);
  });
});

describe("reconciliation", () => {
  it("retires a pending wake for an ended execution without signalling its replacement", async () => {
    const workflowId = `ended-decision-${randomUUID()}`;
    const old = await env.client.workflow.start("responsibilityRun", {
      taskQueue,
      workflowId,
      args: [{}],
    });
    await old.terminate();
    const replacement = await env.client.workflow.start("responsibilityRun", {
      taskQueue,
      workflowId,
      args: [{}],
    });
    try {
      await createDecisionNotifier(env.client)({
        workflowId,
        runId: old.firstExecutionRunId,
        actionId: "old-action",
      });
      const history = await replacement.fetchHistory();
      expect(
        history.events?.filter(
          (e) => e.workflowExecutionSignaledEventAttributes,
        ),
      ).toEqual([]);
    } finally {
      await replacement.terminate();
    }
  });

  it("wakes a denied Run after the API stops before delivering its decision signal", async () => {
    const s = await student({ placedBy: "student" });
    const { executor, dispatched } = fakeExecutor();
    const gate = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
    });
    await (await worker(s, executor, [moveTo(s.blockIds[0]!, 2)])).runUntil(
      async () => {
        const handle = await env.client.workflow.start("responsibilityRun", {
          taskQueue,
          workflowId: `lost-decision-${randomUUID()}`,
          args: [
            { studentId: s.studentId, responsibilityId: s.responsibilityId },
          ],
        });
        try {
          const asking = await awaitingApproval(s.p);
          // The API commits, then dies before it can make any Temporal call.
          await gate.decide(s.p, { kind: "deny", actionId: asking.id });
          expect(
            await gate.history(s.p, { status: "awaiting_approval" }),
          ).toEqual([]);
          await env.client.workflow.execute("reconcileActions", {
            taskQueue,
            workflowId: `recover-decision-${randomUUID()}`,
          });
          await expect
            .poll(async () => (await handle.describe()).status.name, {
              timeout: 3_000,
            })
            .toBe("COMPLETED");
          expect(await handle.result()).toEqual({ status: "done" });
          expect(dispatched).toEqual([]);
        } finally {
          if ((await handle.describe()).status.name === "RUNNING")
            await handle.terminate();
        }
      },
    );
  });

  it("confirms a dispatch a dead worker left in flight, through the executor's lookup", async () => {
    const s = await student();
    const runId = (await s.responsibilities.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      responsibilityId: s.responsibilityId,
    }))!;
    const hung: Executor = {
      execute: () => new Promise(() => {}), // The worker dies mid-call: no answer ever comes.
      async lookup(key) {
        return { status: "found", effect: { studyBlockId: key } };
      },
    };
    void createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock,
      executors: { plan: hung },
    }).perform(principal.fromRun(runId), {
      key: `${runId}:1`,
      intent: moveTo(s.blockIds[0]!, 2),
    });
    await expect
      .poll(() =>
        admin.attempt.count({
          where: { studentId: s.studentId, status: "in_flight" },
        }),
      )
      .toBe(1);

    // An hour later, the reconcile Schedule fires.
    const later = { now: () => new Date(Date.now() + 60 * 60_000) };
    const delegation = createDelegation({
      db: runtime,
      aiEnabled: () => true,
      clock: later,
      executors: { plan: hung },
    });
    const reconciler = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle,
      activities: createRunActivities({
        db: runtime,
        delegation,
        notifyDecision: createDecisionNotifier(env.client),
        responsibilities: s.responsibilities,
        propose: async () => [],
      }),
    });
    await reconciler.runUntil(
      env.client.workflow.execute("reconcileActions", {
        taskQueue,
        workflowId: `reconcile-${randomUUID()}`,
      }),
    );

    expect(await delegation.history(s.p, {})).toMatchObject([
      { status: "done" },
    ]);
  });
});

describe("the reconcile Schedule", () => {
  it("starts reconcileActions every five minutes, and is created only once however often the worker starts", async () => {
    await ensureReconcileSchedule(env.client, taskQueue);
    await ensureReconcileSchedule(env.client, taskQueue);

    const described = await env.client.schedule
      .getHandle("reconcile-actions")
      .describe();
    expect(described.spec.intervals).toMatchObject([{ every: 5 * 60_000 }]);
    expect(described.action).toMatchObject({
      type: "startWorkflow",
      workflowType: "reconcileActions",
      taskQueue,
    });
  });
});

/** The Action the Run asked the student about, once it has asked. */
async function awaitingApproval(p: ReturnType<typeof principal.fromSession>) {
  const gate = createDelegation({ db: runtime, aiEnabled: () => true, clock });
  let found: Awaited<ReturnType<typeof gate.history>>[number] | undefined;
  await expect
    .poll(
      async () => {
        found = (await gate.history(p, {})).find(
          (a) => a.status === "awaiting_approval",
        );
        return Boolean(found);
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found!;
}
