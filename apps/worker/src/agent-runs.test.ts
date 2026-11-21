import { randomBytes, randomUUID } from "node:crypto";
import type { Embedder } from "@nunio/ai";
import { createAgentModel, createModels } from "@nunio/ai";
import type { Activity, AgentRuns } from "@nunio/chat";
import { createActivity, createAgentRuns } from "@nunio/chat";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type {
  AgentCapability,
  CatalogModel,
  Executor,
} from "@nunio/delegation";
import {
  capabilities,
  createAgents,
  createDelegation,
  principal,
} from "@nunio/delegation";
import { workflowAlive } from "@nunio/delegation/temporal-schedules";
import { createSourceKeys } from "@nunio/keys";
import {
  createFacts,
  createKnowledgeReader,
  createSources,
} from "@nunio/knowledge";
import type { Outreach } from "@nunio/outreach";
import { createOutreach } from "@nunio/outreach";
import { createPlan, createPlanExecutor, planRules } from "@nunio/planning";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { WorkflowBundle } from "@temporalio/worker";
import { bundleWorkflowCode, Worker } from "@temporalio/worker";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentRunActivities } from "./agent-run-activities.js";

const taskQueue = "agent-runs-test";
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
let env: TestWorkflowEnvironment;
let workflowBundle: WorkflowBundle;
let db: TestDatabase;
/** Seeds fixtures as the migration role, outside RLS. */
let admin: PrismaClient;
/** Connects as the restricted runtime role, as the worker does. */
let runtime: PrismaClient;
let runs: AgentRuns;
let activity: Activity;
let outreach: Outreach;
let agents: ReturnType<typeof createAgents>;
let sources: ReturnType<typeof createSources>;

const clock = { now: () => new Date() };
const keys = createSourceKeys({
  activeVersion: "test",
  masters: { test: randomBytes(32) },
});
/** One dimension per keyword, so a query finds the passages that share it. */
const embedder: Embedder = {
  model: "test-embedding",
  dims: 2,
  relevanceFloor: 0.3,
  estimateMicroUsd: () => 1,
  embed: async (texts) => ({
    vectors: texts.map((t) => [
      t.toLowerCase().includes("klausur") ? 1 : 0,
      0.01,
    ]),
    usage: { microUsd: 1 },
  }),
};
const sonnet: CatalogModel = {
  key: "sonnet-5.5-reasoning-high",
  providerModelId: "anthropic/claude-sonnet-5.5",
  reasoningEffort: "high",
  maxOutputTokens: 8_000,
  prices: [
    {
      minPromptTokens: 0,
      inputMicroUsdPerMTok: 2_000_000,
      outputMicroUsdPerMTok: 10_000_000,
    },
  ],
  upstream: ["Amazon Bedrock"],
  name: "Sonnet 5.5",
  provider: "Anthropic",
  description: "",
  chatDefault: true,
};
const haiku: CatalogModel = {
  ...sonnet,
  key: "haiku-5.5-reasoning-high",
  providerModelId: "anthropic/claude-haiku-5.5",
  name: "Haiku 5.5",
  chatDefault: false,
};
/** The Models Chat offers now; a Run's Model must stay among them. */
let offered: CatalogModel[] = [];
/** The Model each step ran on, by key. */
const ranOn: string[] = [];
/** Each Schedule saved, as its Agent and whether it was saved paused. */
const saved: string[] = [];

/** What the model returns in a step, given its prompt and whether it may call a tool. */
type Step = unknown[] | { content: unknown[]; finishReason: string };
type Scripted = (prompt: unknown, toolChoice: string) => Step | Promise<Step>;
/** The model's next steps; with none queued it answers "Fertig.". */
let script: Scripted[] = [];
const prompts: unknown[] = [];
const toolChoices: string[] = [];
/** The names of the tools each step offered the model. */
const toolNames: string[][] = [];
const calls = (toolName: string, input: unknown): unknown[] => [
  {
    type: "tool-call",
    toolCallId: `call-${randomUUID()}`,
    toolName,
    input: JSON.stringify(input),
  },
];
const says = (text: string): unknown[] => [{ type: "text", text }];
/** Stands in for the provider, so Runs run the real Agent model and its read tools. */
const model = new MockLanguageModelV4({
  doGenerate: async ({
    prompt,
    toolChoice,
    tools,
  }: {
    prompt: unknown;
    toolChoice?: { type: string };
    tools?: { name: string }[];
  }) => {
    prompts.push(prompt);
    toolNames.push((tools ?? []).map((t) => t.name).sort());
    const choice = toolChoice?.type ?? "auto";
    toolChoices.push(choice);
    const step = await (script.shift() ?? (() => says("Fertig.")))(
      prompt,
      choice,
    );
    const content = Array.isArray(step) ? step : step.content;
    const reason = !Array.isArray(step)
      ? step.finishReason
      : content.some((part) => (part as { type: string }).type === "tool-call")
        ? "tool-calls"
        : "stop";
    return {
      content,
      finishReason: { unified: reason, raw: reason },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    };
  },
} as never);
/** The Plan executor the gate dispatches to: a fake recording each dispatch, unless a test puts in the real one. */
let executor: Executor;
let dispatched: string[] = [];
const fakeExecutor: Executor = {
  async execute(_, { idempotencyKey }) {
    dispatched.push(idempotencyKey);
    return { status: "done", effect: { studyBlockId: randomUUID() } };
  },
  async lookup() {
    return { status: "unknown" };
  },
};
let delegation: ReturnType<typeof createDelegation>;
const testModels = createModels({
  apiKey: "test",
  baseURL: "https://provider.invalid",
  catalog: [],
});

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
  delegation = createDelegation({
    db: runtime,
    aiEnabled: () => true,
    clock,
    executors: {
      plan: {
        execute: (...args) => executor.execute(...args),
        lookup: (...args) => executor.lookup(...args),
      },
    },
    planRules,
  });
  const facts = createFacts({ db: runtime, keys, clock });
  const noSchedule = async () => {};
  agents = createAgents({
    db: runtime,
    clock,
    runAlive: workflowAlive(env.client),
    schedules: {
      create: noSchedule,
      save: async ({ agentId, paused }) =>
        void saved.push(`${agentId}${paused ? " paused" : ""}`),
      pause: noSchedule,
      unpause: noSchedule,
      delete: noSchedule,
    },
  });
  sources = createSources({
    db: runtime,
    keys,
    storage: {
      upload: async (id, key) => ({
        url: `https://storage.invalid/${id}`,
        headers: { key: key.toString("base64") },
        expiresAt: new Date(Date.now() + 300_000),
      }),
      download: async (id, key) => ({
        url: `https://storage.invalid/${id}`,
        keyBase64: key.toString("base64"),
        etag: "etag",
      }),
      promote: async () => {},
      remove: async () => {},
    },
  });
  runs = createAgentRuns({
    db: runtime,
    keys,
    reader: createKnowledgeReader({
      db: runtime,
      keys,
      embedder,
      delegation,
      clock,
    }),
    plan: createPlan({ db: runtime, facts, clock }),
    understanding: { levels: async () => [] },
    artifacts: { list: async () => [] },
    delegation,
    agents,
    catalog: { chatModels: async () => offered },
    modelFor: (config) => {
      ranOn.push(config.key);
      return createAgentModel({
        ...testModels.fromConfig(config),
        model,
        estimateMicroUsd: () => 1,
        actualMicroUsd: () => 1,
      });
    },
    clock,
  });
  activity = createActivity({ db: runtime, keys, facts, clock });
  outreach = createOutreach({
    db: runtime,
    clock,
    vapidPublicKey: "test-vapid-key",
    unsubscribeSecret: "test-unsubscribe-secret",
  });
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await Promise.all([env?.teardown(), db?.stop()]);
});

