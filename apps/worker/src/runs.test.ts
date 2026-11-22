import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Executor, PlanRules } from "@nunio/delegation";
import { createAgents, createDelegation, principal } from "@nunio/delegation";
import { workflowAlive } from "@nunio/delegation/temporal-schedules";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { WorkflowBundle } from "@temporalio/worker";
import { bundleWorkflowCode, Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureReconcileSchedule } from "./reconcile-schedule.js";
import { createRunActivities } from "./run-activities.js";

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

const clock = { now: () => new Date() };
/** The Plan's rules, refusing nothing an Agent's Study Block Action does. */
const planRules: PlanRules = {
  check: async () => ({ refusals: [], brokenPreferences: [] }),
  taskDue: async () => null,
};

/** A student with one Course and one Obligation in it, and an Agent that creates Study Blocks on Immer erlaubt. */
async function student() {
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
      enteredAt: new Date(),
      correctedTitle: "Problem sheet 1",
    },
  });
  const p = principal.fromSession({ studentId });
  const agents = createAgents({
    db: runtime,
    schedules: { save: async () => {}, delete: async () => {} },
    clock,
  });
  const created = await agents.create(p, {
    name: "Analysis organisieren",
    description: "",
    emoji: "📚",
    instructions: "Halte Analysis I organisiert.",
    courseIds: [courseId],
    capabilities: [{ id: "createStudyBlocks", mode: "always" }],
    budgetMicroUsd: 50_000,
    trigger: { rhythm: "daily", minute: 360 },
    modelKey: "sonnet-5.5-reasoning-high",
  });
  if (created.status !== "ok") throw new Error(created.status);
  return { studentId, obligationId, p, agentId: created.id, agents };
}

describe("reconciliation", () => {
  it("confirms a dispatch a dead worker left in flight, through the executor's lookup", async () => {
    const s = await student();
    const runId = (await s.agents.startRun({
      runId: randomUUID(),
      workflowId: "run-workflow",
      studentId: s.studentId,
      agentId: s.agentId,
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
      planRules,
    }).perform(principal.fromRun(runId), {
      key: `${runId}:1:1`,
      intent: {
        kind: "studyBlock.create",
        workId: s.obligationId,
        start: new Date(Date.UTC(2099, 11, 2, 14)),
        end: new Date(Date.UTC(2099, 11, 2, 15)),
      },
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
        delegation,
        agents: createAgents({ db: runtime, clock: later }),
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

describe("reconciling Agents' Runs", () => {
  it("ends as failed, across students, the Runs under way over ten minutes whose workflow is gone", async () => {
    const [gone, otherGone, alive, fresh] = await Promise.all([
      student(),
      student(),
      student(),
      student(),
    ]);
    const start = async (
      s: Awaited<ReturnType<typeof student>>,
      workflowId: string,
    ) =>
      (await s.agents.startRun({
        runId: randomUUID(),
        workflowId,
        studentId: s.studentId,
        agentId: s.agentId,
      }))!;
    // Nothing polls its task queue, so its workflow runs on.
    const aliveWorkflowId = `agentRun/${alive.agentId}-${randomUUID()}`;
    const aliveWorkflow = await env.client.workflow.start("agentRun", {
      taskQueue: "nobody-polls",
      workflowId: aliveWorkflowId,
    });
    const runs = {
      gone: await start(gone, `agentRun/${gone.agentId}-${randomUUID()}`),
      otherGone: await start(
        otherGone,
        `agentRun/${otherGone.agentId}-${randomUUID()}`,
      ),
      alive: await start(alive, aliveWorkflowId),
      fresh: await start(fresh, `agentRun/${fresh.agentId}-${randomUUID()}`),
    };
    await admin.run.updateMany({
      where: { id: { in: [runs.gone, runs.otherGone, runs.alive] } },
      data: { startedAt: new Date(Date.now() - 11 * 60_000) },
    });

    const reconciler = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle,
      activities: createRunActivities({
        delegation: createDelegation({
          db: runtime,
          aiEnabled: () => true,
          clock,
        }),
        agents: createAgents({
          db: runtime,
          clock,
          runAlive: workflowAlive(env.client),
        }),
      }),
    });
    await reconciler.runUntil(
      env.client.workflow.execute("reconcileActions", {
        taskQueue,
        workflowId: `reconcile-${randomUUID()}`,
      }),
    );
    await aliveWorkflow.terminate();

    const statusOf = async (id: string) =>
      (await admin.run.findUniqueOrThrow({ where: { id } })).status;
    expect({
      gone: await statusOf(runs.gone),
      otherGone: await statusOf(runs.otherGone),
      alive: await statusOf(runs.alive),
      fresh: await statusOf(runs.fresh),
    }).toEqual({
      gone: "failed",
      otherGone: "failed",
      alive: "running",
      fresh: "running",
    });
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
