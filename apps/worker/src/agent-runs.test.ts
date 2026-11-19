import { randomBytes, randomUUID } from "node:crypto";
import type { Embedder } from "@nunio/ai";
import { createAgentModel, createModels } from "@nunio/ai";
import type { AgentRuns } from "@nunio/chat";
import { createAgentRuns } from "@nunio/chat";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { CatalogModel } from "@nunio/delegation";
import { createAgents, createDelegation, principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import {
  createFacts,
  createKnowledgeReader,
  createSources,
} from "@nunio/knowledge";
import { createPlan } from "@nunio/planning";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import type { WorkflowBundle } from "@temporalio/worker";
import { bundleWorkflowCode, Worker } from "@temporalio/worker";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAgentRunActivities } from "./agent-run-activities.js";

const taskQueue = "agent-runs-test";
let env: TestWorkflowEnvironment;
let workflowBundle: WorkflowBundle;
let db: TestDatabase;
/** Seeds fixtures as the migration role, outside RLS. */
let admin: PrismaClient;
/** Connects as the restricted runtime role, as the worker does. */
let runtime: PrismaClient;
let runs: AgentRuns;
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
/** The Models Chat offers now; a Run's Model must stay among them. */
let offered: CatalogModel[] = [];

/** What the model returns in a step, given its prompt and whether it may call a tool. */
type Scripted = (
  prompt: unknown,
  toolChoice: string,
) => unknown[] | Promise<unknown[]>;
/** The model's next steps; with none queued it answers "Fertig.". */
let script: Scripted[] = [];
const prompts: unknown[] = [];
const toolChoices: string[] = [];
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
  }: {
    prompt: unknown;
    toolChoice?: { type: string };
  }) => {
    prompts.push(prompt);
    const choice = toolChoice?.type ?? "auto";
    toolChoices.push(choice);
    const content = await (script.shift() ?? (() => says("Fertig.")))(
      prompt,
      choice,
    );
    const reason = content.some(
      (part) => (part as { type: string }).type === "tool-call",
    )
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
  const delegation = createDelegation({ db: runtime, aiEnabled: () => true });
  const facts = createFacts({ db: runtime, keys, clock });
  agents = createAgents({ db: runtime, clock });
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
    modelFor: (config) =>
      createAgentModel({
        ...testModels.fromConfig(config),
        model,
        estimateMicroUsd: () => 1,
        actualMicroUsd: () => 1,
      }),
    clock,
  });
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await Promise.all([env?.teardown(), db?.stop()]);
});

beforeEach(() => {
  offered = [sonnet];
  script = [];
  prompts.length = 0;
  toolChoices.length = 0;
});

/** A student whose free-text Agent has one Course with one ready Source, and who started a Run of it now. */
async function started() {
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
  const created = await agents.create(p, {
    name: "Klausur Statistik",
    description: "",
    emoji: "🤖",
    instructions: "Sag mir, wann meine Klausur in Statistik ist.",
    courseIds: [courseId],
    capabilities: [],
    budgetMicroUsd: 1_000_000,
  });
  if (created.status !== "ok") throw new Error(created.status);
  const requested = await agents.requestRun(p, created.id);
  if (requested.status !== "ok") throw new Error(requested.status);
  return {
    p,
    studentId,
    agentId: created.id,
    runId: requested.runId,
    workflowId: requested.workflowId,
  };
}

/** Runs the Run's workflow to its end on a worker with the given Activities. */
async function run(
  s: Awaited<ReturnType<typeof started>>,
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

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

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
});