beforeEach(() => {
  offered = [sonnet];
  ranOn.length = 0;
  script = [];
  prompts.length = 0;
  toolChoices.length = 0;
  toolNames.length = 0;
  executor = fakeExecutor;
  dispatched = [];
});

/**
 * A student whose free-text Agent has one Course with one ready Source and an exam due in ten days, holding the given
 * Capabilities, and who started a Run of it now.
 */
async function started({
  held = [] as AgentCapability[],
  modelKey = sonnet.key,
}: {
  held?: AgentCapability[];
  modelKey?: string;
} = {}) {
  const studentId = randomUUID();
  const courseId = randomUUID();
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
      title: "Statistik II",
      matchTitle: "statistik ii",
      semester: "2026-ws",
      color: "violet",
      status: "accepted",
    },
  });
  const p = principal.fromSession({ studentId });
  const upload = await sources.upload(p, {
    title: "Skript.pdf",
    bytes: 100,
    type: "application/pdf",
  });
  if (upload.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, upload.source.id);
  await sources.ingest(p, upload.source.id, {
    delegation: createDelegation({ db: runtime, aiEnabled: () => true }),
    embedder,
    parse: async () => ({
      pages: [{ page: 1, text: "Die Klausur ist am 3. März." }],
    }),
    scans: {
      estimateMicroUsd: () => 1,
      read: async () => ({ text: "", usage: { microUsd: 1 } }),
    },
  });
  await admin.sourceCourse.create({
    data: { sourceId: upload.source.id, courseId, studentId },
  });
  const obligationId = randomUUID();
  await admin.obligation.create({
    data: {
      id: obligationId,
      studentId,
      courseId,
      matchKey: "klausur",
      kind: "exam",
      enteredAt: new Date(),
      correctedAt: new Date(),
      correctedTitle: "Klausur Statistik II",
      correctedDueDate: new Date(`${day(10)}T00:00:00Z`),
      correctedDueTime: "10:00",
      correctedTimeZone: "Europe/Berlin",
    },
  });
  const created = await agents.create(p, {
    name: "Klausur Statistik",
    description: "",
    emoji: "🤖",
    instructions: "Sag mir, wann meine Klausur in Statistik ist.",
    courseIds: [courseId],
    capabilities: held,
    budgetMicroUsd: 1_000_000,
    trigger: { rhythm: "daily", minute: 360 },
    modelKey,
  });
  if (created.status !== "ok") throw new Error(created.status);
  return { ...(await requested(p, created.id)), studentId, obligationId };
}

/** Starts another Run of the student's Agent now. */
async function requested(
  p: ReturnType<typeof principal.fromSession>,
  agentId: string,
) {
  const requested = await agents.requestRun(p, agentId);
  if (requested.status !== "ok") throw new Error(requested.status);
  return {
    p,
    studentId: (p as { studentId: string }).studentId,
    agentId,
    runId: requested.runId,
    workflowId: requested.workflowId,
  };
}

/** Runs the Run's workflow to its end on a worker with the given Activities. */
async function run(
  s: Awaited<ReturnType<typeof requested>>,
  activities: ReturnType<
    typeof createAgentRunActivities
  > = createAgentRunActivities(runs),
) {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue,
    workflowBundle,
    activities,
  });
  return worker.runUntil(
    env.client.workflow.execute("agentRun", {
      taskQueue,
      workflowId: s.workflowId,
      args: [{ studentId: s.studentId, agentId: s.agentId, runId: s.runId }],
    }),
  );
}

describe("an Agent's Run", () => {
  it("reads its Courses and the Plan in metered model steps, then ends with the model's summary", async () => {
    const s = await started();
    script = [
      () => calls("agenda", { from: day(0), to: day(13) }),
      () => calls("courseFacts", { course: "K1" }),
      () => calls("searchMaterial", { query: "Klausur" }),
      () =>
        says(
          "Deine Klausur in Statistik ist am 3. März [S1]. Details: https://example.com/klausur",
        ),
    ];

    expect(await run(s)).toEqual({ status: "done" });

    const shown = await runs.view(s.p, s.runId);
    expect(shown).toMatchObject({
      status: "done",
      trigger: "manual",
      stopReason: null,
      summary: "Deine Klausur in Statistik ist am 3. März. Details:",
    });
    expect(shown!.endedAt).toBeInstanceOf(Date);
    expect(shown!.steps.map((step) => step.parts?.map((p) => p.type))).toEqual([
      ["tool-agenda"],
      ["tool-courseFacts"],
      ["tool-searchMaterial"],
      [],
    ]);
    expect(shown!.steps[2]!.parts![0]!.output).toEqual({
      found: 1,
      sources: ["Skript.pdf"],
    });
    // Only nunio's system prompt and the saved Instructions are requests; what the tools read is fenced data.
    const lastPrompt = prompts.at(-1) as { role: string; content: unknown }[];
    expect(lastPrompt[0]).toMatchObject({ role: "system" });
    expect(JSON.stringify(lastPrompt[0])).toContain(
      "Sag mir, wann meine Klausur in Statistik ist.",
    );
    expect(JSON.stringify(lastPrompt.slice(1))).toMatch(
      /<<<BEGIN course_material [0-9a-f]+>>>[^<]*Die Klausur ist am 3\. März\./,
    );
    expect(JSON.stringify(lastPrompt.slice(1))).toMatch(
      /<<<BEGIN plan [0-9a-f]+>>>/,
    );
    // The transcript is dropped once the Run ends.
    expect(
      await admin.runStep.count({
        where: { runId: s.runId, transcriptContent: { not: null } },
      }),
    ).toBe(0);
    // Four model steps and the search's query embedding, each against the Agent's Budget and the Allowance.
    expect(
      await admin.usageReservation.count({
        where: { runId: s.runId, agentId: s.agentId, status: "settled" },
      }),
    ).toBe(5);
    expect(
      await admin.agent.findUniqueOrThrow({
        where: { id: s.agentId },
        select: { usedMicroUsd: true },
      }),
    ).toEqual({ usedMicroUsd: 5n });
  });

  it("still reads a Course of its Agent that was Archived, as knowledge", async () => {
    const s = await started();
    await admin.course.updateMany({
      where: { studentId: s.studentId },
      data: { archivedAt: new Date() },
    });
    script = [
      () => calls("courseFacts", { course: "K1" }),
      () => calls("searchMaterial", { query: "Klausur" }),
      () => says("Die Klausur ist am 3. März [S1]."),
    ];

    expect(await run(s)).toEqual({ status: "done" });

    const shown = await runs.view(s.p, s.runId);
    expect(shown!.steps[1]!.parts![0]!.output).toEqual({
      found: 1,
      sources: ["Skript.pdf"],
    });
    expect(JSON.stringify(prompts.at(-1))).toMatch(
      /<<<BEGIN course_material [0-9a-f]+>>>[^<]*Die Klausur ist am 3\. März\./,
    );
  });

  it("takes at most 20 model steps, and the last one may call no tool", async () => {
    const s = await started();
    script = Array.from(
      { length: 20 },
      () => (_, choice) =>
        choice === "none"
          ? says("Mehr konnte ich nicht lesen.")
          : calls("agenda", { from: day(0), to: day(6) }),
    );

    expect(await run(s)).toEqual({ status: "done" });

    expect(toolChoices).toEqual([...Array(19).fill("auto"), "none"]);
    expect(await runs.view(s.p, s.runId)).toMatchObject({
      status: "done",
      summary: "Mehr konnte ich nicht lesen.",
    });
  });

  it("never runs a step's model again when the worker loses the step's completion", async () => {
    const s = await started();
    script = [
      () => calls("agenda", { from: day(0), to: day(6) }),
      () => calls("courseFacts", { course: "K1" }),
    ];
    const activities = createAgentRunActivities(runs);
    let lost = false;
    const step = activities.agentStep;
    activities.agentStep = async (ref) => {
      const outcome = await step(ref);
      if (ref.n === 2 && !lost) {
        lost = true;
        throw new Error("lost Activity completion");
      }
      return outcome;
    };

    expect(await run(s, activities)).toEqual({ status: "done" });

    expect(lost).toBe(true);
    expect(prompts).toHaveLength(3);
    expect((await runs.view(s.p, s.runId))!.steps).toHaveLength(3);
    expect(
      await admin.usageReservation.count({ where: { runId: s.runId } }),
    ).toBe(3);
  });

  it("stops when its Agent is Paused mid-Run, with no summary", async () => {
    const s = await started();
    script = [
      async () => {
        await agents.pause(s.p, s.agentId);
        return calls("agenda", { from: day(0), to: day(6) });
      },
    ];

    expect(await run(s)).toEqual({ status: "stopped", reason: "paused" });

    expect(await runs.view(s.p, s.runId)).toMatchObject({
      status: "stopped",
      stopReason: "paused",
      summary: null,
    });
    // The refused step cost nothing, so its claim was released.
    expect(
      await admin.runStep.count({
        where: { runId: s.runId, partsContent: null },
      }),
    ).toBe(0);
  });

  it("stops at once when told its Agent was Paused mid-step, abandoning the step under way", async () => {
    const s = await started();
    const handle = env.client.workflow.getHandle(s.workflowId);
    script = [
      async () => {
        await agents.pause(s.p, s.agentId);
        await handle.signal("stopAgentRun", "paused");
        // The Run ends while the model is still at its step.
        await handle.result();
        return calls("agenda", { from: day(0), to: day(6) });
      },
    ];

    expect(await run(s)).toEqual({ status: "stopped", reason: "paused" });

    expect(await runs.view(s.p, s.runId)).toMatchObject({
      status: "stopped",
      stopReason: "paused",
      summary: null,
    });
    // The abandoned step keeps nothing once it returns, and no step follows it.
    await expect
      .poll(() =>
        admin.runStep.count({
          where: { runId: s.runId, partsContent: { not: null } },
        }),
      )
      .toBe(0);
    expect(prompts).toHaveLength(1);
  });

  it("never calls the model again for a step a lost worker may have paid for, and fails the Run", async () => {
    const s = await started();
    let release = () => {};
    script = [
      () => calls("agenda", { from: day(0), to: day(6) }),
      // The worker dies while the provider still works on step 2.
      () =>
        new Promise<Step>((resolve) => {
          release = () => resolve(says("Zu spät."));
        }),
    ];
    const activities = createAgentRunActivities(runs);
    const step = activities.agentStep;
    let died = false;
    activities.agentStep = async (ref) => {
      if (ref.n !== 2 || died) return step(ref);
      died = true;
      void step(ref);
      await expect.poll(() => prompts.length).toBe(2);
      throw new Error("worker died");
    };

    await expect(run(s, activities)).resolves.toEqual({
      status: "failed",
      reason: "step_interrupted",
    });

    expect(prompts).toHaveLength(2);
    expect(await runs.view(s.p, s.runId)).toMatchObject({
      status: "failed",
      stopReason: "step_interrupted",
      summary: null,
    });
    // The late answer is metered but never becomes part of the ended Run.
    release();
    await expect
      .poll(() =>
        admin.usageReservation.count({
          where: { runId: s.runId, status: "settled" },
        }),
      )
      .toBe(2);
    expect((await runs.view(s.p, s.runId))!.steps).toHaveLength(1);
    expect(
      await admin.runStep.count({
        where: { runId: s.runId, transcriptContent: { not: null } },
      }),
    ).toBe(0);
  });

  it("never calls the model again after a call that failed once it may have been sent, and fails the Run", async () => {
    const s = await started();
    script = [
      () => calls("agenda", { from: day(0), to: day(6) }),
      () => {
        throw new Error("socket hang up");
      },
    ];

    expect(await run(s)).toEqual({
      status: "failed",
      reason: "step_interrupted",
    });

    expect(prompts).toHaveLength(2);
    // The lost call keeps its estimate held; no second call was reserved.
    expect(
      await admin.usageReservation.findMany({
        where: { runId: s.runId },
        orderBy: { reservedAt: "asc" },
        select: { status: true },
      }),
    ).toEqual([{ status: "settled" }, { status: "held" }]);
  });

  it("fails without retrying when the model's step ends early, settling what it cost", async () => {
    const s = await started();
    script = [() => ({ content: says("Ich habe"), finishReason: "length" })];

    expect(await run(s)).toEqual({
      status: "failed",
      reason: "model_ended_early",
    });

    expect(prompts).toHaveLength(1);
    expect(await runs.view(s.p, s.runId)).toMatchObject({
      status: "failed",
      stopReason: "model_ended_early",
      summary: null,
    });
    expect(
      await admin.usageReservation.findMany({
        where: { runId: s.runId },
        select: { status: true, actualMicroUsd: true },
      }),
    ).toEqual([{ status: "settled", actualMicroUsd: 1n }]);
  });

  it("ends the Run the API recorded as failed when it cannot start", async () => {
    const s = await started();
    const activities = createAgentRunActivities(runs);
    activities.startAgentRun = async () => {
      throw ApplicationFailure.nonRetryable("database unavailable");
    };

    await expect(run(s, activities)).rejects.toThrow();

    expect(await runs.view(s.p, s.runId)).toMatchObject({ status: "failed" });
    expect((await agents.view(s.p, s.agentId))!.running).toBe(false);
  });

  it("ends as stopped, dropping its transcript, when its workflow is cancelled mid-step", async () => {
    const s = await started();
    script = [
      async () => {
        await env.client.workflow.getHandle(s.workflowId).cancel();
        return calls("agenda", { from: day(0), to: day(6) });
      },
    ];

    await expect(run(s)).rejects.toThrow();

    await expect
      .poll(async () => (await runs.view(s.p, s.runId))?.status)
      .toBe("stopped");
    expect(await runs.view(s.p, s.runId)).toMatchObject({
      stopReason: "cancelled",
      summary: null,
    });
    await expect.poll(() => prompts.length).toBe(1);
    expect(
      await admin.runStep.count({
        where: { runId: s.runId, transcriptContent: { not: null } },
      }),
    ).toBe(0);
  });

  /** Runs a Run of the Agent as its Schedule starts one: with no Run recorded beforehand. */
  async function fromSchedule(
    s: Awaited<ReturnType<typeof requested>>,
    activities = createAgentRunActivities(runs),
    workflowId = `agentRun/${s.agentId}-${randomUUID()}`,
  ) {
    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue,
      workflowBundle,
      activities,
    });
    return worker.runUntil(
      env.client.workflow.execute("agentRun", {
        taskQueue,
        workflowId,
        args: [{ studentId: s.studentId, agentId: s.agentId }],
      }),
    );
  }
  const scheduledRuns = (agentId: string) =>
    admin.run.findMany({
      where: { agentId, trigger: "schedule" },
      select: { status: true, stopReason: true },
    });

  it("records a Run its Schedule starts with the trigger schedule, and runs it to its end", async () => {
    const s = await started();
    await agents.failRun(s.p, s.runId);

    expect(await fromSchedule(s)).toEqual({ status: "done" });

    expect(await scheduledRuns(s.agentId)).toEqual([
      { status: "done", stopReason: null },
    ]);
  });

  it("records no Run when its Schedule fires while another Run is under way, or while the Agent is Paused", async () => {
    const s = await started();

    expect(await fromSchedule(s)).toEqual({ status: "skipped" });
    await agents.failRun(s.p, s.runId);
    await agents.pause(s.p, s.agentId);
    expect(await fromSchedule(s)).toEqual({ status: "skipped" });

    expect(await scheduledRuns(s.agentId)).toEqual([]);
    expect(prompts).toHaveLength(0);
  });

  it("is not held up by an earlier Run whose workflow is gone, which ends as failed and no longer reads as running", async () => {
    const s = await started();
    // Under way a while, but its workflow never ran, as one terminated would not.
    await admin.run.update({
      where: { id: s.runId },
      data: { startedAt: new Date(Date.now() - 30 * 60_000) },
    });

    expect(
      (await agents.list(s.p)).find((agent) => agent.id === s.agentId)?.badge,
    ).toBeNull();
    // Under way again, as if nobody had read the list: the Schedule's next fire finds it too.
    await admin.run.update({
      where: { id: s.runId },
      data: { status: "running", endedAt: null },
    });
    expect(await fromSchedule(s)).toEqual({ status: "done" });

    expect(
      await admin.run.findUniqueOrThrow({
        where: { id: s.runId },
        select: { status: true },
      }),
    ).toEqual({ status: "failed" });
    expect(await scheduledRuns(s.agentId)).toEqual([
      { status: "done", stopReason: null },
    ]);
  });

  it("ends a Run its Schedule started as stopped when its workflow is cancelled while the Run is recorded", async () => {
    const s = await started();
    await agents.failRun(s.p, s.runId);
    const workflowId = `agentRun/${s.agentId}-${randomUUID()}`;
    const activities = createAgentRunActivities(runs);
    const start = activities.startAgentRun;
    activities.startAgentRun = async (ref) => {
      const handle = env.client.workflow.getHandle(workflowId);
      await handle.cancel();
      // Gives a workflow that would not wait for its start the time to end first.
      await Promise.race([
        handle.result().catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
      return start(ref);
    };

    await expect(fromSchedule(s, activities, workflowId)).rejects.toThrow();

    expect(await scheduledRuns(s.agentId)).toEqual([
      { status: "stopped", stopReason: "cancelled" },
    ]);
    expect((await agents.view(s.p, s.agentId))!.running).toBe(false);
    expect(prompts).toHaveLength(0);
  });

  it("stops when its Model is no longer offered", async () => {
    const s = await started();
    offered = [];

    expect(await run(s)).toEqual({
      status: "stopped",
      reason: "model_unavailable",
    });
    expect(prompts).toHaveLength(0);
  });

  it("runs on its Agent's Model, not the Chat default, and stops at the next step once that Model is no longer offered", async () => {
    const s = await started({ modelKey: haiku.key });
    offered = [sonnet, haiku];
    script = [
      () => {
        // The founder stops offering it while the Run is under way.
        offered = [sonnet];
        return calls("agenda", { from: day(0), to: day(13) });
      },
    ];

    expect(await run(s)).toEqual({
      status: "stopped",
      reason: "model_unavailable",
    });
    expect(ranOn).toEqual([haiku.key]);
    expect(prompts).toHaveLength(1);
    const shown = await activity.run(s.p, s.agentId, s.runId);
    expect(shown).toMatchObject({
      status: "stopped",
      stopReason: "model_unavailable",
    });
    expect(shown!.verlauf.at(-1)).toMatchObject({
      type: "end",
      status: "stopped",
      reason: "model_unavailable",
    });
  });

  it("records its Verlauf: the start and its trigger, what each step read, and the end", async () => {
    const s = await started();
    const course = await admin.course.findFirstOrThrow({
      where: { studentId: s.studentId },
    });
    const source = await admin.source.findFirstOrThrow({
      where: { studentId: s.studentId },
    });
    script = [
      () => [
        ...calls("agenda", { from: day(0), to: day(13) }),
        ...calls("approvals", {}),
      ],
      () => [
        ...calls("courseFacts", { course: "K1" }),
        ...calls("searchMaterial", { query: "Klausur" }),
      ],
      () => says("Deine Klausur ist am 3. März."),
    ];

    expect(await run(s)).toEqual({ status: "done" });

    const shown = await activity.run(s.p, s.agentId, s.runId);
    expect(shown).toMatchObject({
      status: "done",
      trigger: "manual",
      summary: "Deine Klausur ist am 3. März.",
      openApprovals: 0,
      // Three model steps and the search's embedding, each metered at 1.
      costMicroUsd: 4,
      budgetMicroUsd: 1_000_000,
    });
    expect(shown!.verlauf.map(({ at: _, ...entry }) => entry)).toEqual([
      { type: "start", trigger: "manual" },
      {
        type: "read",
        step: 1,
        plan: true,
        approvals: true,
        courses: [],
        sources: [],
      },
      {
        type: "read",
        step: 2,
        plan: false,
        approvals: false,
        courses: [{ id: course.id, title: "Statistik II" }],
        sources: [{ id: source.id, title: "Skript.pdf" }],
      },
      { type: "end", status: "done", reason: null },
    ]);
  });

  it("ends its Verlauf with why it stopped, and has no summary", async () => {
    const s = await started();
    offered = [];

    await run(s);

    const shown = await activity.run(s.p, s.agentId, s.runId);
    expect(shown).toMatchObject({
      status: "stopped",
      stopReason: "model_unavailable",
      summary: null,
      costMicroUsd: 0,
    });
    expect(shown!.verlauf.map((entry) => entry.type)).toEqual(["start", "end"]);
    expect(shown!.verlauf.at(-1)).toMatchObject({
      status: "stopped",
      reason: "model_unavailable",
    });
  });
});

/** The four Lernblöcke Capabilities, each on the given mode or its default. */
const lernbloecke = (
  modes: Partial<
    Record<keyof typeof capabilities, AgentCapability["mode"]>
  > = {},
): AgentCapability[] =>
  (Object.keys(capabilities) as (keyof typeof capabilities)[])
    .filter((id) => capabilities[id].section === "studyBlocks")
    .map((id) => ({
      id,
      mode: modes[id] ?? capabilities[id].modes[0],
    }));
/** The model's call to create a Study Block for the exam it read as O1, `offset` days ahead at `hour` local time. */
const createBlock = (offset: number, hour = 10) =>
  calls("createStudyBlocks", {
    work: "O1",
    start: `${day(offset)}T${String(hour).padStart(2, "0")}:00`,
    end: `${day(offset)}T${String(hour + 1).padStart(2, "0")}:00`,
  });
const readPlan = () => calls("agenda", { from: day(0), to: day(13) });
/** What the model was last given as the results of its calls of one Action tool, in order. */
const actionResults = (prompt: unknown, toolName = "createStudyBlocks") =>
  (prompt as { role: string; content: unknown }[])
    .filter((message) => message.role === "tool")
    .flatMap(
      (message) =>
        message.content as { toolName: string; output: { value?: string } }[],
    )
    .filter((part) => part.toolName === toolName)
    .map((part) => part.output.value ?? JSON.stringify(part.output));
/** The Run's Actions, oldest first, as the gate recorded them. */
const actionsOf = (runId: string) =>
  admin.action.findMany({
    where: { runId },
    orderBy: { key: "asc" },
    select: { key: true, status: true, refusal: true },
  });
const statuses = async (runId: string) =>
  (await actionsOf(runId)).map((a) => a.refusal ?? a.status);

describe("an Agent's Run acting on Study Blocks (ADR-0026)", () => {
  it("offers exactly the Agent's Capabilities as Action tools beside its read tools", async () => {
    const reads = ["agenda", "approvals", "courseFacts", "searchMaterial"];
    const all = await started({
      held: (Object.keys(capabilities) as (keyof typeof capabilities)[]).map(
        (id) => ({ id, mode: capabilities[id].modes[0] }),
      ),
    });
    await run(all);
    const none = await started();
    await run(none);
    const some = await started({
      held: [{ id: "createStudyBlocks", mode: "ask" }],
    });
    await run(some);

    expect(toolNames).toEqual([
      [...reads, ...Object.keys(capabilities)].sort(),
      reads,
      [...reads, "createStudyBlocks"].sort(),
    ]);
    // Nothing on ADR-0026's "no tool" list: every Action tool only creates, moves or removes a Study Block, or creates
    // a Task. None reopens or completes a Task or changes an Estimate.
    expect(new Set(Object.values(capabilities).map((c) => c.kind))).toEqual(
      new Set([
        "studyBlock.create",
        "studyBlock.move",
        "studyBlock.remove",
        "task.create",
      ]),
    );
  });

  it("acts at once on a Grant, through the gate under runId:step:call, and tells the model", async () => {
    const s = await started({ held: lernbloecke() });
    script = [
      readPlan,
      () => createBlock(3),
      () => says("Ich habe einen Lernblock eingetragen."),
    ];

    expect(await run(s)).toEqual({ status: "done" });

    expect(await actionsOf(s.runId)).toEqual([
      { key: `${s.runId}:2:1`, status: "done", refusal: null },
    ]);
    expect(dispatched).toHaveLength(1);
    expect(actionResults(prompts[2])).toEqual([expect.stringMatching(/^Done/)]);
  });

  it("acts on nothing more once told its Agent was Ended while it performs a step's Actions", async () => {
    const s = await started({ held: lernbloecke() });
    const handle = env.client.workflow.getHandle(s.workflowId);
    executor = {
      ...fakeExecutor,
      async execute(req, opts) {
        const done = await fakeExecutor.execute(req, opts);
        await agents.end(s.p, s.agentId);
        await handle.signal("stopAgentRun", "ended");
        await handle.result();
        return done;
      },
    };
    script = [readPlan, () => [...createBlock(3), ...createBlock(4)]];

    expect(await run(s)).toEqual({ status: "stopped", reason: "ended" });

    // The Action under way when the student said stop finishes; the next is refused, and no step follows.
    await expect.poll(() => statuses(s.runId)).toEqual(["done", "ended"]);
    expect(dispatched).toHaveLength(1);
    expect(prompts).toHaveLength(2);
    expect(await runs.view(s.p, s.runId)).toMatchObject({
      status: "stopped",
      stopReason: "ended",
    });
  });

  it("acts on none of an abandoned step's calls once its Run has stopped, even after the Agent is resumed", async () => {
    const s = await started({ held: lernbloecke() });
    const handle = env.client.workflow.getHandle(s.workflowId);
    executor = {
      ...fakeExecutor,
      async execute(req, opts) {
        const done = await fakeExecutor.execute(req, opts);
        await agents.pause(s.p, s.agentId);
        await handle.signal("stopAgentRun", "paused");
        await handle.result();
        // The student resumes at once; the Run told to stop has stopped all the same.
        await agents.resume(s.p, s.agentId);
        return done;
      },
    };
    script = [readPlan, () => [...createBlock(3), ...createBlock(4)]];

    expect(await run(s)).toEqual({ status: "stopped", reason: "paused" });

    await expect.poll(() => statuses(s.runId)).toEqual(["done", "run_ended"]);
    expect(dispatched).toHaveLength(1);
  });

  it("records the Agent as the creator of a Study Block it creates", async () => {
    executor = createPlanExecutor({ db: runtime });
    const s = await started({ held: lernbloecke() });
    script = [readPlan, () => createBlock(3)];

    expect(await run(s)).toEqual({ status: "done" });

    expect(
      await admin.studyBlock.findMany({
        where: { obligationId: s.obligationId },
        select: { createdByAgentId: true, placedBy: true },
      }),
    ).toEqual([{ createdByAgentId: s.agentId, placedBy: "nunio" }]);
  });

  it("asks for Approval without waiting, tells the model it has not happened, and leaves the Approval open", async () => {
    const s = await started({
      held: lernbloecke({ createStudyBlocks: "ask" }),
    });
    script = [
      readPlan,
      () => createBlock(3),
      () => says("Ich habe dich um Freigabe gebeten."),
    ];

    expect(await run(s)).toEqual({ status: "done" });

    expect(await statuses(s.runId)).toEqual(["awaiting_approval"]);
    expect(dispatched).toHaveLength(0);
    expect(actionResults(prompts[2])).toEqual([
      expect.stringMatching(/^Asked, not happened/),
    ]);
    expect(await runs.view(s.p, s.runId)).toMatchObject({ status: "done" });
    expect(
      await admin.approval.findMany({
        where: { action: { runId: s.runId } },
        select: { decision: true },
      }),
    ).toEqual([{ decision: null }]);
  });

  it("stops when its Budget runs out mid-Run, pausing its Agent and its Schedule and withdrawing its open Approvals", async () => {
    const s = await started({
      held: lernbloecke({ createStudyBlocks: "ask" }),
    });
    // Each step costs 1 micro-USD here: enough Budget for two steps, not a third.
    await admin.agent.update({
      where: { id: s.agentId },
      data: { budgetMicroUsd: 2 },
    });
    script = [readPlan, () => createBlock(3)];
    saved.length = 0;

    expect(await run(s)).toEqual({
      status: "stopped",
      reason: "budget_exhausted",
    });

    expect(await agents.view(s.p, s.agentId)).toMatchObject({
      state: "paused",
      pausedBy: "budget",
      approvalRunId: null,
      budget: { limitMicroUsd: 2, usedMicroUsd: 2, heldMicroUsd: 0 },
    });
    expect(await statuses(s.runId)).toEqual(["approval_withdrawn"]);
    expect(await runs.view(s.p, s.runId)).toMatchObject({
      status: "stopped",
      stopReason: "budget_exhausted",
      summary: null,
    });
    // Pausing an Agent pauses its Schedule (ADR-0006), so it starts no Run until the student resumes it.
    expect(saved).toEqual([`${s.agentId} paused`]);
    // The model ran only for the two steps the Budget paid for.
    expect(prompts).toHaveLength(2);
  });

  it("raises one Intervention when it ends with Approvals open, queued to be announced, and none when it asked nothing", async () => {
    const s = await started({
      held: lernbloecke({ createStudyBlocks: "ask" }),
    });
    script = [
      readPlan,
      () => [...createBlock(3), ...createBlock(4)],
      () => says("Ich habe um zwei Freigaben gebeten."),
    ];
    await run(s);
    const quiet = await requested(s.p, s.agentId);
    await run(quiet);
    // Ending it again raises nothing more.
    await runs.finish(s, { status: "done" });

    expect(
      (await outreach.inbox(s.p)).interventions.map(
        ({ kind, subject, state }) => ({ kind, subject, state }),
      ),
    ).toEqual([
      {
        kind: "run_approvals",
        subject: { kind: "run", id: s.runId },
        state: "open",
      },
    ]);
    // One message per channel; the outreach tick sends it under Quiet Hours and the daily limit.
    expect(
      (
        await admin.delivery.findMany({
          where: { studentId: s.studentId },
          select: { channel: true, sentAt: true },
        })
      ).sort((a, b) => a.channel.localeCompare(b.channel)),
    ).toEqual([
      { channel: "email", sentAt: null },
      { channel: "push", sentAt: null },
    ]);
  });

  it("shows each Action call and its outcome in the Verlauf, refusals, run_cap and a broken Preference included", async () => {
    // On Immer erlaubt a block outside the study window acts, and the broken Preference is noted.
    const s = await started({
      held: lernbloecke({ createStudyBlocks: "always" }),
    });
    script = [
      readPlan,
      () => [
        ...createBlock(3, 3),
        // Names nothing the Run read: refused, nothing asked, and not counted.
        ...calls("createStudyBlocks", {
          work: "O9",
          start: `${day(4)}T10:00`,
          end: `${day(4)}T11:00`,
        }),
        ...[4, 5, 6, 7, 8].flatMap((offset) => createBlock(offset)),
      ],
      () => says("Fertig."),
    ];

    expect(await run(s)).toEqual({ status: "done" });

    const verlauf = (await activity.run(s.p, s.agentId, s.runId))!.verlauf;
    const created = {
      kind: "studyBlock.create",
      work: { title: "Klausur Statistik II", course: "Statistik II" },
      start: expect.any(Date),
      end: expect.any(Date),
    };
    expect(
      verlauf
        .filter((entry) => entry.type === "action")
        .map(({ at: _, ...entry }) => entry),
    ).toEqual([
      {
        type: "action",
        step: 2,
        capability: "createStudyBlocks",
        action: created,
        outcome: "done",
        refusal: null,
        brokenPreferences: expect.arrayContaining(["outside_study_window"]),
      },
      {
        type: "action",
        step: 2,
        capability: "createStudyBlocks",
        action: null,
        outcome: "refused",
        refusal: "invalid",
        brokenPreferences: [],
      },
      ...Array(4).fill({
        type: "action",
        step: 2,
        capability: "createStudyBlocks",
        action: created,
        outcome: "done",
        refusal: null,
        brokenPreferences: [],
      }),
      {
        type: "action",
        step: 2,
        capability: "createStudyBlocks",
        action: created,
        outcome: "refused",
        refusal: "run_cap",
        brokenPreferences: [],
      },
    ]);
    expect(verlauf.at(-1)).toMatchObject({ type: "end", status: "done" });
  });

  it("shows an asked Action in the Verlauf, and the Run as needing Approval while it stays open", async () => {
    const s = await started({
      held: lernbloecke({ createStudyBlocks: "ask" }),
    });
    script = [readPlan, () => createBlock(3), () => says("Gefragt.")];

    await run(s);

    const shown = await activity.run(s.p, s.agentId, s.runId);
    expect(shown).toMatchObject({ status: "done", openApprovals: 1 });
    expect(shown!.verlauf.find((e) => e.type === "action")).toMatchObject({
      outcome: "awaiting_approval",
      refusal: null,
    });
    expect(
      (await activity.runs(s.p, s.agentId, { limit: 10 }))!.runs,
    ).toMatchObject([{ id: s.runId, openApprovals: 1 }]);
  });

  it("refuses a sixth Action call in one step with run_cap and carries on", async () => {
    const s = await started({ held: lernbloecke() });
    script = [
      readPlan,
      () => [3, 4, 5, 6, 7, 8].flatMap((offset) => createBlock(offset)),
      () => says("Fertig."),
    ];

    expect(await run(s)).toEqual({ status: "done" });

    expect(await statuses(s.runId)).toEqual([
      ...Array(5).fill("done"),
      "run_cap",
    ]);
    expect(dispatched).toHaveLength(5);
    expect(actionResults(prompts[2]).at(-1)).toMatch(/^Refused/);
  });

  it("refuses a 21st Action call in the Run with run_cap, counting refused calls, and carries on", async () => {
    const s = await started({ held: lernbloecke() });
    script = [
      readPlan,
      // Six calls: the sixth is refused, and counts.
      () => [3, 4, 5, 6, 7, 8].flatMap((offset) => createBlock(offset)),
      ...[9, 10, 11].map(
        (hour) => () =>
          [3, 4, 5, 6, 7].flatMap((offset) => createBlock(offset, hour)),
      ),
      () => createBlock(3, 15),
      () => says("Fertig."),
    ];

    expect(await run(s)).toEqual({ status: "done" });

    const recorded = await actionsOf(s.runId);
    expect(recorded).toHaveLength(22);
    expect(recorded.filter((a) => a.status === "done")).toHaveLength(19);
    expect(recorded.at(-1)).toMatchObject({
      key: `${s.runId}:6:1`,
      refusal: "run_cap",
    });
    expect(recorded.at(-2)).toMatchObject({ refusal: "run_cap" });
    expect(await runs.view(s.p, s.runId)).toMatchObject({ status: "done" });
  });

  it("refuses asking a sixth Approval in the Run with run_cap, while Grants still act", async () => {
    // On Automatisch a block outside the study window asks; one inside it acts on the Grant.
    const s = await started({ held: lernbloecke() });
    script = [
      readPlan,
      () => [3, 4, 5, 6, 7].flatMap((offset) => createBlock(offset, 3)),
      async () => {
        // One of them is denied, so the Agent has only four open: the Run's own cap refuses the sixth.
        const [first] = await actionsOf(s.runId);
        await delegation.decide(s.p, {
          kind: "deny",
          actionId: (
            await admin.action.findFirstOrThrow({ where: { key: first!.key } })
          ).id,
        });
        return [...createBlock(8, 3), ...createBlock(8, 10)];
      },
      () => says("Fertig."),
    ];

    expect(await run(s)).toEqual({ status: "done" });

    expect(await statuses(s.runId)).toEqual([
      "approval_denied",
      ...Array(4).fill("awaiting_approval"),
      "run_cap",
      "done",
    ]);
    expect(actionResults(prompts[3]).slice(5)).toEqual([
      expect.stringMatching(/^Refused/),
      expect.stringMatching(/^Done/),
    ]);
  });

  it("refuses asking past five open Approvals of the Agent with open_approvals_cap, while Grants still act", async () => {
    const s = await started({ held: lernbloecke() });
    script = [
      readPlan,
      () => [3, 4, 5, 6, 7].flatMap((offset) => createBlock(offset, 3)),
    ];
    await run(s);
    expect(await statuses(s.runId)).toEqual(Array(5).fill("awaiting_approval"));

    // The Approvals outlive their Run, so the next Run may ask none of its own.
    const next = await requested(s.p, s.agentId);
    script = [
      readPlan,
      () => [...createBlock(8, 3), ...createBlock(8, 10)],
      () => says("Fertig."),
    ];

    expect(await run(next)).toEqual({ status: "done" });

    expect(await statuses(next.runId)).toEqual(["open_approvals_cap", "done"]);
    expect(actionResults(prompts.at(-1))).toEqual([
      expect.stringMatching(/^Refused/),
      expect.stringMatching(/^Done/),
    ]);
  });

  it("reads its Agent's open Approvals and those decided or expired since its previous Run, as fenced data", async () => {
    const s = await started({
      held: lernbloecke({ createStudyBlocks: "ask" }),
    });
    script = [
      readPlan,
      () => [3, 4, 5, 6].flatMap((offset) => createBlock(offset)),
      () => says("Ich habe um vier Freigaben gebeten."),
    ];
    await run(s);
    const [approved, denied, expired] = await admin.action.findMany({
      where: { runId: s.runId },
      orderBy: { key: "asc" },
      include: { approval: true },
    });
    // The student decides two as the API does, and lets one expire; the fourth stays open.
    const decided = await delegation.decide(s.p, {
      kind: "approve",
      actionId: approved!.id,
      fingerprint: approved!.approval!.fingerprint,
    });
    await delegation.perform(principal.fromRun(s.runId), {
      key: decided.key,
      intent: decided.intent,
    });
    await delegation.decide(s.p, { kind: "deny", actionId: denied!.id });
    // It expired once the Run had ended, before the next Run.
    const { endedAt } = await admin.run.findUniqueOrThrow({
      where: { id: s.runId },
    });
    await admin.approval.update({
      where: { actionId: expired!.id },
      data: { expiresAt: endedAt! },
    });
    const approvalsRead = (prompt: unknown) =>
      (prompt as { role: string; content: unknown }[])
        .filter((message) => message.role === "tool")
        .flatMap(
          (message) =>
            message.content as {
              toolName: string;
              output: { value?: string };
            }[],
        )
        .filter((part) => part.toolName === "approvals")
        .map((part) => part.output.value ?? "")
        .join("\n");

    const next = await requested(s.p, s.agentId);
    script = [() => calls("approvals", {}), () => says("Fertig.")];
    expect(await run(next)).toEqual({ status: "done" });

    const read = approvalsRead(prompts.at(-1));
    expect(read).toMatch(/^<<<BEGIN approvals [0-9a-f]+>>>/);
    const lines = read.split("\n");
    const open = lines.indexOf(
      "Open, the student has not decided yet; do not ask for these again:",
    );
    const since = lines.indexOf("Decided or expired since your previous Run:");
    const at = (offset: number) => `${day(offset)} 10:00–11:00`;
    expect(lines.slice(open + 1, since)).toEqual([
      expect.stringMatching(
        new RegExp(`^- create a Study Block for O1 at ${at(6)} · expires `),
      ),
    ]);
    expect(lines.slice(since + 1, -1)).toEqual([
      `- create a Study Block for O1 at ${at(3)} · approved and done: the Study Block is B1`,
      `- create a Study Block for O1 at ${at(4)} · declined by the student`,
      `- create a Study Block for O1 at ${at(5)} · expired unanswered`,
    ]);

    // The Run after it is given only what was decided since the one before.
    const third = await requested(s.p, s.agentId);
    script = [() => calls("approvals", {}), () => says("Fertig.")];
    await run(third);
    const again = approvalsRead(prompts.at(-1)).split("\n");
    expect(
      again.slice(
        again.indexOf("Decided or expired since your previous Run:") + 1,
        -1,
      ),
    ).toEqual(["none"]);
    expect(again.filter((line) => line.includes(at(6)))).toHaveLength(1);
  });

  it("reads the Approvals a Pause withdrew as no longer open, once, in the Run after it", async () => {
    const s = await started({
      held: lernbloecke({ createStudyBlocks: "ask" }),
    });
    script = [
      readPlan,
      () => [3, 4].flatMap((offset) => createBlock(offset)),
      () => says("Ich habe um zwei Freigaben gebeten."),
    ];
    await run(s);
    await agents.pause(s.p, s.agentId);
    await agents.resume(s.p, s.agentId);
    const read = async () => {
      script = [() => calls("approvals", {}), () => says("Fertig.")];
      await run(await requested(s.p, s.agentId));
      const lines = (prompts.at(-1) as { role: string; content: unknown }[])
        .filter((message) => message.role === "tool")
        .flatMap(
          (message) =>
            message.content as {
              toolName: string;
              output: { value?: string };
            }[],
        )
        .filter((part) => part.toolName === "approvals")
        .map((part) => part.output.value ?? "")
        .join("\n")
        .split("\n");
      const since = lines.indexOf(
        "Decided or expired since your previous Run:",
      );
      return { open: lines.slice(2, since), since: lines.slice(since + 1, -1) };
    };

    const at = (offset: number) => `${day(offset)} 10:00–11:00`;
    expect(await read()).toEqual({
      open: ["none"],
      since: [3, 4].map(
        (offset) =>
          `- create a Study Block for O1 at ${at(offset)} · refused: the student Paused or Ended your Agent before deciding, which withdrew it`,
      ),
    });
    expect(await read()).toEqual({ open: ["none"], since: ["none"] });
  });

  it("never performs an Action twice when the worker loses the completion of the step or of its Actions", async () => {
    const s = await started({ held: lernbloecke() });
    script = [
      readPlan,
      () => [3, 4].flatMap((offset) => createBlock(offset)),
      () => says("Fertig."),
    ];
    const activities = createAgentRunActivities(runs);
    const lost = { step: false, actions: false };
    const step = activities.agentStep;
    activities.agentStep = async (ref) => {
      const outcome = await step(ref);
      if (ref.n === 2 && !lost.step) {
        lost.step = true;
        throw new Error("lost Activity completion");
      }
      return outcome;
    };
    const act = activities.agentActions;
    activities.agentActions = async (ref) => {
      const outcome = await act(ref);
      if (!lost.actions) {
        lost.actions = true;
        throw new Error("lost Activity completion");
      }
      return outcome;
    };

    expect(await run(s, activities)).toEqual({ status: "done" });

    expect(lost).toEqual({ step: true, actions: true });
    expect(prompts).toHaveLength(3);
    expect(dispatched).toHaveLength(2);
    expect(await statuses(s.runId)).toEqual(["done", "done"]);
  });

  it.each([
    ["without an end", { work: "O1", start: "2026-12-01T10:00" }],
    ["with a start that is no time", { work: "O1", start: 5, end: 7 }],
    [
      "with a day that does not exist",
      { work: "O1", start: "2026-02-30T10:00", end: "2026-02-30T11:00" },
    ],
    ["naming no work", { start: "2026-12-01T10:00", end: "2026-12-01T11:00" }],
  ])(
    "refuses a call %s without asking, telling the model, and still acts on the step's other calls",
    async (_, input) => {
      const s = await started({ held: lernbloecke() });
      script = [
        readPlan,
        () => [...createBlock(3), ...calls("createStudyBlocks", input)],
        () => says("Fertig."),
      ];

      expect(await run(s)).toEqual({ status: "done" });

      expect(await actionsOf(s.runId)).toEqual([
        { key: `${s.runId}:2:1`, status: "done", refusal: null },
      ]);
      expect(actionResults(prompts[2])).toEqual([
        expect.stringMatching(/^Done/),
        expect.stringMatching(/^Refused, nothing was asked/),
      ]);
    },
  );

  /** A Run that creates one block with the real Plan executor, then the student's own block beside it. */
  async function withOwnBlock() {
    executor = createPlanExecutor({ db: runtime });
    const s = await started({ held: lernbloecke() });
    script = [readPlan, () => createBlock(3)];
    await run(s);
    const [own] = await admin.studyBlock.findMany({
      where: { obligationId: s.obligationId },
    });
    const theirs = randomUUID();
    await admin.studyBlock.create({
      data: {
        id: theirs,
        studentId: s.studentId,
        obligationId: s.obligationId,
        placedBy: "student",
        start: new Date(`${day(5)}T09:00:00Z`),
        end: new Date(`${day(5)}T10:00:00Z`),
      },
    });
    return { s, own: own!, theirs };
  }

  it("sees which blocks are its own in a later Run, and moves its own on its Grant", async () => {
    const { s, own } = await withOwnBlock();
    const next = await requested(s.p, s.agentId);
    script = [
      readPlan,
      () =>
        calls("moveOwnStudyBlocks", {
          block: "B1",
          start: `${day(4)}T10:00`,
          end: `${day(4)}T11:00`,
        }),
      () => says("Fertig."),
    ];

    expect(await run(next)).toEqual({ status: "done" });

    const plan = JSON.stringify(prompts.at(-2));
    expect(plan).toMatch(/B1 · [^"\\]*· yours/);
    expect(plan).not.toMatch(/B2 · [^"\\]*· yours/);
    expect(await statuses(next.runId)).toEqual(["done"]);
    const moved = await admin.studyBlock.findUniqueOrThrow({
      where: { id: own.id },
    });
    expect(moved.start.getTime() - own.start.getTime()).toBe(86_400_000);
    expect(moved.createdByAgentId).toBe(s.agentId);
  });

  it("names an Action's work and times in the Verlauf as they were, after its block is removed and its Course Archived", async () => {
    const { s, own } = await withOwnBlock();
    const next = await requested(s.p, s.agentId);
    script = [
      readPlan,
      () =>
        calls("moveOwnStudyBlocks", {
          block: "B1",
          start: `${day(4)}T10:00`,
          end: `${day(4)}T11:00`,
        }),
      () => says("Fertig."),
    ];
    await run(next);
    const moved = await admin.studyBlock.findUniqueOrThrow({
      where: { id: own.id },
    });

    await admin.studyBlock.delete({ where: { id: own.id } });
    await admin.course.updateMany({
      where: { studentId: s.studentId },
      data: { archivedAt: new Date() },
    });

    const work = { title: "Klausur Statistik II", course: "Statistik II" };
    const actionOf = async (runId: string) =>
      (await activity.run(s.p, s.agentId, runId))!.verlauf.find(
        (entry) => entry.type === "action",
      );
    expect(await actionOf(s.runId)).toMatchObject({
      outcome: "done",
      action: {
        kind: "studyBlock.create",
        work,
        start: own.start,
        end: own.end,
      },
    });
    expect(await actionOf(next.runId)).toMatchObject({
      outcome: "done",
      action: {
        kind: "studyBlock.move",
        work,
        start: moved.start,
        end: moved.end,
      },
    });
  });

  it("removes its own block on its Grant, and asks to move the student's", async () => {
    const { s, own, theirs } = await withOwnBlock();
    const next = await requested(s.p, s.agentId);
    script = [
      readPlan,
      () => [
        ...calls("removeOwnStudyBlocks", { block: "B1" }),
        ...calls("moveStudyBlocks", {
          block: "B2",
          start: `${day(6)}T10:00`,
          end: `${day(6)}T11:00`,
        }),
      ],
      () => says("Fertig."),
    ];

    expect(await run(next)).toEqual({ status: "done" });

    expect(await statuses(next.runId)).toEqual(["done", "awaiting_approval"]);
    expect(
      await admin.studyBlock.findMany({
        where: { obligationId: s.obligationId },
        select: { id: true },
      }),
    ).toEqual([{ id: theirs }]);
    expect(own.createdByAgentId).toBe(s.agentId);
  });
});

describe("an Agent's Run creating Tasks (#154)", () => {
  const createTask = (input: object) => calls("createTasks", input);
  /** The Course of the student's exam. */
  const courseOf = async (obligationId: string) =>
    (await admin.obligation.findUniqueOrThrow({ where: { id: obligationId } }))
      .courseId;
  /** A Course Event of the Course, `offset` days ahead at 10:00 UTC, from a confirmed series. */
  async function courseEvent(
    studentId: string,
    courseId: string,
    offset: number,
  ) {
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
        title: "Statistik II Vorlesung",
        courseId,
        confirmedAt: new Date(),
      },
    });
    await admin.fixedEvent.create({
      data: {
        id: eventId,
        studentId,
        calendarId,
        seriesId,
        title: "Statistik II Vorlesung",
        start: new Date(`${day(offset)}T10:00:00Z`),
        end: new Date(`${day(offset)}T12:00:00Z`),
      },
    });
    return eventId;
  }

  it("creates Tasks in its Course, toward the exam it read and for a Course Event it read on Automatisch, its Estimates counting as nunio's", async () => {
    executor = createPlanExecutor({ db: runtime });
    const s = await started({
      held: [{ id: "createTasks", mode: "automatic" }],
    });
    const courseId = await courseOf(s.obligationId);
    const eventId = await courseEvent(s.studentId, courseId, 3);
    script = [
      readPlan,
      () => [
        ...createTask({ title: "Formelsammlung anlegen", course: "K1" }),
        ...createTask({
          title: "Altklausur rechnen",
          obligation: "O1",
          minutes: 90,
        }),
        ...createTask({
          title: "Kapitel 3 lesen",
          event: "E1",
          role: "preparation",
          minutes: 30,
        }),
      ],
      () => says("Fertig."),
    ];

    expect(await run(s)).toEqual({ status: "done" });

    expect(await statuses(s.runId)).toEqual(["done", "done", "done"]);
    expect(
      await admin.task.findMany({
        where: { studentId: s.studentId },
        orderBy: { title: "asc" },
        select: {
          title: true,
          courseId: true,
          obligationId: true,
          fixedEventId: true,
          role: true,
          estimateMinutes: true,
          estimatedBy: true,
        },
      }),
    ).toEqual([
      {
        title: "Altklausur rechnen",
        courseId: null,
        obligationId: s.obligationId,
        fixedEventId: null,
        role: null,
        estimateMinutes: 90,
        estimatedBy: "nunio",
      },
      {
        title: "Formelsammlung anlegen",
        courseId,
        obligationId: null,
        fixedEventId: null,
        role: null,
        estimateMinutes: null,
        estimatedBy: null,
      },
      {
        title: "Kapitel 3 lesen",
        courseId,
        obligationId: null,
        fixedEventId: eventId,
        role: "preparation",
        estimateMinutes: 30,
        estimatedBy: "nunio",
      },
    ]);
    expect(actionResults(prompts[2], "createTasks")).toEqual([
      expect.stringMatching(/^Done: the Task was created as T\d+\.$/),
      expect.stringMatching(/^Done: the Task was created as T\d+\.$/),
      expect.stringMatching(/^Done: the Task was created as T\d+\.$/),
    ]);
    const verlauf = (await activity.run(s.p, s.agentId, s.runId))!.verlauf;
    expect(
      verlauf
        .filter((entry) => entry.type === "action")
        .map((entry) => entry.type === "action" && entry.action),
    ).toEqual(
      ["Formelsammlung anlegen", "Altklausur rechnen", "Kapitel 3 lesen"].map(
        (title) => ({
          kind: "task.create",
          work: { title, course: "Statistik II" },
          start: null,
          end: null,
        }),
      ),
    );
  });

  it("asks on Nachfragen, refuses another Course's work, and asks nothing for a call that names nothing it read, no single target or a Preparation the event has", async () => {
    const s = await started({ held: [{ id: "createTasks", mode: "ask" }] });
    const courseId = await courseOf(s.obligationId);
    const eventId = await courseEvent(s.studentId, courseId, 3);
    await admin.task.create({
      data: {
        id: randomUUID(),
        studentId: s.studentId,
        courseId,
        fixedEventId: eventId,
        role: "preparation",
        title: "Vorbereitung: Statistik II",
      },
    });
    // The same student's other Course, not one of the Agent's, with an exam after the Agent's.
    const otherId = randomUUID();
    await admin.course.create({
      data: {
        id: otherId,
        studentId: s.studentId,
        title: "Mikroökonomik",
        matchTitle: "mikrooekonomik",
        semester: "2026-ws",
        color: "sky",
        status: "accepted",
      },
    });
    await admin.obligation.create({
      data: {
        id: randomUUID(),
        studentId: s.studentId,
        courseId: otherId,
        matchKey: "klausur",
        kind: "exam",
        enteredAt: new Date(),
        correctedAt: new Date(),
        correctedTitle: "Klausur Mikroökonomik",
        correctedDueDate: new Date(`${day(12)}T00:00:00Z`),
        correctedDueTime: "10:00",
        correctedTimeZone: "Europe/Berlin",
      },
    });
    script = [
      readPlan,
      () => [
        ...createTask({ title: "Formelsammlung anlegen", course: "K1" }),
        ...createTask({ title: "Altklausur rechnen", obligation: "O2" }),
        ...createTask({ title: "Lernen", obligation: "O9" }),
        ...createTask({ title: "Lernen", course: "K1", obligation: "O1" }),
        ...createTask({ title: "Lernen", event: "E1", role: "preparation" }),
      ],
      () => says("Fertig."),
    ];

    expect(await run(s)).toEqual({ status: "done" });

    expect(await statuses(s.runId)).toEqual([
      "awaiting_approval",
      "out_of_scope",
    ]);
    expect(actionResults(prompts[2], "createTasks")).toEqual([
      expect.stringMatching(/^Asked, not happened/),
      expect.stringMatching(/^Refused: it is not work of your Courses/),
      expect.stringMatching(/^Refused, nothing was asked: no Obligation/),
      expect.stringMatching(/^Refused, nothing was asked: name exactly one/),
      expect.stringMatching(
        /^Refused, nothing was asked: E1 already has a Preparation/,
      ),
    ]);
  });
});
