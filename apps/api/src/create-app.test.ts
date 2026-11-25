import { execFile } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type {
  Embedder,
  Estimator,
  Extracted,
  Grader,
  Maker,
  SeriesAssigner,
} from "@nunio/ai";
import { createAnswerer, createBuilderModel, createModels } from "@nunio/ai";
import type { Artifacts } from "@nunio/artifacts";
import { createArtifacts } from "@nunio/artifacts";
import type { AgentRuns } from "@nunio/chat";
import {
  createActivity,
  createAgentRuns,
  createBuilder,
  createChats,
} from "@nunio/chat";
import type { Pool, PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type {
  Agents,
  CatalogModel,
  Delegation,
  Executor,
  Principal,
  Schedules,
} from "@nunio/delegation";
import {
  agentTemplates,
  capabilityIds,
  createAgents,
  createDelegation,
  createModelCatalog,
  principal,
  withOwner,
} from "@nunio/delegation";
import { createAuth } from "@nunio/identity";
import { createCatalog, createConnections } from "@nunio/integrations";
import type { FakeMailServer, MailAccount } from "@nunio/integrations/testing";
import {
  startFakeMailServer,
  startSmtpFaultServer,
} from "@nunio/integrations/testing";
import { createConnectionCredentialKeys, createSourceKeys } from "@nunio/keys";
import type { Facts, Sources, TopicAreas } from "@nunio/knowledge";
import {
  createCourses,
  createFacts,
  createKnowledgeReader,
  createProjects,
  createSources,
  createTopicAreas,
} from "@nunio/knowledge";
import { createOutreach, sendBriefing, sendNotice } from "@nunio/outreach";
import {
  createPlan,
  createPlanExecutor,
  deadline,
  planRules,
} from "@nunio/planning";
import type { Understanding } from "@nunio/understanding";
import { createUnderstanding } from "@nunio/understanding";
import { APICallError } from "ai";
import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ArtifactWorkflows } from "./artifact-workflows.js";
import { createChatModels } from "./chat-models.js";
import type { AppDeps } from "./create-app.js";
import { createApp } from "./create-app.js";
import type { RunWorkflows } from "./run-workflows.js";

const appOrigin = "https://app.nunio.test";
const apiOrigin = "https://api.nunio.test";
const evilOrigin = "https://evil.test";
const run = Date.now().toString(36);
const execute = promisify(execFile);

const webhookSecret = "spike-c-webhook-secret";

let db: TestDatabase;
let pool: Pool;
/** The restricted runtime role the deployed API uses. */
let prisma: PrismaClient;
/** The migration role, for fixtures and fault injection outside RLS. */
/** Workflows the API asked to start, as [kind, studentId, sourceId]. */
const started: unknown[][] = [];
/** Makes starting a workflow fail, as when Temporal is unreachable. */
let workflowsDown = false;
let admin: PrismaClient;
let app: ReturnType<typeof createApp>;
/** What the app was built from, to build another one with a dependency swapped. */
let appDeps: AppDeps;
const connectionCredentials = createConnectionCredentialKeys({
  activeVersion: "test",
  masters: { test: randomBytes(32) },
});
let sources: Sources;
let facts: Facts;
let topicAreas: TopicAreas;
let delegation: Delegation;
let agents: Agents;
let artifacts: Artifacts;
let understanding: Understanding;
let agentRuns: AgentRuns;
/** The Artifact Runs the API asked to start, by run ID; the worker would then make each. */
const artifactRuns: string[] = [];
const artifactWorkflows: ArtifactWorkflows = {
  start: async (runId) => void artifactRuns.push(runId),
};
const maker: Maker = {
  estimateMicroUsd: () => 1,
  practiceSet: async (input) => ({
    value: {
      title: "Klausurthemen",
      items: [
        {
          id: "1",
          topicIds: [input.topics[0]!.id],
          question: "Was kommt in der Klausur dran? [S1]",
          answer: "Konvergenz [S1].",
          cited: ["S1"],
        },
      ],
    },
    usage: { microUsd: 1 },
  }),
  flashcards: async (input) => ({
    value: {
      title: "Klausurbegriffe",
      cards: [
        {
          id: "1",
          topicIds: [input.topics[0]!.id],
          front: "Klausur",
          back: "Gleichmäßige Konvergenz\nund mehr [S1].",
          cited: ["S1"],
        },
      ],
    },
    usage: { microUsd: 1 },
  }),
  draft: async () => ({
    value: { text: "Entwurf [S1].", cited: ["S1"] },
    usage: { microUsd: 1 },
  }),
  critique: async () => ({
    value: { text: "Kritik [S1].", cited: ["S1"] },
    usage: { microUsd: 1 },
  }),
};
const grader: Grader = {
  estimateMicroUsd: () => 1,
  grade: async () => ({
    value: { verdict: "correct", text: "Richtig [S1].", cited: ["S1"] },
    usage: { microUsd: 1 },
  }),
};
/** What the API asked of Agent Schedules, in order. */
const scheduled: string[] = [];
/** The Agent Runs the API started now, in order; the worker would then run each. */
const agentRunsStarted: {
  studentId: string;
  agentId: string;
  runId: string;
  workflowId: string;
}[] = [];
let agentRunsDown = false;
/** The Agent Runs the API told to stop, in order, and the workflows that no longer run, as Temporal would say. */
const agentRunsStopped: { workflowId: string; reason: string }[] = [];
const goneWorkflows = new Set<string>();
/** The workflows the API asked Temporal about, and those it cancelled, in order. */
const workflowsAsked: string[] = [];
const runsCancelled: string[] = [];
const runWorkflows: RunWorkflows = {
  startAgentRun: async (run) => {
    if (agentRunsDown) throw new Error("Temporal unavailable");
    agentRunsStarted.push(run);
  },
  stopAgentRun: async (workflowId, reason) => {
    if (goneWorkflows.has(workflowId)) return false;
    agentRunsStopped.push({ workflowId, reason });
    return true;
  },
  agentRunAlive: async (workflowId) => {
    workflowsAsked.push(workflowId);
    return !goneWorkflows.has(workflowId);
  },
  cancelRun: async (workflowId) => void runsCancelled.push(workflowId),
};
const schedules: Schedules = {
  save: async ({ agentId, trigger, timeZone, paused }) =>
    void scheduled.push(
      `save ${agentId} ${JSON.stringify(trigger)} ${timeZone}${paused ? " paused" : ""}`,
    ),
  delete: async (id) => void scheduled.push(`delete ${id}`),
};
/** The Chat model's input for each step, in order (`JSON.stringify` it to search it). */
const prompts: unknown[] = [];
/** Whether each step let the Chat model call a tool, in order. */
const toolChoices: unknown[] = [];
/** The tools each step offered the Chat model, by name, in order. */
const offeredTools: string[][] = [];
/** The tools each step offered the model, with their input schemas, in order. */
const offeredToolSchemas: Record<string, unknown>[] = [];
/** What the Chat model streams in its next steps; with none queued, one step of `reasoningText` and `reply`. */
const steps: (unknown[] | ((prompt: unknown) => unknown[]))[] = [];
let reply = "";
let reasoningText: string | undefined;
let finishAnswer: Promise<void> | undefined;
/** The Models Chat answers were asked of, in order. */
const answeredWith: CatalogModel[] = [];
const searches = (query: string) => [
  {
    type: "tool-call",
    toolCallId: `call-${randomUUID()}`,
    toolName: "searchMaterial",
    input: JSON.stringify({ query }),
  },
];
/** The Chat model calls `toolName` with `input`. */
const calls = (toolName: string, input: unknown) => [
  {
    type: "tool-call",
    toolCallId: `call-${randomUUID()}`,
    toolName,
    input: JSON.stringify(input),
  },
];
const says = (text: string) => [
  { type: "text-start", id: "text" },
  { type: "text-delta", id: "text", delta: text },
  { type: "text-end", id: "text" },
];
/** The provider rejects the Chat model's step with HTTP `status`, before streaming anything. */
const rejects =
  (status: number, headers: Record<string, string> = {}) =>
  () => {
    throw new APICallError({
      message: `HTTP ${status}`,
      url: "https://provider.invalid",
      requestBodyValues: {},
      statusCode: status,
      responseHeaders: headers,
    });
  };
const thinks = (text: string) => [
  { type: "reasoning-start", id: "reasoning" },
  { type: "reasoning-delta", id: "reasoning", delta: text },
  { type: "reasoning-end", id: "reasoning" },
];
/** Stands in for the provider, so Chat answers run the real Answerer and tool loop. */
const chatModel = new MockLanguageModelV4({
  doStream: async ({
    prompt,
    toolChoice,
    tools,
  }: {
    prompt: unknown;
    toolChoice?: unknown;
    tools?: { name: string; inputSchema?: unknown }[];
  }) => {
    prompts.push(prompt);
    toolChoices.push(toolChoice);
    offeredTools.push((tools ?? []).map((tool) => tool.name));
    offeredToolSchemas.push(
      Object.fromEntries(
        (tools ?? []).map((tool) => [tool.name, tool.inputSchema]),
      ),
    );
    const next = steps.shift();
    const parts = (typeof next === "function" ? next(prompt) : next) ?? [
      ...(reasoningText ? thinks(reasoningText) : []),
      ...says(reply),
    ];
    const reason = parts.some(
      (part) => (part as { type: string }).type === "tool-call",
    )
      ? "tool-calls"
      : "stop";
    const finish = {
      type: "finish",
      finishReason: { unified: reason, raw: reason },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
    };
    // Only an answering step waits, so a test can hold an answer after its searches ran.
    const gate = reason === "stop" ? finishAnswer : undefined;
    return {
      stream: gate
        ? new ReadableStream({
            async start(controller) {
              controller.enqueue({ type: "stream-start", warnings: [] });
              for (const part of parts) controller.enqueue(part);
              await gate;
              controller.enqueue(finish);
              controller.close();
            },
          })
        : convertArrayToReadableStream([
            { type: "stream-start", warnings: [] },
            ...parts,
            finish,
          ]),
    };
  },
} as never);
/** A step's conversation as [role, text], without the system instructions. */
const conversation = (prompt: unknown) =>
  (
    prompt as {
      role: string;
      content: string | { type: string; text?: string }[];
    }[]
  )
    .filter((message) => message.role !== "system")
    .map((message) => [
      message.role,
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => part.text ?? "").join(""),
    ]);
const testModels = createModels({
  apiKey: "test",
  baseURL: "https://provider.invalid",
  catalog: [],
});
let estimatorCalls = 0;
const estimator: Estimator = {
  estimateMicroUsd: () => 1,
  async estimate(items) {
    estimatorCalls++;
    return {
      value: items.map(() => ({ minutes: 120, rationale: "Two proofs." })),
      usage: { microUsd: 1 },
    };
  },
};
/** Puts every Event Series in the student's first Course. */
const seriesAssigner: SeriesAssigner = {
  assignMicroUsd: () => 1,
  async assign(input) {
    return {
      value: input.series.map(() => input.courses[0]?.handle ?? null),
      usage: { microUsd: 1 },
    };
  },
};
/** One dimension per keyword, so a question finds the passages that share its keywords. */
const chatEmbedder: Embedder = {
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
/** The latest sign-in code emailed to each address. */
const signInCodes = new Map<string, string>();

beforeAll(async () => {
  db = await startTestDatabase();
  pool = createPool(db.runtimeConnectionString);
  prisma = createPrismaClient(pool);
  admin = createPrismaClient(createPool(db.connectionString));
  const auth = createAuth({
    prisma,
    baseURL: apiOrigin,
    appOrigin,
    trustedOrigins: [appOrigin],
    cookieDomain: "nunio.test",
    secret: "spike-b-test-secret-that-is-long-enough",
    email: {
      projectId: "test-project",
      secretKey: "test-key",
      from: "accounts@nunio.test",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const body = (await request.json()) as {
          to: { email: string }[];
          text: string;
        };
        signInCodes.set(body.to[0]!.email, body.text.match(/\b\d{6}\b/)![0]);
        return Response.json(
          { emails: [{ id: "test-email" }] },
          { status: 201 },
        );
      },
    },
  });
  delegation = createDelegation({
    db: prisma,
    aiEnabled: () => true,
    executors: { plan: createPlanExecutor({ db: prisma }) },
    planRules,
    deadlineOf: async (studentId, obligationId) =>
      (await plan.view(principal.fromSession({ studentId }))).obligations.find(
        (o) => o.id === obligationId,
      )?.due ?? null,
  });
  const keys = createSourceKeys({
    activeVersion: "test",
    masters: { test: randomBytes(32) },
  });
  sources = createSources({
    db: prisma,
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
  facts = createFacts({ db: prisma, keys, clock: { now: () => new Date() } });
  topicAreas = createTopicAreas({
    db: prisma,
    facts,
    clock: { now: () => new Date() },
  });
  const reader = createKnowledgeReader({
    db: prisma,
    keys,
    embedder: chatEmbedder,
    delegation,
    clock: { now: () => new Date() },
  });
  const plan = createPlan({
    db: prisma,
    facts,
    clock: { now: () => new Date() },
  });
  const chats = createChats({
    db: prisma,
    keys,
    reader,
    delegation,
    plan,
    clock: { now: () => new Date() },
    // Created further down; read when a Chat starts an Artifact.
    artifacts: {
      request: (...args) => artifacts.request(...args),
      list: (...args) => artifacts.list(...args),
    },
    understanding: {
      levels: (...args) => understanding.levels(...args),
    },
    startArtifactRun: (runId) => artifactWorkflows.start(runId),
  });
  agents = createAgents({
    db: prisma,
    schedules,
    clock: { now: () => new Date() },
    runAlive: (workflowId) => runWorkflows.agentRunAlive(workflowId),
  });
  artifacts = createArtifacts({
    db: prisma,
    keys,
    reader,
    facts,
    agents,
    delegation,
    maker,
    clock: { now: () => new Date() },
  });
  understanding = createUnderstanding({
    db: prisma,
    keys,
    artifacts,
    reader,
    facts,
    delegation,
    grader,
    clock: { now: () => new Date() },
  });
  // Only to end Runs as the worker does; no step runs here.
  agentRuns = createAgentRuns({
    db: prisma,
    keys,
    reader,
    facts,
    plan,
    understanding,
    artifacts,
    delegation,
    agents,
    startArtifactRun: async () => {
      throw new Error("No Run starts an Artifact Run in the API");
    },
    catalog: { chatModels: async () => [] },
    modelFor: () => {
      throw new Error("No model step runs in the API");
    },
    clock: { now: () => new Date() },
  });
  appDeps = {
    artifacts,
    artifactWorkflows,
    understanding,
    agents,
    activity: createActivity({
      db: prisma,
      keys,
      facts,
      clock: { now: () => new Date() },
    }),
    runWorkflows,
    auth,
    prisma,
    delegation,
    appOrigin,
    sources,
    facts,
    chats,
    chatModels: createChatModels({
      catalog: createModelCatalog({
        db: prisma,
        clock: { now: () => new Date() },
      }),
      answererFor: (model) => {
        answeredWith.push(model);
        return createAnswerer({
          ...testModels.fromConfig(model),
          model: chatModel,
          estimateMicroUsd: () => 1,
          actualMicroUsd: () => 1,
        });
      },
    }),
    plan,
    builder: createBuilder({ db: prisma, delegation }),
    // The builder's task Model, answered by the scripted model like Chat.
    builderModel: createBuilderModel({
      ...testModels.fromConfig({
        key: "sonnet-5.5-reasoning-high",
        providerModelId: "anthropic/claude-sonnet-5.5",
        reasoningEffort: "high",
        maxOutputTokens: 1000,
        prices: [
          {
            minPromptTokens: 0,
            inputMicroUsdPerMTok: 3_000_000,
            outputMicroUsdPerMTok: 15_000_000,
          },
        ],
        upstream: [],
      }),
      model: chatModel,
      estimateMicroUsd: () => 1,
      actualMicroUsd: () => 1,
    }),
    estimator,
    seriesAssigner,
    projects: createProjects({ db: prisma }),
    courses: createCourses({
      db: prisma,
      clock: { now: () => new Date() },
      facts,
      agents,
    }),
    outreach: createOutreach({
      db: prisma,
      keys,
      clock: { now: () => new Date() },
      vapidPublicKey: "test-vapid-key",
    }),
    sourceWorkflows: {
      start: async (...args) => {
        if (workflowsDown) throw new Error("Temporal unavailable");
        started.push(args);
      },
      groupCourse: async (...args) => {
        if (workflowsDown) throw new Error("Temporal unavailable");
        started.push(["groupCourse", ...args]);
      },
    },
    topicAreas,
    integrationCatalog: createCatalog({ db: prisma }),
    // Under INTEGRATION_FAKES, so the fake mail server on localhost is reachable.
    connections: createConnections({
      db: prisma,
      keys,
      credentials: connectionCredentials,
      fakes: true,
    }),
    spike: { webhookSecret, pool },
  };
  app = createApp(appDeps);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

function call(
  path: string,
  init: {
    origin: string;
    body?: unknown;
    cookie?: string;
    invitation?: string;
  },
) {
  const headers = new Headers({ origin: init.origin });
  if (init.invitation) headers.set("x-invitation-token", init.invitation);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return app.request(`${apiOrigin}/api/auth${path}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function cookieOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0]!)
    .join("; ");
}

async function invite(address: string): Promise<string> {
  const invitation = randomBytes(32).toString("base64url");
  await admin.invitation.create({
    data: {
      tokenHash: createHash("sha256").update(invitation).digest("hex"),
      email: address,
      issuedBy: "api-test-operator",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  return invitation;
}

/** Sends a code to `address` and enters it, as the sign-in screen does. */
async function signInWithCode(
  address: string,
  invitation?: string,
): Promise<Response> {
  // @nunio/identity tests the limits per address; each sign-in here starts with none used.
  await admin.signInCodeLimit.deleteMany({
    where: { key: { in: [`code-resend:${address}`, `code-sends:${address}`] } },
  });
  signInCodes.delete(address);
  const sent = await call("/email-otp/send-verification-otp", {
    origin: appOrigin,
    body: { email: address, type: "sign-in" },
  });
  expect(sent.status).toBe(200);
  return call("/sign-in/email-otp", {
    origin: appOrigin,
    invitation,
    body: { email: address, otp: signInCodes.get(address) ?? "000000" },
  });
}

async function signUp(name: string): Promise<string> {
  const address = `${name}+${run}@example.com`;
  const response = await signInWithCode(address, await invite(address));
  expect(response.status).toBe(200);
  return cookieOf(response);
}

function revokePilot(studentId: string, operator = "pilot-founder") {
  return execute(
    process.execPath,
    [
      fileURLToPath(import.meta.resolve("@nunio/billing/revoke-pilot")),
      studentId,
    ],
    {
      env: {
        PATH: process.env.PATH,
        OPERATOR_DATABASE_URL: db.connectionString,
        OPERATOR_ID: operator,
      },
    },
  );
}

async function studentId(cookie: string): Promise<string> {
  const response = await call("/get-session", { origin: appOrigin, cookie });
  const session = (await response.json()) as { user: { id: string } };
  return session.user.id;
}

describe("the student's pilot entitlement", () => {
  it("activates pilot access when an invited student enters their first code", async () => {
    const cookie = await signUp("pilot-active");
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "active" });
  });

  it("recovers pilot activation on the next sign-in after the first activation failed", async () => {
    const address = `pilot-activation-retry+${run}@example.com`;
    const invitation = await invite(address);
    // Scope the injected database fault to this student, including on a shared test branch.
    await admin.$executeRawUnsafe(`CREATE FUNCTION reject_pilot_activation_test() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF (SELECT email FROM "user" WHERE id = NEW."studentId") = '${address}' THEN
          RAISE EXCEPTION 'temporary pilot activation failure';
        END IF;
        RETURN NEW;
      END; $$`);
    try {
      await admin.$executeRaw`CREATE TRIGGER reject_pilot_activation_test
        BEFORE INSERT ON "pilot_entitlement" FOR EACH ROW EXECUTE FUNCTION reject_pilot_activation_test()`;
      expect((await signInWithCode(address, invitation)).status).toBe(500);
    } finally {
      await admin.$executeRaw`DROP TRIGGER IF EXISTS reject_pilot_activation_test ON "pilot_entitlement"`;
      await admin.$executeRaw`DROP FUNCTION reject_pilot_activation_test()`;
    }
    const signIn = await signInWithCode(address);
    expect(signIn.status).toBe(200);
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie: cookieOf(signIn) },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "active" });
  });
  it("requires a current session even when the caller supplies a student ID", async () => {
    const response = await app.request(
      `${apiOrigin}/api/me/entitlement?studentId=someone-else`,
      {
        headers: { "x-student-id": "someone-else" },
      },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a previously valid cookie after sign-out", async () => {
    const cookie = await signUp("pilot-signed-out");
    const signOut = await call("/sign-out", {
      origin: appOrigin,
      cookie,
      body: {},
    });
    expect(signOut.status).toBe(200);

    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie },
    });
    expect(response.status).toBe(401);
  });

  it("refuses an existing session when its account is no longer verified", async () => {
    const cookie = await signUp("pilot-unverified");
    // A legacy session must not authorize access using an obsolete verified flag.
    await admin.user.update({
      where: { email: `pilot-unverified+${run}@example.com` },
      data: { emailVerified: false },
    });

    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie },
    });
    expect(response.status).toBe(401);
  });

  it("keeps pilot access active a year after activation", async () => {
    await signUp("pilot-indefinite");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 31_536_000_000);
      const cookie = await signIn("pilot-indefinite");
      const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
        headers: { cookie },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "active" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("does not grant pilot access to a verified account that never accepted an invitation", async () => {
    const address = `pilot-legacy+${run}@example.com`;
    const studentId = randomUUID();
    await admin.user.create({
      data: {
        id: studentId,
        name: "Legacy",
        email: address,
        emailVerified: true,
      },
    });
    const signIn = await signInWithCode(address);
    expect(signIn.status).toBe(200);
    const cookie = cookieOf(signIn);
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "none" });
  });

  it("lets the founder revoke access immediately while preserving the student's session", async () => {
    const cookie = await signUp("pilot-revoked");
    const id = await studentId(cookie);
    const active = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie },
    });
    expect(await active.json()).toEqual({ status: "active" });
    const before = Date.now();
    const { stdout } = await revokePilot(id, "founder-revocation-test");
    const record = JSON.parse(stdout) as {
      studentId: string;
      revokedAt: string;
      revokedBy: string;
    };

    expect(record.studentId).toBe(id);
    expect(record.revokedBy).toBe("founder-revocation-test");
    expect(Date.parse(record.revokedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(record.revokedAt)).toBeLessThanOrEqual(Date.now());
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "revoked" });
    expect(await studentId(cookie)).toBe(id);
  });

  it("reads only the current student's entitlement despite forged student IDs", async () => {
    const revoked = await signUp("pilot-owner-revoked");
    const active = await signUp("pilot-owner-active");
    const revokedId = await studentId(revoked);
    const activeId = await studentId(active);
    await revokePilot(revokedId);
    const [revokedResponse, activeResponse] = await Promise.all([
      app.request(`${apiOrigin}/api/me/entitlement?studentId=${activeId}`, {
        headers: { cookie: revoked, "x-student-id": activeId },
      }),
      app.request(`${apiOrigin}/api/me/entitlement?studentId=${revokedId}`, {
        headers: { cookie: active, "x-student-id": revokedId },
      }),
    ]);

    expect(revokedResponse.status).toBe(200);
    expect(activeResponse.status).toBe(200);
    expect(await revokedResponse.json()).toEqual({ status: "revoked" });
    expect(await activeResponse.json()).toEqual({ status: "active" });
  });

  it("preserves the original audit record when revocation is repeated", async () => {
    const cookie = await signUp("pilot-revoke-twice");
    const id = await studentId(cookie);
    const first = await revokePilot(id, "original-founder");
    const repeated = await revokePilot(id, "another-operator");

    expect(JSON.parse(repeated.stdout)).toEqual(JSON.parse(first.stdout));
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie },
    });
    expect(await response.json()).toEqual({ status: "revoked" });
  });

  it("does not restore revoked pilot access when the student signs in again", async () => {
    const cookie = await signUp("pilot-revoked-login");
    const id = await studentId(cookie);
    const original = await revokePilot(id, "original-founder");
    const newCookie = await signIn("pilot-revoked-login");
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie: newCookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "revoked" });
    const repeated = await revokePilot(id, "another-operator");
    expect(JSON.parse(repeated.stdout)).toEqual(JSON.parse(original.stdout));
  });

  it("refuses an unaudited revocation and leaves pilot access active", async () => {
    const cookie = await signUp("pilot-no-operator");
    const id = await studentId(cookie);

    await expect(revokePilot(id, "")).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("OPERATOR_ID"),
    });
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie },
    });
    expect(await response.json()).toEqual({ status: "active" });
  });

  it("refuses to revoke a pilot entitlement that does not exist", async () => {
    await expect(revokePilot("missing-student")).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("Pilot entitlement not found"),
    });
  });
});

async function signIn(name: string): Promise<string> {
  const response = await signInWithCode(`${name}+${run}@example.com`);
  expect(response.status).toBe(200);
  return cookieOf(response);
}

describe("the student's Allowance", () => {
  it("starts a newly activated student with a $5 Allowance", async () => {
    const cookie = await signUp("allowance-new");
    const response = await app.request(`${apiOrigin}/api/me/allowance`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      limitMicroUsd: 5_000_000,
      usedMicroUsd: 0,
      heldMicroUsd: 0,
    });
  });

  it("reads only the current student's Allowance despite forged student IDs", async () => {
    const spender = await signUp("allowance-spender");
    const saver = await signUp("allowance-saver");
    const spenderId = await studentId(spender);
    const saverId = await studentId(saver);
    await admin.allowance.update({
      where: { studentId: spenderId },
      data: { usedMicroUsd: 1_200_000 },
    });

    const [spent, saved] = await Promise.all([
      app.request(`${apiOrigin}/api/me/allowance?studentId=${saverId}`, {
        headers: { cookie: spender, "x-student-id": saverId },
      }),
      app.request(`${apiOrigin}/api/me/allowance?studentId=${spenderId}`, {
        headers: { cookie: saver, "x-student-id": spenderId },
      }),
    ]);

    expect(await spent.json()).toEqual({
      limitMicroUsd: 5_000_000,
      usedMicroUsd: 1_200_000,
      heldMicroUsd: 0,
    });
    expect(await saved.json()).toEqual({
      limitMicroUsd: 5_000_000,
      usedMicroUsd: 0,
      heldMicroUsd: 0,
    });
  });

  it("shows an empty Allowance to a verified account without pilot access", async () => {
    const address = `allowance-legacy+${run}@example.com`;
    const id = randomUUID();
    await admin.user.create({
      data: {
        id,
        name: "Legacy",
        email: address,
        emailVerified: true,
      },
    });
    const cookie = cookieOf(await signInWithCode(address));

    const response = await app.request(`${apiOrigin}/api/me/allowance`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      limitMicroUsd: 0,
      usedMicroUsd: 0,
      heldMicroUsd: 0,
    });
  });
});

describe("the student's sessions", () => {
  it("lists the student's sessions and revokes one without ending the others", async () => {
    const laptop = await signUp("sessions-revoke-one");
    const phone = await signIn("sessions-revoke-one");
    const listed = await call("/list-sessions", {
      origin: appOrigin,
      cookie: laptop,
    });
    const sessions = (await listed.json()) as { token: string }[];
    expect(sessions).toHaveLength(2);
    const phoneSession = (await (
      await call("/get-session", { origin: appOrigin, cookie: phone })
    ).json()) as {
      session: { token: string };
    };

    const revoked = await call("/revoke-session", {
      origin: appOrigin,
      cookie: laptop,
      body: { token: phoneSession.session.token },
    });

    expect(revoked.status).toBe(200);
    expect(
      await (
        await call("/get-session", { origin: appOrigin, cookie: phone })
      ).json(),
    ).toBeNull();
    expect(await studentId(laptop)).toBeTruthy();
  });

  it("cannot revoke another student's session by its token", async () => {
    const mallory = await signUp("sessions-mallory");
    const victim = await signUp("sessions-victim");
    const victimSession = (await (
      await call("/get-session", { origin: appOrigin, cookie: victim })
    ).json()) as {
      session: { token: string };
    };

    await call("/revoke-session", {
      origin: appOrigin,
      cookie: mallory,
      body: { token: victimSession.session.token },
    });

    expect(await studentId(victim)).toBeTruthy();
  });

  it("signs the student out everywhere from a recent sign-in", async () => {
    const laptop = await signUp("sessions-everywhere");
    const phone = await signIn("sessions-everywhere");

    const revoked = await call("/revoke-sessions", {
      origin: appOrigin,
      cookie: laptop,
      body: {},
    });

    expect(revoked.status).toBe(200);
    for (const cookie of [laptop, phone]) {
      expect(
        await (
          await call("/get-session", { origin: appOrigin, cookie })
        ).json(),
      ).toBeNull();
    }
  });

  it("refuses signing out everywhere from an untrusted origin", async () => {
    const cookie = await signUp("sessions-forged-everywhere");

    const forged = await call("/revoke-sessions", {
      origin: evilOrigin,
      cookie,
      body: {},
    });

    expect(forged.status).toBe(403);
    expect(await studentId(cookie)).toBeTruthy();
  });

  it("asks the student to sign in again before signing out everywhere from an older session", async () => {
    const laptop = await signUp("sessions-everywhere-old");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
      const refused = await call("/revoke-sessions", {
        origin: appOrigin,
        cookie: laptop,
        body: {},
      });

      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
      expect(await studentId(laptop)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the student's deletion request", () => {
  function requestDeletion(cookie: string, origin = appOrigin) {
    return app.request(`${apiOrigin}/api/me/deletion-request`, {
      method: "POST",
      headers: { origin, cookie },
    });
  }

  it("accepts the request from a recent sign-in and ends every session", async () => {
    const laptop = await signUp("deletion-requested");
    const phone = await signIn("deletion-requested");

    const response = await requestDeletion(laptop);

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "pending" });
    for (const cookie of [laptop, phone]) {
      expect(
        await (
          await call("/get-session", { origin: appOrigin, cookie })
        ).json(),
      ).toBeNull();
    }
  });

  it("asks the student to sign in again after ten minutes and keeps their sessions", async () => {
    const cookie = await signUp("deletion-sign-in-again");
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
      const response = await requestDeletion(cookie);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "sign_in_again" });
      expect(await studentId(cookie)).toBeTruthy();
      const fresh = await signIn("deletion-sign-in-again");
      expect((await requestDeletion(fresh)).status).toBe(202);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses signing in again once deletion is requested", async () => {
    const cookie = await signUp("deletion-sign-in");
    expect((await requestDeletion(cookie)).status).toBe(202);

    const response = await signInWithCode(
      `deletion-sign-in+${run}@example.com`,
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "DELETION_PENDING" });
    expect(
      response.headers
        .getSetCookie()
        .filter(
          (value) =>
            value.includes("session_token=") && !value.includes("Max-Age=0"),
        ),
    ).toEqual([]);
  });

  it("refuses a cookie-bearing request from an untrusted origin and keeps the account", async () => {
    const cookie = await signUp("deletion-forged");

    const forged = await requestDeletion(cookie, evilOrigin);

    expect(forged.status).toBe(403);
    expect(await studentId(cookie)).toBeTruthy();
  });
});

describe("the API's auth routes from other origins", () => {
  it("refuses a cookie-bearing sign-out from an untrusted origin and keeps the session", async () => {
    const cookie = await signUp("mallory-target");

    const forged = await call("/sign-out", {
      origin: evilOrigin,
      body: {},
      cookie,
    });
    expect(forged.status).toBe(403);

    const session = await call("/get-session", { origin: appOrigin, cookie });
    expect(await session.json()).toMatchObject({
      user: { email: `mallory-target+${run}@example.com` },
    });
  });

  it("lets only the app origin make credentialed cross-origin calls", async () => {
    const preflight = (origin: string) =>
      app.request(`${apiOrigin}/api/auth/sign-in/email-otp`, {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });

    const fromApp = await preflight(appOrigin);
    expect(fromApp.headers.get("access-control-allow-origin")).toBe(appOrigin);
    expect(fromApp.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );

    const fromEvil = await preflight(evilOrigin);
    expect(fromEvil.headers.get("access-control-allow-origin")).not.toBe(
      evilOrigin,
    );
    expect(fromEvil.headers.get("access-control-allow-origin")).not.toBe("*");
  });
});

describe("the spike pool header", () => {
  it("reports the serving instance's pool on a database request", async () => {
    const cookie = await signUp("pool-reader");
    const res = await call("/get-session", { origin: appOrigin, cookie });
    expect(res.headers.get("x-spike-instance")).toMatch(/^[0-9a-f-]{36}$/);
    // Before the handler: the sign-up's connection is still idle in the pool (5 s timeout).
    expect(res.headers.get("x-spike-pool-before")).toMatch(
      /^total=([1-9]\d*) idle=\1 waiting=0$/,
    );
    // Every connection is back in the pool by the time the response leaves.
    expect(res.headers.get("x-spike-pool")).toMatch(
      /^total=([1-9]\d*) idle=\1 waiting=0$/,
    );
  });
});

describe("the spike raw-body route", () => {
  const signedBody = '{"id":"evt_1","type":"invoice.paid","amount":1999}';
  const signature = createHmac("sha256", webhookSecret)
    .update(signedBody)
    .digest("hex");

  const post = (body: string) =>
    app.request(`${apiOrigin}/spike/raw-body`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-spike-signature": signature,
      },
      body,
    });

  it("accepts the exact bytes that were signed", async () => {
    const res = await post(signedBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ verified: true, bytes: 50 });
  });

  it("rejects a body with one byte changed", async () => {
    const res = await post(signedBody.replace("1999", "1998"));
    expect(res.status).toBe(401);
  });

  it("rejects the same JSON with its keys reordered", async () => {
    const res = await post(
      '{"type":"invoice.paid","id":"evt_1","amount":1999}',
    );
    expect(res.status).toBe(401);
  });
});

it("uploads and deletes an owned PDF through authenticated, origin-protected routes", async () => {
  const cookie = await signUp("source-upload");
  const headers = {
    cookie,
    origin: appOrigin,
    "content-type": "application/json",
  };
  const res = await app.request(`${apiOrigin}/api/me/sources`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "Syllabus.pdf",
      bytes: 1234,
      type: "application/pdf",
    }),
  });
  expect(res.status).toBe(201);
  const data = (await res.json()) as {
    source: { id: string };
    upload: { url: string };
  };
  expect(data.upload.url).toMatch(/^https:/);
  const listed = await app.request(`${apiOrigin}/api/me/sources`, {
    headers: { cookie },
  });
  expect(await listed.json()).toEqual([
    expect.objectContaining({ id: data.source.id, status: "uploading" }),
  ]);
  const foreignOrigin = await app.request(
    `${apiOrigin}/api/me/sources/${data.source.id}`,
    { method: "DELETE", headers: { cookie, origin: evilOrigin } },
  );
  expect(foreignOrigin.status).toBe(403);
  const complete = await app.request(
    `${apiOrigin}/api/me/sources/${data.source.id}/complete`,
    { method: "POST", headers },
  );
  expect(complete.status).toBe(202);
  const removed = await app.request(
    `${apiOrigin}/api/me/sources/${data.source.id}`,
    { method: "DELETE", headers },
  );
  expect(removed.status).toBe(202);
  const gone = await app.request(`${apiOrigin}/api/me/sources`, {
    headers: { cookie },
  });
  expect(await gone.json()).toEqual([]);
});

/** A student with one extracted Source: Analysis I and its Blatt 3. */
async function reviewFixture(name: string, extracted: Extracted["facts"] = []) {
  const cookie = await signUp(name);
  const p = principal.fromSession({ studentId: await studentId(cookie) });
  const upload = await sources.upload(p, {
    title: "Analysis.pdf",
    bytes: 100,
    type: "application/pdf",
  });
  if (upload.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, upload.source.id);
  const text = "MA-101 Analysis I\nAbgabe Blatt 3: 20.11., 12 Uhr";
  await sources.ingest(p, upload.source.id, {
    delegation,
    parse: async () => ({ pages: [{ page: 1, text }] }),
    embedder: {
      model: "test",
      dims: 1,
      relevanceFloor: 0.3,
      estimateMicroUsd: () => 1,
      embed: async (t) => ({
        vectors: t.map(() => [1]),
        usage: { microUsd: 1 },
      }),
    },
    scans: {
      estimateMicroUsd: () => 1,
      read: async () => ({ text: "", usage: { microUsd: 1 } }),
    },
  });
  await facts.extract(p, upload.source.id, {
    delegation,
    extractor: {
      model: "test",
      windows: (pages) => [[...pages]],
      estimateMicroUsd: () => 1,
      extract: async () => ({
        usage: { microUsd: 1 },
        value: {
          courses: [
            {
              code: "MA-101",
              title: "Analysis I",
              page: 1,
              quote: "MA-101 Analysis I",
            },
          ],
          obligations: [
            {
              course: "MA-101",
              kind: "assignment",
              title: "Übungsblatt 3",
              key: "Blatt 3",
              destination: null,
              due: {
                date: "2026-11-20",
                time: "12:00",
                timeZone: "Europe/Berlin",
                text: "20.11., 12 Uhr",
              },
              page: 1,
              quote: "Abgabe Blatt 3: 20.11., 12 Uhr",
              uncertainty: null,
            },
          ],
          facts: extracted,
        },
      }),
    },
  });
  return {
    cookie,
    headers: { cookie, origin: appOrigin, "content-type": "application/json" },
  };
}
type ReviewBody = {
  courses: {
    id: string;
    obligations: {
      id: string;
      values: { citations: { extractionId: string }[] }[];
    }[];
  }[];
};

it("reviews extracted Obligations and Courses through authenticated, origin-protected routes", async () => {
  const { cookie, headers } = await reviewFixture("review");

  const listed = await app.request(`${apiOrigin}/api/me/sources`, {
    headers: { cookie },
  });
  expect(await listed.json()).toEqual([
    expect.objectContaining({
      status: "ready",
      failure: null,
      extraction: "done",
    }),
  ]);
  const review = await app.request(`${apiOrigin}/api/me/review`, {
    headers: { cookie },
  });
  expect(review.status).toBe(200);
  const {
    courses: [course],
  } = (await review.json()) as {
    courses: { id: string; obligations: { id: string }[] }[];
  };
  expect(course).toMatchObject({
    title: "Analysis I",
    status: "proposed",
    obligations: [
      {
        title: "Übungsblatt 3",
        provenance: {
          title: "Analysis.pdf",
          page: 1,
          quote: "Abgabe Blatt 3: 20.11., 12 Uhr",
        },
      },
    ],
  });
  const confirm = `${apiOrigin}/api/me/review/obligation/${course!.obligations[0]!.id}/confirm`;

  expect(
    (
      await app.request(confirm, {
        method: "POST",
        headers: { cookie, origin: evilOrigin },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request(confirm, {
        method: "POST",
        headers: { ...headers, cookie: await signUp("review-stranger") },
      })
    ).status,
  ).toBe(404);
  expect((await app.request(confirm, { method: "POST", headers })).status).toBe(
    200,
  );
  expect(
    (
      await app.request(`${apiOrigin}/api/me/courses/${course!.id}/decision`, {
        method: "POST",
        headers,
        body: JSON.stringify({ decision: "accept" }),
      })
    ).status,
  ).toBe(200);
  const reviewed = await app.request(`${apiOrigin}/api/me/review`, {
    headers: { cookie },
  });
  expect(await reviewed.json()).toMatchObject({
    courses: [{ status: "accepted", obligations: [{ state: "confirmed" }] }],
  });
});

it("starts extracting a Source again on request, refusing while it runs and once it is gone", async () => {
  const { cookie, headers } = await reviewFixture("review-reextract");
  const [source] = (await (
    await app.request(`${apiOrigin}/api/me/sources`, { headers: { cookie } })
  ).json()) as { id: string }[];
  const extract = () =>
    app.request(`${apiOrigin}/api/me/sources/${source!.id}/extract`, {
      method: "POST",
      headers,
    });

  expect(
    (
      await app.request(`${apiOrigin}/api/me/sources/${source!.id}/extract`, {
        method: "POST",
        headers: { cookie, origin: evilOrigin },
      })
    ).status,
  ).toBe(403);
  const queued = await extract();
  expect([queued.status, await queued.json()]).toEqual([
    202,
    { status: "queued" },
  ]);
  expect(started).toContainEqual([
    "extractSource",
    expect.any(String),
    source!.id,
  ]);
  // Running is set by the worker's claim; the route only has to map it.
  await admin.source.update({
    where: { id: source!.id },
    data: { extraction: "running" },
  });
  expect((await extract()).status).toBe(409);
  await app.request(`${apiOrigin}/api/me/sources/${source!.id}`, {
    method: "DELETE",
    headers,
  });
  expect((await extract()).status).toBe(404);
});

it("binds every file of an upload to one Course, new or chosen, refusing a Course that is gone or a title that is empty", async () => {
  const cookie = await signUp("source-course");
  const headers = {
    cookie,
    origin: appOrigin,
    "content-type": "application/json",
  };
  const post = (title: string, course: unknown) =>
    app.request(`${apiOrigin}/api/me/sources`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title,
        bytes: 1234,
        type: "application/pdf",
        course,
      }),
    });

  const first = await post("Folien 1.pdf", {
    title: "Analysis I",
    code: "MA-101",
  });
  expect(first.status).toBe(201);
  const { source } = (await first.json()) as {
    source: { id: string; courseId: string };
  };
  const second = await post("Folien 2.pdf", { id: source.courseId });
  expect(second.status).toBe(201);
  expect(await second.json()).toMatchObject({
    source: { courseId: source.courseId },
  });
  expect((await post("Folien 3.pdf", null)).status).toBe(201);
  expect((await post("Folien 4.pdf", { id: randomUUID() })).status).toBe(404);
  const clash = await post("Folien 6.pdf", { title: "analysis i", code: null });
  expect([clash.status, await clash.json()]).toEqual([
    409,
    {
      error: "clash",
      course: {
        id: source.courseId,
        title: "Analysis I",
        status: "accepted",
        archived: false,
      },
    },
  ]);
  expect((await post("Folien 5.pdf", { title: "", code: null })).status).toBe(
    400,
  );

  const listed = await app.request(`${apiOrigin}/api/me/sources`, {
    headers: { cookie },
  });
  expect(
    ((await listed.json()) as { courseId: string | null }[]).map(
      (s) => s.courseId,
    ),
  ).toEqual([source.courseId, source.courseId, null]);
  const courses = await app.request(`${apiOrigin}/api/me/courses`, {
    headers: { cookie },
  });
  expect(await courses.json()).toMatchObject({
    courses: [{ title: "Analysis I", status: "accepted", entered: true }],
  });
});

it("changes a Source's Course and reads it again, refusing while it is read and once it is gone", async () => {
  const { cookie, headers } = await reviewFixture("source-change-course");
  const [source] = (await (
    await app.request(`${apiOrigin}/api/me/sources`, { headers: { cookie } })
  ).json()) as { id: string }[];
  const change = (course: unknown, origin = appOrigin) =>
    app.request(`${apiOrigin}/api/me/sources/${source!.id}/course`, {
      method: "POST",
      headers: { ...headers, origin },
      body: JSON.stringify({ course }),
    });

  expect((await change(null, evilOrigin)).status).toBe(403);
  const queued = await change({ title: "Analysis 1", code: null });
  expect([queued.status, await queued.json()]).toEqual([
    202,
    { status: "queued" },
  ]);
  expect(started).toContainEqual([
    "extractSource",
    expect.any(String),
    source!.id,
  ]);
  expect(
    (
      (await (
        await app.request(`${apiOrigin}/api/me/sources`, {
          headers: { cookie },
        })
      ).json()) as { courseId: string | null }[]
    )[0]!.courseId,
  ).toEqual(expect.any(String));
  await admin.source.update({
    where: { id: source!.id },
    data: { extraction: "running" },
  });
  expect((await change(null)).status).toBe(409);
  await app.request(`${apiOrigin}/api/me/sources/${source!.id}`, {
    method: "DELETE",
    headers,
  });
  expect((await change(null)).status).toBe(404);
});

it("tells the student a changed Course is kept when reading could not start, and starts it again on request", async () => {
  const { cookie, headers } = await reviewFixture("source-change-down");
  const sourcesNow = async () =>
    (await (
      await app.request(`${apiOrigin}/api/me/sources`, { headers: { cookie } })
    ).json()) as { id: string; courseId: string | null; extraction: string }[];
  const [source] = await sourcesNow();

  workflowsDown = true;
  const changed = await app.request(
    `${apiOrigin}/api/me/sources/${source!.id}/course`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ course: { title: "Analysis 1", code: null } }),
    },
  );
  workflowsDown = false;

  expect([changed.status, await changed.json()]).toEqual([
    503,
    { error: "not_started" },
  ]);
  expect(await sourcesNow()).toEqual([
    expect.objectContaining({
      courseId: expect.any(String),
      extraction: "pending",
    }),
  ]);
  const again = await app.request(
    `${apiOrigin}/api/me/sources/${source!.id}/extract`,
    { method: "POST", headers },
  );
  expect(again.status).toBe(202);
  expect(started).toContainEqual([
    "extractSource",
    expect.any(String),
    source!.id,
  ]);
});

it("suggests merging alike Courses until the student says they differ", async () => {
  const { cookie, headers } = await reviewFixture("review-similar");
  const own = (await (
    await app.request(`${apiOrigin}/api/me/courses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Analysis 1",
        code: null,
        semester: "2026-ws",
      }),
    })
  ).json()) as { id: string };
  const suggestions = async () =>
    (
      await app.request(`${apiOrigin}/api/me/courses/merge-suggestions`, {
        headers: { cookie },
      })
    ).json();
  const proposed = (
    (await (
      await app.request(`${apiOrigin}/api/me/review`, { headers: { cookie } })
    ).json()) as ReviewBody
  ).courses.find((course) => course.id !== own.id);

  expect(await suggestions()).toEqual([
    { courseId: proposed!.id, intoId: own.id },
  ]);
  const keepApart = (origin: string) =>
    app.request(`${apiOrigin}/api/me/courses/${proposed!.id}/keep-apart`, {
      method: "POST",
      headers: { ...headers, origin },
      body: JSON.stringify({ other: own.id }),
    });
  expect((await keepApart(evilOrigin)).status).toBe(403);
  expect((await keepApart(appOrigin)).status).toBe(200);
  expect(await suggestions()).toEqual([]);
});

it("merges one Course into another, reporting conflicting Corrections and Courses that are gone", async () => {
  const { cookie, headers } = await reviewFixture("review-merge");
  const p = principal.fromSession({ studentId: await studentId(cookie) });
  const upload = await sources.upload(p, {
    title: "Übersicht.pdf",
    bytes: 100,
    type: "application/pdf",
  });
  if (upload.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, upload.source.id);
  await sources.ingest(p, upload.source.id, {
    delegation,
    parse: async () => ({
      pages: [{ page: 1, text: "Analysis 1\nAbgabe Blatt 3: 20.11., 12 Uhr" }],
    }),
    embedder: {
      model: "test",
      dims: 1,
      relevanceFloor: 0.3,
      estimateMicroUsd: () => 1,
      embed: async (t) => ({
        vectors: t.map(() => [1]),
        usage: { microUsd: 1 },
      }),
    },
    scans: {
      estimateMicroUsd: () => 1,
      read: async () => ({ text: "", usage: { microUsd: 1 } }),
    },
  });
  await facts.extract(p, upload.source.id, {
    delegation,
    extractor: {
      model: "test",
      windows: (pages) => [[...pages]],
      estimateMicroUsd: () => 1,
      extract: async () => ({
        usage: { microUsd: 1 },
        value: {
          courses: [
            { code: null, title: "Analysis 1", page: 1, quote: "Analysis 1" },
          ],
          obligations: [
            {
              course: "Analysis 1",
              kind: "assignment",
              title: "Übungsblatt 3",
              key: "Blatt 3",
              destination: null,
              due: {
                date: "2026-11-20",
                time: "12:00",
                timeZone: "Europe/Berlin",
                text: "20.11., 12 Uhr",
              },
              page: 1,
              quote: "Abgabe Blatt 3: 20.11., 12 Uhr",
              uncertainty: null,
            },
          ],
          facts: [],
        },
      }),
    },
  });
  const review = async () =>
    (await (
      await app.request(`${apiOrigin}/api/me/review`, { headers: { cookie } })
    ).json()) as ReviewBody;
  const [into, from] = (await review()).courses;
  const correct = (course: typeof into, date: string) =>
    app.request(
      `${apiOrigin}/api/me/review/obligation/${course!.obligations[0]!.id}/correct`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: "Blatt 3",
          due: { date, time: null, timeZone: null },
          destination: null,
        }),
      },
    );
  await correct(into, "2026-11-21");
  await correct(from, "2026-11-22");
  const merge = (id: string, target: string) =>
    app.request(`${apiOrigin}/api/me/courses/${id}/merge`, {
      method: "POST",
      headers,
      body: JSON.stringify({ into: target }),
    });

  expect(
    (
      await app.request(`${apiOrigin}/api/me/courses/${from!.id}/merge`, {
        method: "POST",
        headers: { cookie, origin: evilOrigin },
        body: JSON.stringify({ into: into!.id }),
      })
    ).status,
  ).toBe(403);
  expect((await merge(from!.id, from!.id)).status).toBe(404);
  const refused = await merge(from!.id, into!.id);
  expect([refused.status, await refused.json()]).toEqual([
    409,
    {
      error: "conflicting_corrections",
      items: [{ kind: "obligation", id: into!.obligations[0]!.id }],
    },
  ]);
  await correct(from, "2026-11-21");
  expect((await merge(from!.id, into!.id)).status).toBe(200);
  expect(started).toContainEqual([
    "groupCourse",
    await studentId(cookie),
    into!.id,
  ]);
  expect((await review()).courses).toEqual([
    expect.objectContaining({ id: into!.id, status: "accepted" }),
  ]);
  expect((await merge(from!.id, into!.id)).status).toBe(404);
});

it("lists a Course's Topic Areas and lets the student rename and reject them and move Topics", async () => {
  const cookie = await signUp("topic-areas");
  const headers = {
    cookie,
    origin: appOrigin,
    "content-type": "application/json",
  };
  const p = principal.fromSession({ studentId: await studentId(cookie) });
  const names = [
    "Bubblesort",
    "Quicksort",
    "Mergesort",
    "Breitensuche",
    "Tiefensuche",
    "Dijkstra",
    "Hashing",
    "O-Notation",
  ];
  const upload = await sources.upload(p, {
    title: "Algorithmen.pdf",
    bytes: 100,
    type: "application/pdf",
  });
  if (upload.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, upload.source.id);
  await sources.ingest(p, upload.source.id, {
    delegation,
    parse: async () => ({
      pages: [{ page: 1, text: ["INF-2 Algorithmen", ...names].join("\n") }],
    }),
    embedder: {
      model: "test",
      dims: 1,
      relevanceFloor: 0.3,
      estimateMicroUsd: () => 1,
      embed: async (t) => ({
        vectors: t.map(() => [1]),
        usage: { microUsd: 1 },
      }),
    },
    scans: {
      estimateMicroUsd: () => 1,
      read: async () => ({ text: "", usage: { microUsd: 1 } }),
    },
  });
  await facts.extract(p, upload.source.id, {
    delegation,
    extractor: {
      model: "test",
      windows: (pages) => [[...pages]],
      estimateMicroUsd: () => 1,
      extract: async () => ({
        usage: { microUsd: 1 },
        value: {
          courses: [
            {
              code: "INF-2",
              title: "Algorithmen",
              page: 1,
              quote: "INF-2 Algorithmen",
            },
          ],
          obligations: [],
          facts: names.map((name) => ({
            course: "INF-2",
            type: "topic" as const,
            key: name,
            value: name,
            page: 1,
            quote: name,
            uncertainty: null,
          })),
        },
      }),
    },
  });
  const courseId = (await facts.review(p)).courses[0]!.id;
  await topicAreas.group(p, courseId, {
    delegation,
    grouper: {
      model: "test",
      estimateMicroUsd: () => 1,
      group: async (input) => {
        const handles = (...wanted: string[]) =>
          wanted.map((n) => input.topics.find((t) => t.name === n)!.handle);
        return {
          usage: { microUsd: 1 },
          value: {
            areas: [
              {
                name: "Sortieren",
                topics: handles("Bubblesort", "Mergesort", "Quicksort"),
              },
              {
                name: "Graphen",
                topics: handles("Breitensuche", "Dijkstra", "Tiefensuche"),
              },
            ],
          },
        };
      },
    },
  });
  type Listed = {
    areas: {
      id: string;
      name: string;
      inferred: boolean;
      topics: { id: string; name: string }[];
    }[];
    ungrouped: { id: string; name: string }[];
  };
  const list = async (id = courseId) => {
    const response = await app.request(
      `${apiOrigin}/api/me/courses/${id}/topic-areas`,
      { headers: { cookie } },
    );
    return [response.status, await response.json()] as [number, Listed];
  };
  const [status, listed] = await list();
  expect(status).toBe(200);
  expect(listed).toEqual({
    areas: [
      {
        id: expect.any(String),
        name: "Sortieren",
        inferred: true,
        topics: ["Bubblesort", "Mergesort", "Quicksort"].map((name) => ({
          id: expect.any(String),
          name,
        })),
      },
      expect.objectContaining({ name: "Graphen" }),
    ],
    ungrouped: [
      { id: expect.any(String), name: "Hashing" },
      { id: expect.any(String), name: "O-Notation" },
    ],
  });
  expect((await list(randomUUID()))[0]).toBe(404);
  const [sortieren, graphen] = listed.areas;
  const rename = (id: string, name: string) =>
    app.request(`${apiOrigin}/api/me/topic-areas/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name }),
    });
  const move = (topicId: string, areaId: string | null) =>
    app.request(`${apiOrigin}/api/me/topics/${topicId}/area`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ areaId }),
    });
  const reject = (id: string) =>
    app.request(`${apiOrigin}/api/me/topic-areas/${id}/reject`, {
      method: "POST",
      headers,
    });

  expect((await rename(graphen!.id, "Graphentheorie")).status).toBe(200);
  const clash = await rename(sortieren!.id, "graphentheorie");
  expect([clash.status, await clash.json()]).toEqual([409, { error: "clash" }]);
  expect((await rename(sortieren!.id, "  ")).status).toBe(400);
  expect((await rename(randomUUID(), "Sortierverfahren")).status).toBe(404);
  expect((await move(listed.ungrouped[0]!.id, graphen!.id)).status).toBe(200);
  expect((await move(listed.ungrouped[1]!.id, randomUUID())).status).toBe(404);
  expect((await reject(sortieren!.id)).status).toBe(200);
  expect((await reject(sortieren!.id)).status).toBe(404);

  expect((await list())[1]).toEqual({
    areas: [
      {
        id: graphen!.id,
        name: "Graphentheorie",
        inferred: true,
        topics: ["Breitensuche", "Dijkstra", "Tiefensuche", "Hashing"].map(
          (name) => ({ id: expect.any(String), name }),
        ),
      },
    ],
    ungrouped: ["Bubblesort", "Mergesort", "O-Notation", "Quicksort"].map(
      (name) => ({ id: expect.any(String), name }),
    ),
  });
});

it("enters an Obligation by hand, refusing invalid entries, Courses that are not accepted and existing keys", async () => {
  const { cookie, headers } = await reviewFixture("review-entry");
  const [course] = (
    (await (
      await app.request(`${apiOrigin}/api/me/review`, { headers: { cookie } })
    ).json()) as ReviewBody
  ).courses;
  const enter = (body: unknown, origin = appOrigin) =>
    app.request(`${apiOrigin}/api/me/obligations`, {
      method: "POST",
      headers: { ...headers, origin },
      body: JSON.stringify(body),
    });
  const exam = {
    course: { id: course!.id },
    kind: "exam",
    title: "Klausur",
    due: { date: "2027-02-12", time: null, timeZone: null },
    destination: null,
  };

  expect((await enter(exam, evilOrigin)).status).toBe(403);
  expect((await enter(exam)).status).toBe(404);
  const created = await enter({
    ...exam,
    course: { title: "Lineare Algebra", code: null },
  });
  expect([created.status, await created.json()]).toEqual([
    201,
    { id: expect.any(String) },
  ]);
  expect(
    (
      await enter({
        ...exam,
        course: { title: "Lineare Algebra", code: null },
        due: { date: "2027-02-30", time: null, timeZone: null },
      })
    ).status,
  ).toBe(400);
  await app.request(`${apiOrigin}/api/me/courses/${course!.id}/decision`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision: "accept" }),
  });
  expect(
    (await enter({ ...exam, kind: "assignment", title: "Blatt 3" })).status,
  ).toBe(409);
  expect((await enter(exam)).status).toBe(201);
});

it("tells which AI-use Rule applies, takes the student's own answer, and records Reported as Submitted", async () => {
  const { cookie, headers } = await reviewFixture("review-ai-use");
  const obligations = async () =>
    (
      (await (
        await app.request(`${apiOrigin}/api/me/review`, { headers: { cookie } })
      ).json()) as {
        courses: {
          obligations: { id: string; reportedSubmittedAt: string | null }[];
        }[];
      }
    ).courses[0]!.obligations;
  const sheet = (await obligations())[0]!.id;
  const aiUse = async (id = sheet) => {
    const response = await app.request(
      `${apiOrigin}/api/me/obligations/${id}/ai-use`,
      { headers: { cookie } },
    );
    return [response.status, await response.json()];
  };
  const post = (path: string, body: unknown, origin = appOrigin) =>
    app.request(`${apiOrigin}/api/me/obligations/${sheet}/${path}`, {
      method: "POST",
      headers: { ...headers, origin },
      body: JSON.stringify(body),
    });

  expect(await aiUse()).toEqual([200, { status: "unknown", reason: "none" }]);
  expect((await aiUse(randomUUID()))[0]).toBe(404);
  const answer = { level: "course", value: "forbidden" };
  expect((await post("ai-use", answer, evilOrigin)).status).toBe(403);
  expect((await post("ai-use", { ...answer, value: "maybe" })).status).toBe(
    400,
  );
  expect((await post("ai-use", answer)).status).toBe(200);
  expect(await aiUse()).toEqual([
    200,
    {
      status: "forbidden",
      level: "course",
      text: null,
      provenance: { kind: "correction" },
    },
  ]);

  expect((await post("reported-submitted", { reported: true })).status).toBe(
    200,
  );
  expect((await obligations())[0]!.reportedSubmittedAt).toEqual(
    expect.any(String),
  );
  expect((await post("reported-submitted", { reported: false })).status).toBe(
    200,
  );
  expect((await obligations())[0]!.reportedSubmittedAt).toBeNull();
});

it("corrects, keeps, uses and restores review items, refusing invalid Corrections and unknown values", async () => {
  const { cookie, headers } = await reviewFixture("review-corrections");
  const review = async () =>
    (await (
      await app.request(`${apiOrigin}/api/me/review`, { headers: { cookie } })
    ).json()) as ReviewBody;
  const {
    courses: [course],
  } = await review();
  const item = `${apiOrigin}/api/me/review/obligation/${course!.obligations[0]!.id}`;
  const post = (path: string, body?: unknown) =>
    app.request(`${item}/${path}`, {
      method: "POST",
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const mine = {
    title: "Blatt 3",
    due: { date: "2026-11-21", time: null, timeZone: null },
    destination: null,
  };

  expect(
    (
      await post("correct", {
        ...mine,
        due: { ...mine.due, date: "2026-13-01" },
      })
    ).status,
  ).toBe(400);
  expect((await post("correct", { value: "H1" })).status).toBe(400);
  expect((await post("correct", mine)).status).toBe(200);
  expect(await review()).toMatchObject({
    courses: [
      {
        obligations: [{ title: "Blatt 3", provenance: { kind: "correction" } }],
      },
    ],
  });
  expect((await post("keep_mine")).status).toBe(200);
  expect((await post("use", { extractionId: randomUUID() })).status).toBe(404);
  expect(
    (
      await post("use", {
        extractionId:
          course!.obligations[0]!.values[0]!.citations[0]!.extractionId,
      })
    ).status,
  ).toBe(200);
  expect((await post("keep_mine")).status).toBe(404);
  expect((await post("reject")).status).toBe(200);
  expect((await post("restore")).status).toBe(200);
  const decision = (value: string) =>
    app.request(`${apiOrigin}/api/me/courses/${course!.id}/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: value }),
    });
  expect((await decision("reject")).status).toBe(200);
  expect((await decision("restore")).status).toBe(200);
  expect(await review()).toMatchObject({
    courses: [
      {
        status: "proposed",
        obligations: [{ title: "Übungsblatt 3", state: "unreviewed" }],
      },
    ],
  });
});

/** A ready Source with one page, embedded for Chat retrieval. */
async function chatSource(cookie: string, title: string, text: string) {
  const p = principal.fromSession({ studentId: await studentId(cookie) });
  const upload = await sources.upload(p, {
    title,
    bytes: 100,
    type: "application/pdf",
  });
  if (upload.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, upload.source.id);
  await sources.ingest(p, upload.source.id, {
    delegation,
    embedder: chatEmbedder,
    parse: async () => ({ pages: [{ page: 1, text }] }),
    scans: {
      estimateMicroUsd: () => 1,
      read: async () => ({ text: "", usage: { microUsd: 1 } }),
    },
  });
  return upload.source.id;
}

/** A signed-up student with one Chat that has no Courses or Sources. */
async function emptyChat(name: string) {
  const cookie = await signUp(name);
  const headers = {
    cookie,
    origin: appOrigin,
    "content-type": "application/json",
  };
  const created = await app.request(`${apiOrigin}/api/me/chats`, {
    method: "POST",
    headers,
    body: JSON.stringify({ courseIds: [], sourceIds: [] }),
  });
  const { id } = (await created.json()) as { id: string };
  return { cookie, headers, id };
}

/** The JSON chunks of an AI SDK UI message stream. */
/** A Berlin calendar date `days` from today, as YYYY-MM-DD. */
const berlinDay = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Europe/Berlin",
  });

/** A student with an Obligation due in ten days and a Chat with nothing selected, for proposing Study Blocks. */
async function planningChat(name: string) {
  const cookie = await signUp(name);
  const headers = {
    cookie,
    origin: appOrigin,
    "content-type": "application/json",
  };
  const p = principal.fromSession({ studentId: await studentId(cookie) });
  const entered = await facts.enterObligation(p, {
    course: { title: "Analysis I", code: "MA-101" },
    kind: "assignment",
    title: "Übungsblatt 4",
    due: { date: berlinDay(10), time: "12:00", timeZone: null },
    destination: null,
  });
  if (entered.status !== "ok") throw new Error(entered.status);
  const { id } = (await (
    await app.request(`${apiOrigin}/api/me/chats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ courseIds: [], sourceIds: [] }),
    })
  ).json()) as { id: string };
  return { cookie, headers, p, chatId: id, obligationId: entered.id };
}

/** A student whose Chat selects their Course, which has a Topic, for starting Artifacts. */
async function topicChat(name: string) {
  const fixture = await reviewFixture(name, [
    {
      course: "MA-101",
      type: "topic",
      key: "Gleichmäßige Konvergenz",
      value: "Gleichmäßige Konvergenz",
      page: 1,
      quote: "MA-101 Analysis I",
      uncertainty: null,
    },
  ]);
  const { id: courseId } = await admin.course.findFirstOrThrow({
    where: { studentId: await studentId(fixture.cookie) },
  });
  const { id } = (await (
    await app.request(`${apiOrigin}/api/me/chats`, {
      method: "POST",
      headers: fixture.headers,
      body: JSON.stringify({ courseIds: [courseId], sourceIds: [] }),
    })
  ).json()) as { id: string };
  return { ...fixture, chatId: id };
}
/** The model starts `tool` on the Topic `courseFacts` tagged in its prompt. */
const startsOnTopic =
  (tool: string) =>
  (prompt: unknown): unknown[] => {
    const tag = /\[(S\d+)\] Analysis I, Topic/.exec(
      JSON.stringify(prompt),
    )?.[1];
    return calls(tool, { topics: [tag] });
  };

async function sseChunks(response: Response) {
  return (await response.text())
    .split("\n\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
}

/** Asks in a Chat as the web does, through the stream: the saved turn, or the refusal with its status. */
async function askInChat(
  headers: Record<string, string>,
  chatId: string,
  text: string,
) {
  const response = await app.request(
    `${apiOrigin}/api/me/chats/${chatId}/messages/stream`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ id: randomUUID(), text }),
    },
  );
  if (!response.ok)
    return { status: response.status, body: await response.json() };
  const chunks = await sseChunks(response);
  const outcome = chunks.find(
    (chunk) => chunk.type === "data-committed" || chunk.type === "data-refused",
  );
  return { status: response.status, body: outcome?.data };
}

describe("Chat models", () => {
  async function newChat(name: string) {
    const cookie = await signUp(name);
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const created = await app.request(`${apiOrigin}/api/me/chats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ courseIds: [], sourceIds: [] }),
    });
    const { id } = (await created.json()) as { id: string };
    const ask = async (body: Record<string, unknown>) => {
      const response = await app.request(
        `${apiOrigin}/api/me/chats/${id}/messages/stream`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            id: randomUUID(),
            text: "Meine Frage",
            ...body,
          }),
        },
      );
      return { status: response.status, text: await response.text() };
    };
    const models = async () =>
      (
        await app.request(`${apiOrigin}/api/me/models`, { headers: { cookie } })
      ).json();
    const history = async () =>
      (await (
        await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
          headers: { cookie },
        })
      ).json()) as { role: string; model: unknown }[];
    return { ask, models, history };
  }

  it("lists the offered Models with their cost next to the default and how each handles student data", async () => {
    const { models } = await newChat("models-list");
    const dataHandling = {
      provider: "OpenRouter",
      upstream: ["Amazon Bedrock", "Google"],
      routing: "international",
      zeroRetention: true,
    };
    // Seeded prices per million tokens, input + output: Haiku $0.66, Sonnet $13.20, Opus $26.40.
    expect(await models()).toEqual({
      models: [
        {
          key: "haiku-5.5-reasoning-high",
          name: "Haiku 5.5",
          provider: "Anthropic",
          description: "Schnell und sparsam für kurze, klare Aufgaben.",
          dataHandling,
          cost: { relativeToDefault: 0.05, tier: "low" },
        },
        {
          key: "sonnet-5.5-reasoning-high",
          name: "Sonnet 5.5",
          provider: "Anthropic",
          description: "Ausgewogen für Erklärungen und alltägliches Lernen.",
          dataHandling,
          cost: { relativeToDefault: 1, tier: "medium" },
        },
        {
          key: "opus-5.5-reasoning-high",
          name: "Opus 5.5",
          provider: "Anthropic",
          description: "Am gründlichsten für anspruchsvolle, lange Aufgaben.",
          dataHandling,
          cost: { relativeToDefault: 2, tier: "high" },
        },
      ],
      default: "sonnet-5.5-reasoning-high",
      selected: "sonnet-5.5-reasoning-high",
    });
  });

  it("answers with the chosen Model, records it with the answer and remembers the choice", async () => {
    reply = "Antwort.";
    const { ask, models, history } = await newChat("models-choose");
    const { status, text } = await ask({ model: "opus-5.5-reasoning-high" });
    expect(status).toBe(200);
    expect(answeredWith.at(-1)).toMatchObject({
      key: "opus-5.5-reasoning-high",
      providerModelId: "anthropic/claude-opus-5.5",
      reasoningEffort: "high",
    });
    expect(text).toContain(
      '"model":{"key":"opus-5.5-reasoning-high","name":"Opus 5.5"}',
    );
    expect((await history()).map((message) => message.model)).toEqual([
      null,
      { key: "opus-5.5-reasoning-high", name: "Opus 5.5" },
    ]);
    expect(await models()).toMatchObject({
      selected: "opus-5.5-reasoning-high",
    });
    // Without a choice in the request, the remembered one answers.
    await ask({});
    expect(answeredWith.at(-1)?.key).toBe("opus-5.5-reasoning-high");
  });

  it("answers with the Chat default when the student never chose", async () => {
    reply = "Antwort.";
    const { ask } = await newChat("models-default");
    expect((await ask({})).status).toBe(200);
    expect(answeredWith.at(-1)?.key).toBe("sonnet-5.5-reasoning-high");
  });

  it("refuses a Model that is not offered, without answering or recording the question", async () => {
    const { ask, history } = await newChat("models-unavailable");
    await admin.catalogModel.create({
      data: {
        key: "haiku-5.5-reasoning-low",
        providerModelId: "anthropic/claude-haiku-5.5",
        reasoningEffort: "low",
        maxOutputTokens: 8000,
        name: "Haiku (aus)",
        provider: "Anthropic",
        description: "Nicht angeboten.",
      },
    });
    const asked = answeredWith.length;
    for (const model of ["haiku-5.5-reasoning-low", "no-such-model"]) {
      const { status, text } = await ask({ model });
      expect(status).toBe(422);
      expect(JSON.parse(text)).toEqual({ error: "model_unavailable" });
    }
    expect(answeredWith.length).toBe(asked);
    expect(await history()).toEqual([]);
  });
});

describe("Chat list", () => {
  async function student(name: string) {
    const cookie = await signUp(name);
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const newChat = async () => {
      const created = await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [] }),
      });
      return ((await created.json()) as { id: string }).id;
    };
    const list = async (query = "?limit=30") => {
      const response = await app.request(`${apiOrigin}/api/me/chats${query}`, {
        headers: { cookie },
      });
      return {
        status: response.status,
        body: (await response.json()) as {
          chats: { id: string; title: string; lastActivityAt: string }[];
          nextCursor: string | null;
        },
      };
    };
    return { headers, newChat, list };
  }

  it("lists the student's Chats by when they last asked, each titled by its first question", async () => {
    const { headers, newChat, list } = await student("chat-list-order");
    reply = "Eine Antwort.";
    const older = await newChat();
    await askInChat(headers, older, "Wann ist die Klausur?");
    const newer = await newChat();
    await askInChat(headers, newer, "Erkläre mir Elastizität");
    await askInChat(headers, older, "Und welche Hilfsmittel sind erlaubt?");

    const { status, body } = await list();

    expect(status).toBe(200);
    expect(body.chats.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: older, title: "Wann ist die Klausur?" },
      { id: newer, title: "Erkläre mir Elastizität" },
    ]);
    expect(body.nextCursor).toBeNull();
  });

  it("moves a Chat up when the student decides its proposals there", async () => {
    const { headers, chatId } = await planningChat("chat-list-approve");
    const day = berlinDay(8);
    steps.push(
      calls("agenda", { from: berlinDay(7), to: berlinDay(13) }),
      calls("proposeStudyBlock", {
        work: "O1",
        start: `${day}T10:00`,
        end: `${day}T12:00`,
      }),
    );
    const asked = await askInChat(headers, chatId, "Plane Blatt 4 ein.");
    const card = asked.body.parts.find(
      (part: { type: string }) => part.type === "tool-proposeStudyBlock",
    );
    const { id: later } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [] }),
      })
    ).json()) as { id: string };
    reply = "Eine Antwort.";
    await askInChat(headers, later, "Eine spätere Frage");
    reply = "Erledigt.";

    await sseChunks(
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          decisions: [
            {
              approvalId: card.approvalId,
              decision: "approve",
              fingerprint: card.action.fingerprint,
            },
          ],
        }),
      }),
    );

    const listed = (await (
      await app.request(`${apiOrigin}/api/me/chats?limit=30`, {
        headers: { cookie: headers.cookie },
      })
    ).json()) as { chats: { id: string }[] };
    expect(listed.chats.map(({ id }) => id)).toEqual([chatId, later]);
  });

  it("titles a Chat by the first line of its first question", async () => {
    const { headers, newChat, list } = await student("chat-list-lines");
    reply = "Eine Antwort.";
    const id = await newChat();
    await askInChat(headers, id, "Fasse Kapitel 3 zusammen:\n\n- Angebot");

    const { body } = await list();

    expect(body.chats[0]?.title).toBe("Fasse Kapitel 3 zusammen:");
  });

  it("leaves out a Chat nothing was asked in yet", async () => {
    const { headers, newChat, list } = await student("chat-list-unasked");
    reply = "Eine Antwort.";
    const asked = await newChat();
    await askInChat(headers, asked, "Was steht diese Woche an?");
    await newChat();

    const { body } = await list();

    expect(body.chats.map(({ id }) => id)).toEqual([asked]);
  });

  it("pages through the Chats, continuing after the last one shown", async () => {
    const { headers, newChat, list } = await student("chat-list-pages");
    reply = "Eine Antwort.";
    const ids: string[] = [];
    for (const question of ["Erste", "Zweite", "Dritte"]) {
      const id = await newChat();
      await askInChat(headers, id, question);
      ids.unshift(id);
    }

    const first = await list("?limit=2");
    const second = await list(`?limit=2&cursor=${first.body.nextCursor}`);

    expect(first.body.chats.map(({ id }) => id)).toEqual(ids.slice(0, 2));
    expect(second.body.chats.map(({ id }) => id)).toEqual(ids.slice(2));
    expect(second.body.nextCursor).toBeNull();
  });

  it("never lists another student's Chats", async () => {
    const other = await student("chat-list-other");
    reply = "Eine Antwort.";
    await askInChat(other.headers, await other.newChat(), "Meine Frage");
    const { list } = await student("chat-list-self");

    const { body } = await list();

    expect(body.chats).toEqual([]);
  });
});

describe("Chat", () => {
  it("answers from a search the model chose, streams the search as a step, and shows the same steps when reopened", async () => {
    const cookie = await signUp("chat-search");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const handbook = await chatSource(
      cookie,
      "Modulhandbuch.pdf",
      "Die Klausur ist am 10. Februar.",
    );
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [handbook] }),
      })
    ).json()) as { id: string };
    steps.push(searches("Klausur Termin"), says("Am 10. Februar [S1]."));
    prompts.length = 0;

    const chunks = await sseChunks(
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: randomUUID(),
          text: "Wann ist die Klausur?",
        }),
      }),
    );

    const search = {
      type: "tool-searchMaterial",
      toolCallId: expect.any(String),
      input: { query: "Klausur Termin" },
      output: { found: 1, sources: ["Modulhandbuch.pdf"] },
    };
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        output: search.output,
      }),
    );
    expect(prompts).toHaveLength(2);
    expect(JSON.stringify(prompts[1])).toContain(
      "Die Klausur ist am 10. Februar.",
    );
    const committed = chunks.find((chunk) => chunk.type === "data-committed");
    expect(committed.data).toMatchObject({
      text: "Am 10. Februar [S1].",
      parts: [search, { type: "text", text: "Am 10. Februar [S1]." }],
      citations: [
        {
          tag: "S1",
          provenance: {
            kind: "source",
            sourceId: handbook,
            title: "Modulhandbuch.pdf",
            location: { page: 1 },
          },
        },
      ],
    });
    const reopened = (await (
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
        headers: { cookie },
      })
    ).json()) as { parts: unknown[] }[];
    expect(reopened[1]!.parts).toEqual(committed.data.parts);
  });

  it("streams provisional text before committing the canonical turn", async () => {
    const cookie = await signUp("chat-stream");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const created = await app.request(`${apiOrigin}/api/me/chats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ courseIds: [], sourceIds: [] }),
    });
    const { id } = (await created.json()) as { id: string };
    let release = () => {};
    finishAnswer = new Promise<void>((resolve) => {
      release = resolve;
    });
    reply = "Eine schrittweise Antwort.";
    reasoningText = "Ich prüfe deine Materialien.";
    try {
      const response = await app.request(
        `${apiOrigin}/api/me/chats/${id}/messages/stream`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ id: randomUUID(), text: "Meine Frage" }),
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(response.headers.get("cache-control")).toContain("no-store");
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (!text.includes('"text-delta"')) {
        const next = await reader.read();
        if (next.done) throw new Error("No provisional text");
        text += decoder.decode(next.value, { stream: true });
      }
      expect(text).toContain("Eine schrittweise Antwort.");
      expect(text).toContain("reasoning-delta");
      expect(text).toContain("Ich prüfe deine Materialien.");
      expect(text).not.toContain("data-committed");
      expect(
        await (
          await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
            headers: { cookie },
          })
        ).json(),
      ).toEqual([]);
      release();
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        text += decoder.decode(next.value, { stream: true });
      }
      expect(text).toContain("data-committed");
      const history = (await (
        await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
          headers: { cookie },
        })
      ).json()) as { text: string }[];
      expect(history[1]).toHaveProperty(
        "reasoning",
        "Ich prüfe deine Materialien.",
      );
      expect(history.map((message) => message.text)).toEqual([
        "Meine Frage",
        reply,
      ]);
    } finally {
      release();
      finishAnswer = undefined;
      reasoningText = undefined;
    }
  });

  for (const interruption of ["abort", "source-deletion"] as const) {
    it(`does not persist a streamed answer after ${interruption}`, async () => {
      const cookie = await signUp(`stream-${interruption}`);
      const headers = {
        cookie,
        origin: appOrigin,
        "content-type": "application/json",
      };
      const sourceId = await chatSource(
        cookie,
        "Notizen.pdf",
        "Die Klausur ist am 10. Februar.",
      );
      const created = await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [sourceId] }),
      });
      const { id } = (await created.json()) as { id: string };
      const controller = new AbortController();
      let release = () => {};
      finishAnswer = new Promise<void>((resolve) => {
        release = resolve;
      });
      reply = "Die Klausur ist am 10. Februar [S1].";
      steps.push(searches("Klausur"));
      try {
        const response = await app.request(
          `${apiOrigin}/api/me/chats/${id}/messages/stream`,
          {
            method: "POST",
            headers,
            signal: controller.signal,
            body: JSON.stringify({
              id: randomUUID(),
              text: "Wann ist die Klausur?",
            }),
          },
        );
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let body = "";
        while (!body.includes('"text-delta"')) {
          const next = await reader.read();
          if (next.done) throw new Error("No streamed text");
          body += decoder.decode(next.value);
        }
        if (interruption === "abort") controller.abort();
        else
          expect(
            (
              await app.request(`${apiOrigin}/api/me/sources/${sourceId}`, {
                method: "DELETE",
                headers,
              })
            ).status,
          ).toBe(202);
        release();
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          body += decoder.decode(next.value);
        }
        expect(body).not.toContain("data-committed");
        expect(body).toContain(
          interruption === "abort" ? '"error"' : "data-refused",
        );
        expect(
          await (
            await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
              headers: { cookie },
            })
          ).json(),
        ).toEqual([]);
        if (interruption === "abort") {
          const allowance = (await (
            await app.request(`${apiOrigin}/api/me/allowance`, {
              headers: { cookie },
            })
          ).json()) as { heldMicroUsd: number };
          expect(allowance.heldMicroUsd).toBe(1);
        }
      } finally {
        release();
        finishAnswer = undefined;
      }
    });
  }

  it("keeps the client's question ID and announces the answer's ID before any text", async () => {
    const { cookie, headers, id } = await emptyChat("chat-ids");
    reply = "Eine Antwort.";
    const questionId = randomUUID();
    const response = await app.request(
      `${apiOrigin}/api/me/chats/${id}/messages/stream`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ id: questionId, text: "Meine Frage" }),
      },
    );
    const chunks = await sseChunks(response);
    const start = chunks.find((chunk) => chunk.type === "start");
    const committed = chunks.find((chunk) => chunk.type === "data-committed");
    expect(start.messageId).toBe(committed.data.id);
    expect(committed.data.question.id).toBe(questionId);
    const history = (await (
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
        headers: { cookie },
      })
    ).json()) as { id: string }[];
    expect(history.map((message) => message.id)).toEqual([
      questionId,
      start.messageId,
    ]);
  });

  it("streams reasoning as reasoning parts and starts the text with its first word", async () => {
    const { headers, id } = await emptyChat("chat-parts");
    reply = "Eine Antwort.";
    reasoningText = "Ich prüfe deine Materialien.";
    const response = await app.request(
      `${apiOrigin}/api/me/chats/${id}/messages/stream`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ id: randomUUID(), text: "Meine Frage" }),
      },
    );
    const chunks = await sseChunks(response);
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "start-step",
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
      "data-committed",
      "finish",
    ]);
    expect(chunks.find((chunk) => chunk.type === "reasoning-delta").delta).toBe(
      "Ich prüfe deine Materialien.",
    );
    reasoningText = undefined;
  });

  it("refuses a malformed or reused question ID before answering", async () => {
    const { headers, id } = await emptyChat("chat-reused-id");
    reply = "Eine Antwort.";
    const ask = (questionId: string) =>
      app.request(`${apiOrigin}/api/me/chats/${id}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: questionId, text: "Meine Frage" }),
      });
    expect((await ask("question-1")).status).toBe(400);
    const questionId = randomUUID();
    await (await ask(questionId)).text();
    const asked = prompts.length;
    const reused = await ask(questionId);
    expect(reused.status).toBe(409);
    const other = await app.request(`${apiOrigin}/api/me/chats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ courseIds: [], sourceIds: [] }),
    });
    const { id: otherId } = (await other.json()) as { id: string };
    const elsewhere = await app.request(
      `${apiOrigin}/api/me/chats/${otherId}/messages/stream`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ id: questionId, text: "Meine Frage" }),
      },
    );
    expect(elsewhere.status).toBe(409);
    expect(prompts).toHaveLength(asked);
  });

  it("refuses the second of two concurrent questions with the same ID", async () => {
    const { headers, id } = await emptyChat("chat-concurrent-id");
    reply = "Eine Antwort.";
    let release = () => {};
    finishAnswer = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      const questionId = randomUUID();
      const asked = prompts.length;
      const ask = () =>
        app.request(`${apiOrigin}/api/me/chats/${id}/messages/stream`, {
          method: "POST",
          headers,
          body: JSON.stringify({ id: questionId, text: "Meine Frage" }),
        });
      const responses = await Promise.all([ask(), ask()]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      await vi.waitFor(() => expect(prompts).toHaveLength(asked + 2));
      release();
      const outcomes = (
        await Promise.all(responses.map((response) => sseChunks(response)))
      ).map((chunks) =>
        chunks.find(
          (chunk) =>
            chunk.type === "data-committed" || chunk.type === "data-refused",
        ),
      );
      expect(outcomes.map((chunk) => chunk.type).sort()).toEqual([
        "data-committed",
        "data-refused",
      ]);
      expect(
        outcomes.find((chunk) => chunk.type === "data-refused").data,
      ).toEqual({ error: "conflict" });
    } finally {
      finishAnswer = undefined;
    }
  });

  it("opens a ready PDF only for its owner and withdraws access after deletion", async () => {
    const cookie = await signUp("chat-pdf");
    const sourceId = await chatSource(cookie, "Notizen.pdf", "Eine Kursnotiz.");
    const url = `${apiOrigin}/api/me/sources/${sourceId}/download`;
    const opened = await app.request(url, { headers: { cookie } });
    expect(opened.status).toBe(200);
    expect(opened.headers.get("cache-control")).toBe("no-store");
    expect(await opened.json()).toMatchObject({
      title: "Notizen.pdf",
      url: expect.stringContaining(sourceId),
      headers: {
        "x-amz-server-side-encryption-customer-algorithm": "AES256",
        "x-amz-server-side-encryption-customer-key": expect.any(String),
      },
    });
    expect(
      (
        await app.request(url, {
          headers: { cookie: await signUp("chat-pdf-stranger") },
        })
      ).status,
    ).toBe(404);
    await app.request(`${apiOrigin}/api/me/sources/${sourceId}`, {
      method: "DELETE",
      headers: { cookie, origin: appOrigin },
    });
    expect((await app.request(url, { headers: { cookie } })).status).toBe(404);
  });
  it("reopens a Chat with its locked courses and the canonical question and answer", async () => {
    const cookie = await signUp("chat-detail");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [] }),
      })
    ).json()) as { id: string };
    reply = "Eine Antwort.";
    const turn = (await askInChat(headers, id, "Meine erste Frage")).body as {
      id: string;
      question: { id: string };
      createdAt: string;
    };
    expect(turn.question.id).toBeTruthy();
    expect(turn.createdAt).toMatch(/^\d{4}-/);
    const detail = await app.request(`${apiOrigin}/api/me/chats/${id}`, {
      headers: { cookie },
    });
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      id,
      courses: [],
      messages: [
        { id: turn.question.id, role: "student", text: "Meine erste Frage" },
        { id: turn.id, role: "assistant" },
      ],
    });
    expect(
      (
        await app.request(`${apiOrigin}/api/me/chats/${id}`, {
          headers: { cookie: await signUp("chat-detail-stranger") },
        })
      ).status,
    ).toBe(404);
  });
  it("answers from the selected Sources only, citing them", async () => {
    const cookie = await signUp("chat");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const selected = await chatSource(
      cookie,
      "Modulhandbuch.pdf",
      "Die Klausur ist am 10. Februar.",
    );
    await chatSource(cookie, "Notizen.pdf", "Klausur: meine private Notiz.");
    await chatSource(
      await signUp("chat-stranger"),
      "Fremd.pdf",
      "Klausur eines anderen Studenten.",
    );
    reply = "Am 10. Februar [S1].";
    reasoningText = "Die Quelle nennt den Prüfungstermin.";
    steps.push(searches("Klausur"));
    prompts.length = 0;

    const created = await app.request(`${apiOrigin}/api/me/chats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ courseIds: [], sourceIds: [selected] }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const asked = await askInChat(headers, id, "Wann ist die Klausur?");

    expect([asked.status, asked.body]).toEqual([
      200,
      {
        id: expect.any(String),
        createdAt: expect.any(String),
        question: expect.objectContaining({
          role: "student",
          text: "Wann ist die Klausur?",
        }),
        role: "assistant",
        text: "Am 10. Februar [S1].",
        reasoning: "Die Quelle nennt den Prüfungstermin.",
        parts: [
          {
            type: "tool-searchMaterial",
            toolCallId: expect.any(String),
            input: { query: "Klausur" },
            output: { found: 1, sources: ["Modulhandbuch.pdf"] },
          },
          { type: "reasoning", text: "Die Quelle nennt den Prüfungstermin." },
          { type: "text", text: "Am 10. Februar [S1]." },
        ],
        model: { key: "sonnet-5.5-reasoning-high", name: "Sonnet 5.5" },
        citations: [
          {
            tag: "S1",
            provenance: {
              kind: "source",
              sourceId: selected,
              title: "Modulhandbuch.pdf",
              location: { page: 1 },
            },
          },
        ],
      },
    ]);
    expect(prompts).toHaveLength(2);
    const answering = JSON.stringify(prompts[1]);
    expect(answering).toContain("Die Klausur ist am 10. Februar.");
    expect(answering).not.toContain("private Notiz");
    expect(answering).not.toContain("anderen Studenten");
  });

  it("lists earlier messages with citations resolved when shown, withdrawing an answer once a Source it drew on is deleted", async () => {
    const cookie = await signUp("chat-history");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const handbook = await chatSource(
      cookie,
      "Modulhandbuch.pdf",
      "Die Klausur ist am 10. Februar.",
    );
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [handbook] }),
      })
    ).json()) as { id: string };
    reply = "Am 10. Februar [S1].";
    reasoningText = "Die Quelle nennt den Prüfungstermin.";
    steps.push(searches("Klausur"));
    await askInChat(headers, id, "Wann ist die Klausur?");
    reasoningText = undefined;
    const history = () =>
      app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
        headers: { cookie },
      });

    expect(await (await history()).json()).toEqual([
      {
        id: expect.any(String),
        createdAt: expect.any(String),
        role: "student",
        text: "Wann ist die Klausur?",
        parts: [{ type: "text", text: "Wann ist die Klausur?" }],
        citations: [],
        model: null,
      },
      {
        id: expect.any(String),
        createdAt: expect.any(String),
        role: "assistant",
        text: "Am 10. Februar [S1].",
        reasoning: "Die Quelle nennt den Prüfungstermin.",
        parts: [
          {
            type: "tool-searchMaterial",
            toolCallId: expect.any(String),
            input: { query: "Klausur" },
            output: { found: 1, sources: ["Modulhandbuch.pdf"] },
          },
          { type: "reasoning", text: "Die Quelle nennt den Prüfungstermin." },
          { type: "text", text: "Am 10. Februar [S1]." },
        ],
        model: { key: "sonnet-5.5-reasoning-high", name: "Sonnet 5.5" },
        citations: [
          {
            tag: "S1",
            provenance: {
              kind: "source",
              sourceId: handbook,
              title: "Modulhandbuch.pdf",
              location: { page: 1 },
            },
          },
        ],
      },
    ]);
    // Crypto-shredding has no observable effect through the API until deletion, so the stored row is checked directly.
    const stored = await admin.chatMessage.findMany({ where: { chatId: id } });
    expect(
      stored.some((row) =>
        Buffer.from(row.content).toString("utf8").includes("10. Februar"),
      ),
    ).toBe(false);
    expect(
      stored.some(
        (row) =>
          row.partsContent &&
          Buffer.from(row.partsContent)
            .toString("utf8")
            .includes("Prüfungstermin"),
      ),
    ).toBe(false);
    await app.request(`${apiOrigin}/api/me/sources/${handbook}`, {
      method: "DELETE",
      headers,
    });
    expect(await (await history()).json()).toEqual([
      {
        id: expect.any(String),
        createdAt: expect.any(String),
        role: "student",
        text: "Wann ist die Klausur?",
        parts: [{ type: "text", text: "Wann ist die Klausur?" }],
        citations: [],
        model: null,
      },
      {
        id: expect.any(String),
        createdAt: expect.any(String),
        role: "assistant",
        text: null,
        parts: [],
        citations: [{ tag: "S1", provenance: "gone" }],
        model: { key: "sonnet-5.5-reasoning-high", name: "Sonnet 5.5" },
      },
    ]);
    const stranger = await app.request(
      `${apiOrigin}/api/me/chats/${id}/messages`,
      { headers: { cookie: await signUp("chat-history-stranger") } },
    );
    expect(stranger.status).toBe(404);
  });

  it("answers a follow-up with the earlier questions and answers, and withdraws it with a Source an earlier answer drew on", async () => {
    const cookie = await signUp("chat-follow-up");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const handbook = await chatSource(
      cookie,
      "Modulhandbuch.pdf",
      "Die Klausur ist am 10. Februar.",
    );
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [handbook] }),
      })
    ).json()) as { id: string };
    const ask = (text: string) => askInChat(headers, id, text);
    reasoningText = undefined;
    reply = "Am 10. Februar [S1].";
    steps.push(searches("Klausur"));
    await ask("Wann ist die Klausur?");
    reply = "Dazu habe ich nur den Tag gefunden.";
    prompts.length = 0;

    expect((await ask("Und um wie viel Uhr?")).status).toBe(200);

    expect(prompts).toHaveLength(1);
    const context = ["user", expect.stringContaining("Europe/Berlin")];
    expect(conversation(prompts[0])).toEqual([
      ["user", "Wann ist die Klausur?"],
      ["assistant", "Am 10. Februar."],
      context,
      ["user", "Und um wie viel Uhr?"],
    ]);
    await app.request(`${apiOrigin}/api/me/sources/${handbook}`, {
      method: "DELETE",
      headers,
    });
    const messages = (await (
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
        headers: { cookie },
      })
    ).json()) as { text: string | null }[];
    expect(messages.map((message) => message.text)).toEqual([
      "Wann ist die Klausur?",
      null,
      "Und um wie viel Uhr?",
      null,
    ]);
    prompts.length = 0;
    await ask("Und wo?");
    expect(conversation(prompts[0])).toEqual([context, ["user", "Und wo?"]]);
  });

  it("refuses a selection with another student's or a deleted Source or Course", async () => {
    const cookie = await signUp("chat-select");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const deleted = await chatSource(cookie, "Alt.pdf", "Klausur alt.");
    await app.request(`${apiOrigin}/api/me/sources/${deleted}`, {
      method: "DELETE",
      headers,
    });
    const { cookie: strangerCookie } = await reviewFixture(
      "chat-select-stranger",
    );
    const foreignSource = await chatSource(
      strangerCookie,
      "Fremd.pdf",
      "Klausur fremd.",
    );
    const [foreignCourse] = (
      (await (
        await app.request(`${apiOrigin}/api/me/review`, {
          headers: { cookie: strangerCookie },
        })
      ).json()) as ReviewBody
    ).courses;
    const create = (selection: unknown, origin = appOrigin) =>
      app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers: { ...headers, origin },
        body: JSON.stringify(selection),
      });

    expect(
      (await create({ courseIds: [], sourceIds: [] }, evilOrigin)).status,
    ).toBe(403);
    for (const selection of [
      { courseIds: [], sourceIds: [foreignSource] },
      { courseIds: [], sourceIds: [deleted] },
      { courseIds: [foreignCourse!.id], sourceIds: [] },
    ]) {
      const refused = await create(selection);
      expect([refused.status, await refused.json()]).toEqual([
        404,
        { error: "gone" },
      ]);
    }
    expect((await create({ courseIds: [], sourceIds: [] })).status).toBe(201);
  });

  it("refuses a question once the Allowance is exhausted, without asking the model or recording it", async () => {
    const cookie = await signUp("chat-allowance");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const handbook = await chatSource(
      cookie,
      "Modulhandbuch.pdf",
      "Die Klausur ist am 10. Februar.",
    );
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [handbook] }),
      })
    ).json()) as { id: string };
    await admin.allowance.update({
      where: { studentId: await studentId(cookie) },
      data: { limitMicroUsd: 0 },
    });
    prompts.length = 0;

    const streaming = await app.request(
      `${apiOrigin}/api/me/chats/${id}/messages/stream`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: randomUUID(),
          text: "Wann ist die Klausur?",
        }),
      },
    );
    const streamBody = await streaming.text();
    expect(streamBody).toContain("data-refused");
    expect(streamBody).toContain("allowance_exhausted");
    expect(streamBody).not.toContain("data-committed");
    expect(prompts).toEqual([]);
    expect(
      await (
        await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
          headers: { cookie },
        })
      ).json(),
    ).toEqual([]);
  });

  it("tells the model today's date, the student's time zone and their Courses by handle", async () => {
    const { headers } = await reviewFixture("chat-context");
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [] }),
      })
    ).json()) as { id: string };
    reply = "Du hast einen Kurs.";
    prompts.length = 0;

    await askInChat(headers, id, "Welche Kurse habe ich?");

    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "Europe/Berlin",
    });
    const context = conversation(prompts[0])
      .map(([, text]) => text)
      .find((text) => text?.includes("Europe/Berlin"));
    expect(context).toContain(today);
    expect(context).toMatch(/K1\W+Analysis I/);
  });

  it("reads the Plan for a week: Obligations with their Citations, Study Blocks and Fixed Events, showing the student only counts", async () => {
    const { cookie, headers } = await reviewFixture("chat-agenda");
    const student = await studentId(cookie);
    const { id: sourceId } = await admin.source.findFirstOrThrow({
      where: { studentId: student },
    });
    const obligation = await admin.obligation.findFirstOrThrow({
      where: { studentId: student },
    });
    const post = (path: string, body: unknown) =>
      app.request(`${apiOrigin}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    expect(
      (
        await post("/api/me/study-blocks", {
          work: { kind: "obligation", id: obligation.id },
          start: "2026-11-18T09:00:00Z",
          end: "2026-11-18T11:00:00Z",
        })
      ).ok,
    ).toBe(true);
    for (const [title, start, end] of [
      ["Vorlesung Analysis", "2026-11-19T13:00:00Z", "2026-11-19T15:00:00Z"],
      ["Weihnachtsfeier", "2026-12-18T17:00:00Z", "2026-12-18T22:00:00Z"],
    ])
      expect(
        (await post("/api/me/fixed-events", { title, start, end })).ok,
      ).toBe(true);
    const { id } = (await (
      await post("/api/me/chats", { courseIds: [], sourceIds: [] })
    ).json()) as { id: string };
    steps.push(
      calls("agenda", { from: "2026-11-16", to: "2026-11-22" }),
      says("Übungsblatt 3 ist am 20. November fällig [S1]."),
    );
    prompts.length = 0;

    const chunks = await sseChunks(
      await post(`/api/me/chats/${id}/messages/stream`, {
        id: randomUUID(),
        text: "Was steht nächste Woche an?",
      }),
    );

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        output: {
          from: "2026-11-16",
          to: "2026-11-22",
          obligations: 1,
          studyBlocks: 1,
          fixedEvents: 1,
        },
      }),
    );
    const answering = JSON.stringify(prompts[1]);
    for (const shown of ["Übungsblatt 3", "Vorlesung Analysis", "10:00"])
      expect(answering).toContain(shown);
    expect(answering).not.toContain("Weihnachtsfeier");
    const committed = chunks.find((chunk) => chunk.type === "data-committed");
    expect(committed.data.citations).toEqual([
      {
        tag: "S1",
        provenance: {
          kind: "source",
          sourceId,
          title: "Analysis.pdf",
          location: { page: 1 },
        },
      },
    ]);
  });

  it("reads a Course's Facts by its handle, with their Citations, showing the student only the Course and a count", async () => {
    const { cookie, headers } = await reviewFixture("chat-course-facts", [
      {
        course: "MA-101",
        type: "exam_logistics",
        key: "exam.room",
        value: "Hörsaal H1",
        page: 1,
        quote: "MA-101 Analysis I",
        uncertainty: null,
      },
    ]);
    const { id: sourceId } = await admin.source.findFirstOrThrow({
      where: { studentId: await studentId(cookie) },
    });
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [] }),
      })
    ).json()) as { id: string };
    steps.push(
      calls("courseFacts", { course: "K1" }),
      says("Die Klausur ist im Hörsaal H1 [S1][S2]."),
    );
    prompts.length = 0;

    const chunks = await sseChunks(
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: randomUUID(), text: "Wo ist die Klausur?" }),
      }),
    );

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        output: { course: "Analysis I", facts: 2 },
      }),
    );
    expect(JSON.stringify(prompts[1])).toContain("Hörsaal H1");
    const committed = chunks.find((chunk) => chunk.type === "data-committed");
    expect(committed.data.citations).toContainEqual({
      tag: expect.any(String),
      provenance: {
        kind: "source",
        sourceId,
        title: "Analysis.pdf",
        location: { page: 1 },
      },
    });
  });

  it("withdraws an answer built on the Plan once the Source of an Obligation it read is deleted", async () => {
    const { cookie, headers } = await reviewFixture("chat-agenda-withdrawn");
    const { id: sourceId } = await admin.source.findFirstOrThrow({
      where: { studentId: await studentId(cookie) },
    });
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [] }),
      })
    ).json()) as { id: string };
    steps.push(
      calls("agenda", { from: "2026-11-16", to: "2026-11-22" }),
      says("Nächste Woche ist Übungsblatt 3 fällig."),
    );
    expect((await askInChat(headers, id, "Was steht an?")).status).toBe(200);

    await app.request(`${apiOrigin}/api/me/sources/${sourceId}`, {
      method: "DELETE",
      headers,
    });

    const messages = (await (
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
        headers: { cookie },
      })
    ).json()) as { role: string; text: string | null }[];
    expect(messages.map((message) => message.text)).toEqual([
      "Was steht an?",
      null,
    ]);
  });

  it("returns a proposed Study Block that breaks the Plan's rules to the model, without asking the student", async () => {
    const { headers, chatId } = await planningChat("chat-propose-refused");
    const day = berlinDay(8);
    await app.request(`${apiOrigin}/api/me/fixed-events`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Vorlesung",
        start: deadline(day, "10:00", "Europe/Berlin"),
        end: deadline(day, "12:00", "Europe/Berlin"),
      }),
    });
    steps.push(
      calls("agenda", { from: berlinDay(7), to: berlinDay(13) }),
      calls("proposeStudyBlock", {
        work: "O1",
        start: `${day}T10:00`,
        end: `${day}T12:00`,
      }),
      says("Da hast du schon die Vorlesung."),
    );
    prompts.length = 0;

    const asked = await askInChat(headers, chatId, "Plane Blatt 4 ein.");

    expect(asked.status).toBe(200);
    expect(JSON.stringify(prompts[1])).toMatch(/O1\W+[^"]*Übungsblatt 4/);
    expect(JSON.stringify(prompts[2])).toContain("overlaps a Fixed Event");
    expect(
      await (
        await app.request(`${apiOrigin}/api/me/approvals`, {
          headers: { cookie: headers.cookie },
        })
      ).json(),
    ).toEqual([]);
  });

  it("asks the student to approve a proposed Study Block once the answer is saved, in the Chat and among the Approvals", async () => {
    const { headers, chatId } = await planningChat("chat-propose");
    const day = berlinDay(8);
    steps.push(calls("agenda", { from: berlinDay(7), to: berlinDay(13) }), [
      ...says("Ich schlage dir einen Lernblock vor."),
      ...calls("proposeStudyBlock", {
        work: "O1",
        start: `${day}T10:00`,
        end: `${day}T12:00`,
      }),
    ]);
    prompts.length = 0;

    const chunks = await sseChunks(
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: randomUUID(), text: "Plane Blatt 4 ein." }),
      }),
    );

    expect(prompts).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.type)).toContain(
      "tool-approval-request",
    );
    const committed = chunks.find((chunk) => chunk.type === "data-committed");
    const card = committed.data.parts.find(
      (part: { type: string }) => part.type === "tool-proposeStudyBlock",
    );
    expect(card).toMatchObject({
      approvalId: expect.any(String),
      notes: [],
      action: {
        id: expect.any(String),
        fingerprint: expect.any(String),
        status: "awaiting_approval",
        shown: {
          kind: "studyBlock.create",
          work: { title: "Übungsblatt 4", course: "Analysis I" },
          from: null,
          to: {
            start: deadline(day, "10:00", "Europe/Berlin").toISOString(),
            end: deadline(day, "12:00", "Europe/Berlin").toISOString(),
          },
        },
      },
    });
    expect(
      await (
        await app.request(`${apiOrigin}/api/me/approvals`, {
          headers: { cookie: headers.cookie },
        })
      ).json(),
    ).toMatchObject([
      {
        actionId: card.action.id,
        fingerprint: card.action.fingerprint,
        agent: null,
      },
    ]);
    const reopened = (await (
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages`, {
        headers: { cookie: headers.cookie },
      })
    ).json()) as { parts: unknown[] }[];
    expect(reopened[1]!.parts).toContainEqual(card);
  });

  it("proposes a Study Block for a Task in a Course that is toward no Obligation", async () => {
    const { headers, chatId, obligationId } = await planningChat(
      "chat-propose-course-task",
    );
    const { courseId } = await admin.obligation.findUniqueOrThrow({
      where: { id: obligationId },
    });
    expect(
      (
        await app.request(`${apiOrigin}/api/me/tasks`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: "Vorlesung 3 nacharbeiten",
            obligationId: null,
            courseId,
          }),
        })
      ).status,
    ).toBe(201);
    const day = berlinDay(8);
    steps.push(calls("agenda", { from: berlinDay(7), to: berlinDay(13) }), [
      ...says("Ich schlage dir einen Lernblock vor."),
      ...calls("proposeStudyBlock", {
        work: "T1",
        start: `${day}T13:00`,
        end: `${day}T14:00`,
      }),
    ]);
    prompts.length = 0;

    const chunks = await sseChunks(
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: randomUUID(),
          text: "Plane heute 13–14 Uhr zum Nacharbeiten der Vorlesung ein.",
        }),
      }),
    );

    expect(JSON.stringify(prompts[1])).toMatch(
      /T1\W+[^"]*Vorlesung 3 nacharbeiten[^"]*K1/,
    );
    const committed = chunks.find((chunk) => chunk.type === "data-committed");
    expect(
      committed.data.parts.find(
        (part: { type: string }) => part.type === "tool-proposeStudyBlock",
      ),
    ).toMatchObject({
      action: {
        status: "awaiting_approval",
        shown: {
          kind: "studyBlock.create",
          work: { title: "Vorlesung 3 nacharbeiten", course: "Analysis I" },
        },
      },
    });
  });

  it("leaves an expired Chat proposal out of the Approvals, and shows it as expired in the Chat", async () => {
    const { headers, chatId } = await planningChat("chat-propose-expired");
    const day = berlinDay(8);
    steps.push(
      calls("agenda", { from: berlinDay(7), to: berlinDay(13) }),
      calls("proposeStudyBlock", {
        work: "O1",
        start: `${day}T10:00`,
        end: `${day}T12:00`,
      }),
    );
    const asked = await askInChat(headers, chatId, "Plane Blatt 4 ein.");
    const card = asked.body.parts.find(
      (part: { type: string }) => part.type === "tool-proposeStudyBlock",
    );
    await admin.approval.updateMany({
      where: { action: { id: card.action.id } },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    expect(
      await (
        await app.request(`${apiOrigin}/api/me/approvals`, {
          headers: { cookie: headers.cookie },
        })
      ).json(),
    ).toEqual([]);
    const home = (await (
      await app.request(`${apiOrigin}/api/me/home`, {
        headers: { cookie: headers.cookie },
      })
    ).json()) as { agentWork: { kind: string }[] };
    expect(home.agentWork.map((item) => item.kind)).not.toContain("approval");
    const reopened = (await (
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages`, {
        headers: { cookie: headers.cookie },
      })
    ).json()) as { parts: { type: string; action?: { status: string } }[] }[];
    expect(
      reopened[1]!.parts.find((part) => part.type === "tool-proposeStudyBlock")
        ?.action?.status,
    ).toBe("expired");
  });

  it("performs a Chat proposal approved on Home, without continuing the Chat", async () => {
    const { headers, chatId, obligationId } =
      await planningChat("chat-propose-home");
    const day = berlinDay(8);
    steps.push(
      calls("agenda", { from: berlinDay(7), to: berlinDay(13) }),
      calls("proposeStudyBlock", {
        work: "O1",
        start: `${day}T10:00`,
        end: `${day}T12:00`,
      }),
    );
    const asked = await askInChat(headers, chatId, "Plane Blatt 4 ein.");
    const { action } = asked.body.parts.find(
      (part: { type: string }) => part.type === "tool-proposeStudyBlock",
    );
    prompts.length = 0;

    const approved = await app.request(
      `${apiOrigin}/api/me/approvals/${action.id}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          decision: "approve",
          fingerprint: action.fingerprint,
        }),
      },
    );

    expect(approved.status).toBe(200);
    expect(
      await admin.studyBlock.findMany({
        where: { obligationId },
        select: { start: true, end: true, placedBy: true },
      }),
    ).toEqual([
      {
        start: deadline(day, "10:00", "Europe/Berlin"),
        end: deadline(day, "12:00", "Europe/Berlin"),
        placedBy: "nunio",
      },
    ]);
    const messages = (await (
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages`, {
        headers: { cookie: headers.cookie },
      })
    ).json()) as { parts: { type: string; action?: unknown }[] }[];
    expect(messages).toHaveLength(2);
    expect(
      messages[1]!.parts.find((part) => part.type === "tool-proposeStudyBlock")
        ?.action,
    ).toMatchObject({ status: "done", decision: "approved" });
    expect(prompts).toEqual([]);
  });

  it("decides an answer's proposals at once: performs the approved, records the denied, and reports both in one new message", async () => {
    const { headers, chatId, obligationId } =
      await planningChat("chat-propose-batch");
    const [day, next] = [berlinDay(8), berlinDay(9)];
    steps.push(calls("agenda", { from: berlinDay(7), to: berlinDay(13) }), [
      ...calls("proposeStudyBlock", {
        work: "O1",
        start: `${day}T10:00`,
        end: `${day}T12:00`,
      }),
      ...calls("proposeStudyBlock", {
        work: "O1",
        start: `${next}T10:00`,
        end: `${next}T12:00`,
      }),
    ]);
    const asked = await askInChat(headers, chatId, "Plane Blatt 4 ein.");
    const [first, second] = asked.body.parts.filter(
      (part: { type: string }) => part.type === "tool-proposeStudyBlock",
    );
    reply = "Den ersten Block habe ich eingetragen, den zweiten nicht.";
    prompts.length = 0;

    const chunks = await sseChunks(
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          decisions: [
            {
              approvalId: first.approvalId,
              decision: "approve",
              fingerprint: first.action.fingerprint,
            },
            { approvalId: second.approvalId, decision: "deny" },
          ],
        }),
      }),
    );

    expect(
      await admin.studyBlock.findMany({
        where: { obligationId },
        select: { start: true },
      }),
    ).toEqual([{ start: deadline(day, "10:00", "Europe/Berlin") }]);
    expect(prompts).toHaveLength(1);
    const prompt = JSON.stringify(prompts[0]);
    expect(prompt).toContain("approved");
    expect(prompt).toContain("denied");
    const started = chunks.find((chunk) => chunk.type === "start");
    expect(
      chunks.find((chunk) => chunk.type === "data-committed").data,
    ).toMatchObject({
      id: started.messageId,
      text: "Den ersten Block habe ich eingetragen, den zweiten nicht.",
    });
    const messages = (await (
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages`, {
        headers: { cookie: headers.cookie },
      })
    ).json()) as { id: string; parts: { type: string; action?: unknown }[] }[];
    expect(messages.map((message) => message.id)).toEqual([
      expect.any(String),
      asked.body.id,
      started.messageId,
    ]);
    expect(
      messages[1]!.parts
        .filter((part) => part.type === "tool-proposeStudyBlock")
        .map((part) => part.action),
    ).toEqual([
      expect.objectContaining({ status: "done", decision: "approved" }),
      expect.objectContaining({ decision: "denied" }),
    ]);
  });

  it("still performs the rest of a batch when one proposal expired meanwhile, and tells the model which one", async () => {
    const { headers, chatId, obligationId } = await planningChat(
      "chat-propose-batch-stale",
    );
    const [day, next] = [berlinDay(8), berlinDay(9)];
    steps.push(calls("agenda", { from: berlinDay(7), to: berlinDay(13) }), [
      ...calls("proposeStudyBlock", {
        work: "O1",
        start: `${day}T10:00`,
        end: `${day}T12:00`,
      }),
      ...calls("proposeStudyBlock", {
        work: "O1",
        start: `${next}T10:00`,
        end: `${next}T12:00`,
      }),
    ]);
    const asked = await askInChat(headers, chatId, "Plane Blatt 4 ein.");
    const [first, second] = asked.body.parts.filter(
      (part: { type: string }) => part.type === "tool-proposeStudyBlock",
    );
    await admin.approval.updateMany({
      where: { actionId: first.action.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    reply =
      "Der erste Vorschlag war abgelaufen, den zweiten habe ich eingetragen.";
    prompts.length = 0;

    const response = await app.request(
      `${apiOrigin}/api/me/chats/${chatId}/messages/stream`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          decisions: [first, second].map((part) => ({
            approvalId: part.approvalId,
            decision: "approve",
            fingerprint: part.action.fingerprint,
          })),
        }),
      },
    );
    await sseChunks(response);

    expect(response.status).toBe(200);
    expect(
      await admin.studyBlock.findMany({
        where: { obligationId },
        select: { start: true },
      }),
    ).toEqual([{ start: deadline(next, "10:00", "Europe/Berlin") }]);
    expect(JSON.stringify(prompts[0])).toContain("expired or changed");
    const messages = (await (
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages`, {
        headers: { cookie: headers.cookie },
      })
    ).json()) as { parts: { type: string; action?: { status: string } }[] }[];
    expect(
      messages[1]!.parts
        .filter((part) => part.type === "tool-proposeStudyBlock")
        .map((part) => part.action?.status),
    ).toEqual(["expired", "done"]);
  });

  it("refuses a batch that names a proposal twice, or approves one without its fingerprint", async () => {
    const { headers, chatId } = await planningChat("chat-propose-batch-shape");
    const day = berlinDay(8);
    steps.push(
      calls("agenda", { from: berlinDay(7), to: berlinDay(13) }),
      calls("proposeStudyBlock", {
        work: "O1",
        start: `${day}T10:00`,
        end: `${day}T12:00`,
      }),
    );
    const asked = await askInChat(headers, chatId, "Plane Blatt 4 ein.");
    const card = asked.body.parts.find(
      (part: { type: string }) => part.type === "tool-proposeStudyBlock",
    );
    const send = (decisions: unknown[]) =>
      app.request(`${apiOrigin}/api/me/chats/${chatId}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({ decisions }),
      });

    const twice = await send([
      { approvalId: card.approvalId, decision: "deny" },
      { approvalId: card.approvalId, decision: "deny" },
    ]);
    const unprinted = await send([
      { approvalId: card.approvalId, decision: "approve" },
    ]);

    expect([twice.status, unprinted.status]).toEqual([400, 400]);
    expect(
      await admin.approval.count({
        where: { actionId: card.action.id, decision: null },
      }),
    ).toBe(1);
  });

  it("shows a proposal as failed only when the student said it did not happen, and a failed attempt as refused", async () => {
    const { headers, chatId } = await planningChat("chat-propose-failed");
    const [day, next] = [berlinDay(8), berlinDay(9)];
    steps.push(calls("agenda", { from: berlinDay(7), to: berlinDay(13) }), [
      ...calls("proposeStudyBlock", {
        work: "O1",
        start: `${day}T10:00`,
        end: `${day}T12:00`,
      }),
      ...calls("proposeStudyBlock", {
        work: "O1",
        start: `${next}T10:00`,
        end: `${next}T12:00`,
      }),
    ]);
    const asked = await askInChat(headers, chatId, "Plane Blatt 4 ein.");
    const [reported, attempted] = asked.body.parts.filter(
      (part: { type: string }) => part.type === "tool-proposeStudyBlock",
    );
    await admin.action.update({
      where: { id: reported.action.id },
      data: { status: "unconfirmed" },
    });
    await admin.action.update({
      where: { id: attempted.action.id },
      data: { status: "failed", failure: "the executor gave up" },
    });

    await app.request(
      `${apiOrigin}/api/me/actions/${reported.action.id}/resolve`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ resolution: "did_not_happen" }),
      },
    );

    const messages = (await (
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages`, {
        headers: { cookie: headers.cookie },
      })
    ).json()) as { parts: { type: string; action?: { status: string } }[] }[];
    expect(
      messages[1]!.parts
        .filter((part) => part.type === "tool-proposeStudyBlock")
        .map((part) => part.action?.status),
    ).toEqual(["failed", "refused"]);
  });

  it("refuses a batch mixing proposals from different answers", async () => {
    const { headers, chatId } = await planningChat("chat-propose-batch-mixed");
    const day = berlinDay(8);
    const propose = async (time: string) => {
      steps.push(
        calls("agenda", { from: berlinDay(7), to: berlinDay(13) }),
        calls("proposeStudyBlock", {
          work: "O1",
          start: `${day}T${time}`,
          end: `${day}T${time.replace(/^1/, "2")}`,
        }),
      );
      const asked = await askInChat(headers, chatId, "Plane Blatt 4 ein.");
      return asked.body.parts.find(
        (part: { type: string }) => part.type === "tool-proposeStudyBlock",
      );
    };
    const [first, second] = [await propose("10:00"), await propose("13:00")];

    const response = await app.request(
      `${apiOrigin}/api/me/chats/${chatId}/messages/stream`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          decisions: [first, second].map((part) => ({
            approvalId: part.approvalId,
            decision: "deny",
          })),
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(
      await admin.approval.count({
        where: {
          actionId: { in: [first.action.id, second.action.id] },
          decision: null,
        },
      }),
    ).toBe(2);
  });

  it("performs a proposal approved in the Chat and has the model report it in a new message", async () => {
    const { headers, chatId, obligationId } = await planningChat(
      "chat-propose-approve",
    );
    const day = berlinDay(8);
    steps.push(
      calls("agenda", { from: berlinDay(7), to: berlinDay(13) }),
      calls("proposeStudyBlock", {
        work: "O1",
        start: `${day}T10:00`,
        end: `${day}T12:00`,
      }),
    );
    const asked = await askInChat(headers, chatId, "Plane Blatt 4 ein.");
    const card = asked.body.parts.find(
      (part: { type: string }) => part.type === "tool-proposeStudyBlock",
    );
    const stream = (body: unknown) =>
      app.request(`${apiOrigin}/api/me/chats/${chatId}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    const approve = (fingerprint: string) =>
      stream({
        decisions: [
          { approvalId: card.approvalId, decision: "approve", fingerprint },
        ],
      });
    reply = "Der Vorschlag hat sich geändert.";
    await sseChunks(await approve("not-the-card"));
    expect(await admin.studyBlock.count({ where: { obligationId } })).toBe(0);
    expect(JSON.stringify(prompts.at(-1))).toContain("expired or changed");
    reply = "Erledigt, der Lernblock steht in deinem Plan.";
    prompts.length = 0;

    const chunks = await sseChunks(await approve(card.action.fingerprint));

    expect(await admin.studyBlock.count({ where: { obligationId } })).toBe(1);
    expect(prompts).toHaveLength(1);
    expect(JSON.stringify(prompts[0])).toContain("approved");
    const started = chunks.find((chunk) => chunk.type === "start");
    const committed = chunks.find((chunk) => chunk.type === "data-committed");
    expect(committed.data).toMatchObject({
      id: started.messageId,
      role: "assistant",
      text: "Erledigt, der Lernblock steht in deinem Plan.",
      question: null,
    });
    const messages = (await (
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages`, {
        headers: { cookie: headers.cookie },
      })
    ).json()) as { id: string; parts: { type: string; action?: unknown }[] }[];
    expect(messages.map((message) => message.id)).toEqual([
      expect.any(String),
      asked.body.id,
      expect.any(String),
      started.messageId,
    ]);
    expect(
      messages[1]!.parts.find((part) => part.type === "tool-proposeStudyBlock")
        ?.action,
    ).toMatchObject({ status: "done", decision: "approved" });
  });

  it("proposes a Follow-up for a Course Event the Plan showed, adds it once approved, and reopens it when done", async () => {
    const { headers, chatId, obligationId } =
      await planningChat("chat-propose-task");
    const { courseId } = await admin.obligation.findUniqueOrThrow({
      where: { id: obligationId },
    });
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`${apiOrigin}/api/me${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const day = berlinDay(8);
    const stamp = (time: string) =>
      deadline(day, time, "Europe/Berlin")
        .toISOString()
        .replace(/[-:]/g, "")
        .slice(0, 15);
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:vl-3@uni",
      `DTSTAMP:${stamp("08:00")}Z`,
      "SUMMARY:Analysis Vorlesung",
      `DTSTART:${stamp("10:00")}Z`,
      `DTEND:${stamp("12:00")}Z`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    await call("POST", "/calendar-sources", { name: "Stundenplan.ics", ics });
    const plan = async () =>
      (await (await call("GET", "/plan")).json()) as {
        eventSeries: { id: string }[];
        fixedEvents: { id: string }[];
        tasks: {
          id: string;
          title: string;
          courseId: string | null;
          fixedEventId: string | null;
          role: string | null;
          done: boolean;
        }[];
      };
    const [series] = (await plan()).eventSeries;
    await call("POST", `/event-series/${series!.id}/decision`, { courseId });
    const [event] = (await plan()).fixedEvents;
    steps.push(
      calls("agenda", { from: berlinDay(7), to: berlinDay(13) }),
      calls("proposeTask", {
        event: "E1",
        role: "follow_up",
        title: "Vorlesung nacharbeiten",
        minutes: 60,
      }),
    );
    prompts.length = 0;

    const asked = await askInChat(
      headers,
      chatId,
      "Ich muss die Vorlesung diese Woche noch nacharbeiten.",
    );

    expect(JSON.stringify(prompts[1])).toMatch(
      /E1\W+[^"]*Analysis Vorlesung[^"]*K1/,
    );
    const card = asked.body.parts.find(
      (part: { type: string }) => part.type === "tool-proposeTask",
    );
    expect(card).toMatchObject({
      action: {
        status: "awaiting_approval",
        shown: {
          kind: "task.create",
          work: { title: "Vorlesung nacharbeiten", course: "Analysis I" },
          task: {
            role: "follow_up",
            minutes: 60,
            event: {
              title: "Analysis Vorlesung",
              start: deadline(day, "10:00", "Europe/Berlin").toISOString(),
            },
          },
        },
      },
    });
    const approve = async (part: {
      approvalId: string;
      action: { fingerprint: string };
    }) =>
      sseChunks(
        await call("POST", `/chats/${chatId}/messages/stream`, {
          decisions: [
            {
              approvalId: part.approvalId,
              decision: "approve",
              fingerprint: part.action.fingerprint,
            },
          ],
        }),
      );
    reply = "Erledigt, die Nachbereitung steht in deinem Plan.";
    await approve(card);
    const [task] = (await plan()).tasks;
    expect(task).toMatchObject({
      title: "Vorlesung nacharbeiten",
      courseId,
      fixedEventId: event!.id,
      role: "follow_up",
      done: false,
    });

    await call("POST", `/tasks/${task!.id}/done`, { done: true });
    steps.push(
      calls("agenda", { from: berlinDay(7), to: berlinDay(13) }),
      calls("proposeTaskReopen", { task: "T1" }),
    );
    prompts.length = 0;
    const again = await askInChat(
      headers,
      chatId,
      "Ich muss da doch nochmal ran.",
    );
    expect(JSON.stringify(prompts[1])).toMatch(/Follow-up T1 \(done\)/);
    const reopen = again.body.parts.find(
      (part: { type: string }) => part.type === "tool-proposeTaskReopen",
    );
    expect(reopen).toMatchObject({
      action: {
        shown: {
          kind: "task.reopen",
          work: { title: "Vorlesung nacharbeiten" },
        },
      },
    });
    await approve(reopen);
    expect((await plan()).tasks).toEqual([
      expect.objectContaining({ id: task!.id, done: false }),
    ]);
  });

  it("proposes moving a Study Block the Plan showed, and moves it once approved", async () => {
    const { headers, chatId, obligationId } =
      await planningChat("chat-propose-move");
    const [day, next] = [berlinDay(8), berlinDay(9)];
    const at = (date: string, time: string) =>
      deadline(date, time, "Europe/Berlin");
    await app.request(`${apiOrigin}/api/me/study-blocks`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        work: { kind: "obligation", id: obligationId },
        start: at(day, "10:00"),
        end: at(day, "12:00"),
      }),
    });
    steps.push(
      calls("agenda", { from: berlinDay(7), to: berlinDay(13) }),
      calls("proposeStudyBlockMove", {
        block: "B1",
        start: `${next}T14:00`,
        end: `${next}T16:00`,
      }),
    );

    const asked = await askInChat(
      headers,
      chatId,
      "Schieb den Block auf morgen Nachmittag.",
    );
    const card = asked.body.parts.find(
      (part: { type: string }) => part.type === "tool-proposeStudyBlockMove",
    );
    expect(card.action.shown).toEqual({
      kind: "studyBlock.move",
      work: { title: "Übungsblatt 4", course: "Analysis I" },
      from: {
        start: at(day, "10:00").toISOString(),
        end: at(day, "12:00").toISOString(),
      },
      to: {
        start: at(next, "14:00").toISOString(),
        end: at(next, "16:00").toISOString(),
      },
      task: null,
    });
    await app.request(`${apiOrigin}/api/me/approvals/${card.action.id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        decision: "approve",
        fingerprint: card.action.fingerprint,
      }),
    });

    expect(
      await admin.studyBlock.findMany({
        where: { obligationId },
        select: { start: true, end: true },
      }),
    ).toEqual([{ start: at(next, "14:00"), end: at(next, "16:00") }]);
  });

  describe("proposing to remove a Study Block (ADR-0021)", () => {
    /** A planning Chat whose Obligation has a block in eight days, 10:00–12:00, read by the model as B1. */
    async function blockChat(name: string, { locked = false } = {}) {
      const fixture = await planningChat(name);
      const day = berlinDay(8);
      const at = (time: string) => deadline(day, time, "Europe/Berlin");
      const placed = (await (
        await app.request(`${apiOrigin}/api/me/study-blocks`, {
          method: "POST",
          headers: fixture.headers,
          body: JSON.stringify({
            work: { kind: "obligation", id: fixture.obligationId },
            start: at("10:00"),
            end: at("12:00"),
          }),
        })
      ).json()) as { id: string };
      if (locked)
        await app.request(
          `${apiOrigin}/api/me/study-blocks/${placed.id}/lock`,
          {
            method: "POST",
            headers: fixture.headers,
            body: JSON.stringify({ locked: true }),
          },
        );
      steps.push(
        calls("agenda", { from: berlinDay(7), to: berlinDay(13) }),
        calls("proposeStudyBlockRemove", { block: "B1" }),
      );
      return { ...fixture, at };
    }

    it("removes the block once the student approves it on Home", async () => {
      const { headers, chatId, obligationId, at } = await blockChat(
        "chat-propose-remove",
      );

      const asked = await askInChat(headers, chatId, "Lösch den Block.");
      const card = asked.body.parts.find(
        (part: { type: string }) =>
          part.type === "tool-proposeStudyBlockRemove",
      );
      expect(card.action.shown).toEqual({
        kind: "studyBlock.remove",
        work: { title: "Übungsblatt 4", course: "Analysis I" },
        from: {
          start: at("10:00").toISOString(),
          end: at("12:00").toISOString(),
        },
        to: null,
        task: null,
      });
      await app.request(`${apiOrigin}/api/me/approvals/${card.action.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          decision: "approve",
          fingerprint: card.action.fingerprint,
        }),
      });

      expect(
        await admin.studyBlock.findMany({ where: { obligationId } }),
      ).toEqual([]);
    });

    it("returns a Locked block to the model with the reason, without asking the student", async () => {
      const { headers, chatId, obligationId } = await blockChat(
        "chat-propose-remove-locked",
        { locked: true },
      );
      steps.push(says("Der Block ist gesperrt."));
      prompts.length = 0;

      expect(
        (await askInChat(headers, chatId, "Lösch den Block.")).status,
      ).toBe(200);

      expect(JSON.stringify(prompts[2])).toContain("the block is Locked");
      expect(
        await (
          await app.request(`${apiOrigin}/api/me/approvals`, {
            headers: { cookie: headers.cookie },
          })
        ).json(),
      ).toEqual([]);
      expect(await admin.studyBlock.count({ where: { obligationId } })).toBe(1);
    });

    it("tells the model the block is gone once the student approves in the Chat", async () => {
      const { headers, chatId } = await blockChat("chat-propose-remove-report");
      const asked = await askInChat(headers, chatId, "Lösch den Block.");
      const card = asked.body.parts.find(
        (part: { type: string }) =>
          part.type === "tool-proposeStudyBlockRemove",
      );
      reply = "Erledigt, der Block ist weg.";
      prompts.length = 0;

      await sseChunks(
        await app.request(
          `${apiOrigin}/api/me/chats/${chatId}/messages/stream`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              decisions: [
                {
                  approvalId: card.approvalId,
                  decision: "approve",
                  fingerprint: card.action.fingerprint,
                },
              ],
            }),
          },
        ),
      );

      expect(JSON.stringify(prompts[0])).toContain(
        "the Study Block is removed from their Plan",
      );
    });

    it("tells the model in later turns which block it removed, by its work and time", async () => {
      const { headers, chatId } = await blockChat(
        "chat-propose-remove-history",
      );
      const asked = await askInChat(headers, chatId, "Lösch den Block.");
      const card = asked.body.parts.find(
        (part: { type: string }) =>
          part.type === "tool-proposeStudyBlockRemove",
      );
      await app.request(`${apiOrigin}/api/me/approvals/${card.action.id}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          decision: "approve",
          fingerprint: card.action.fingerprint,
        }),
      });
      reply = "Gern.";
      prompts.length = 0;

      await askInChat(headers, chatId, "Danke!");

      const answer = conversation(prompts[0]).find(
        ([role]) => role === "assistant",
      )?.[1];
      expect(answer).toContain(
        `(You proposed to remove the Study Block for "Übungsblatt 4" at ${berlinDay(8)}T10:00–12:00: approved and done.)`,
      );
    });
  });

  it("tells the model in later turns what became of an earlier proposal", async () => {
    const { headers, chatId } = await planningChat("chat-propose-history");
    const day = berlinDay(8);
    steps.push(calls("agenda", { from: berlinDay(7), to: berlinDay(13) }), [
      ...says("Hier ist mein Vorschlag."),
      ...calls("proposeStudyBlock", {
        work: "O1",
        start: `${day}T10:00`,
        end: `${day}T12:00`,
      }),
    ]);
    const asked = await askInChat(headers, chatId, "Plane Blatt 4 ein.");
    const { action } = asked.body.parts.find(
      (part: { type: string }) => part.type === "tool-proposeStudyBlock",
    );
    await app.request(`${apiOrigin}/api/me/approvals/${action.id}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        decision: "approve",
        fingerprint: action.fingerprint,
      }),
    });
    reply = "Gern.";
    prompts.length = 0;

    await askInChat(headers, chatId, "Danke!");

    const answer = conversation(prompts[0]).find(
      ([role]) => role === "assistant",
    )?.[1];
    expect(answer).toContain("Hier ist mein Vorschlag.");
    expect(answer).toMatch(
      new RegExp(`Übungsblatt 4.*${day}T10:00.*approved and done`),
    );
  });

  it("starts a practice set on a Topic once the answer is saved, and shows it as a card", async () => {
    const { headers, chatId } = await topicChat("chat-practice");
    steps.push(
      calls("courseFacts", { course: "K1" }),
      startsOnTopic("startPracticeSet"),
      says("Ich erstelle dir ein Practice Set."),
    );
    artifactRuns.length = 0;

    const chunks = await sseChunks(
      await app.request(`${apiOrigin}/api/me/chats/${chatId}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: randomUUID(),
          text: "Gib mir Übungsaufgaben.",
        }),
      }),
    );

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "tool-output-available",
        output: expect.objectContaining({ kind: "practice_set", topics: 1 }),
      }),
    );
    const committed = chunks.find((chunk) => chunk.type === "data-committed");
    const card = committed.data.parts.find(
      (part: { type: string }) => part.type === "tool-startPracticeSet",
    );
    expect(card).toMatchObject({
      output: {
        kind: "practice_set",
        topics: 1,
        artifactId: expect.any(String),
      },
      artifact: { status: "making" },
    });
    expect(artifactRuns).toHaveLength(1);
    expect(
      await admin.artifact.findUniqueOrThrow({
        where: { id: card.output.artifactId },
        select: { kind: true, runId: true },
      }),
    ).toEqual({ kind: "practice_set", runId: artifactRuns[0] });
  });

  it("starts at most one Artifact per answer, telling the model why a second does not start", async () => {
    const { headers, chatId } = await topicChat("chat-practice-once");
    steps.push(
      calls("courseFacts", { course: "K1" }),
      (prompt) => [
        ...startsOnTopic("startPracticeSet")(prompt),
        ...startsOnTopic("startFlashcards")(prompt),
      ],
      says("Ich erstelle dir ein Practice Set."),
    );
    artifactRuns.length = 0;
    prompts.length = 0;

    expect(
      (await askInChat(headers, chatId, "Alles zum Üben, bitte.")).status,
    ).toBe(200);

    expect(artifactRuns).toHaveLength(1);
    expect(JSON.stringify(prompts[2])).toContain("only one may");
  });

  it("starts no Artifact when its turn fails", async () => {
    const { cookie, headers, chatId } = await topicChat("chat-practice-failed");
    const used = (
      (await (
        await app.request(`${apiOrigin}/api/me/allowance`, {
          headers: { cookie },
        })
      ).json()) as { usedMicroUsd: number }
    ).usedMicroUsd;
    // Enough for the first two steps, not the third.
    await admin.allowance.update({
      where: { studentId: await studentId(cookie) },
      data: { limitMicroUsd: used + 2 },
    });
    steps.push(
      calls("courseFacts", { course: "K1" }),
      startsOnTopic("startPracticeSet"),
    );
    artifactRuns.length = 0;

    const asked = await askInChat(headers, chatId, "Gib mir Übungsaufgaben.");

    expect(asked.body).toEqual({ error: "allowance_exhausted" });
    expect(artifactRuns).toEqual([]);
    expect(
      await admin.artifact.count({
        where: { studentId: await studentId(cookie) },
      }),
    ).toBe(0);
  });

  it("starts no Artifact on Topics outside the Chat's selected Courses", async () => {
    const { cookie, headers } = await topicChat("chat-practice-outside");
    const { id: sourceId } = await admin.source.findFirstOrThrow({
      where: { studentId: await studentId(cookie) },
    });
    const { id: chatId } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [sourceId] }),
      })
    ).json()) as { id: string };
    steps.push(
      calls("courseFacts", { course: "K1" }),
      startsOnTopic("startPracticeSet"),
      says("Das geht in diesem Chat nicht."),
    );
    artifactRuns.length = 0;
    prompts.length = 0;

    await askInChat(headers, chatId, "Gib mir Übungsaufgaben.");

    expect(JSON.stringify(prompts[2])).toContain("selected Courses");
    expect(artifactRuns).toEqual([]);
  });

  describe("courseFacts with Understanding Levels and Artifacts", () => {
    /** What the model was given after reading K1's Facts, and the tag of its Topic. */
    async function readCourseFacts(
      headers: Record<string, string>,
      chatId: string,
    ) {
      steps.push(calls("courseFacts", { course: "K1" }), says("Gern."));
      prompts.length = 0;
      expect((await askInChat(headers, chatId, "Wo stehe ich?")).status).toBe(
        200,
      );
      const given = JSON.stringify(prompts[1]);
      const tag = /\[(S\d+)\] Analysis I, Topic/.exec(given)?.[1];
      return { given, tag };
    }

    it("gives a Topic without Evidence as not studied", async () => {
      const { headers, chatId } = await topicChat("chat-levels-none");

      const { given, tag } = await readCourseFacts(headers, chatId);

      expect(tag).toBeDefined();
      expect(given).toContain(`[${tag}] not studied`);
    });

    it("gives a Topic's self-assessed Level with the latest graded Attempt beside it and the day of the last Evidence, even to a Chat that selected nothing", async () => {
      const s = await studyFixture("chat-levels-self-assessed");
      const { artifactId, runId } = (await (
        await s.send("/api/me/artifacts", {
          kind: "practice_set",
          topicIds: [s.topicId],
          from: s.selection,
        })
      ).json()) as { artifactId: string; runId: string };
      await artifacts.make(runId);
      await s.send(`/api/me/artifacts/${artifactId}/attempts`, {
        answers: [{ itemId: "1", text: "Konvergenz." }],
      });
      await s.send(`/api/me/topics/${s.topicId}/self-assessment`, {
        level: "solid",
      });
      const { id: chatId } = (await (
        await s.send("/api/me/chats", { courseIds: [], sourceIds: [] })
      ).json()) as { id: string };

      const { given, tag } = await readCourseFacts(
        {
          cookie: s.cookie,
          origin: appOrigin,
          "content-type": "application/json",
        },
        chatId,
      );

      expect(given).toContain(
        `[${tag}] solid (latest Attempt correct on ${berlinDay(0)}, last Evidence ${berlinDay(0)})`,
      );
    });

    it("lists the Course's ready practice set by its Topics, without its content", async () => {
      const s = await studyFixture("chat-course-artifacts");
      const { runId } = (await (
        await s.send("/api/me/artifacts", {
          kind: "practice_set",
          topicIds: [s.topicId],
          from: s.selection,
        })
      ).json()) as { runId: string };
      await artifacts.make(runId);
      const { id: chatId } = (await (
        await s.send("/api/me/chats", { courseIds: [], sourceIds: [] })
      ).json()) as { id: string };

      const { given, tag } = await readCourseFacts(
        {
          cookie: s.cookie,
          origin: appOrigin,
          "content-type": "application/json",
        },
        chatId,
      );

      expect(given).toContain(
        `practice set, ready, not opened, made ${berlinDay(0)}, Topics [${tag}]`,
      );
      expect(given).not.toContain("Was kommt in der Klausur dran?");
    });
  });

  describe("agenda with Shortfalls", () => {
    /** A student with an exam due in `days` at noon, needing `minutes` if given, and a Chat with nothing selected. */
    async function examChat(name: string, days: number, minutes?: number) {
      const { headers, p, chatId } = await planningChat(name);
      const exam = await facts.enterObligation(p, {
        course: { title: "Analysis I", code: "MA-101" },
        kind: "exam",
        title: "Klausur",
        due: { date: berlinDay(days), time: "12:00", timeZone: null },
        destination: null,
      });
      if (exam.status !== "ok") throw new Error(exam.status);
      if (minutes)
        await app.request(
          `${apiOrigin}/api/me/estimates/obligation/${exam.id}`,
          {
            method: "PUT",
            headers,
            body: JSON.stringify({ minutes }),
          },
        );
      return { headers, chatId };
    }
    /** The lines of the Plan the model was given after reading it from today to `to` days ahead. */
    async function readAgenda(
      headers: Record<string, string>,
      chatId: string,
      to: number,
    ) {
      steps.push(
        calls("agenda", { from: berlinDay(0), to: berlinDay(to) }),
        says("Gern."),
      );
      prompts.length = 0;
      expect(
        (await askInChat(headers, chatId, "Schaffe ich das?")).status,
      ).toBe(200);
      const given = JSON.stringify(prompts[1]).replaceAll("\\n", "\n");
      return (
        /<<<BEGIN plan \w+>>>\n([\s\S]*?)\n<<<END plan/.exec(given)?.[1] ?? ""
      ).split("\n");
    }

    it("gives an Obligation due in the range its Shortfall and tradeoffs", async () => {
      // An exam tomorrow at noon needing 20 hours cannot fit: at most 4 hours a day before it.
      const { headers, chatId } = await examChat(
        "chat-agenda-shortfall",
        1,
        1200,
      );

      const lines = await readAgenda(headers, chatId, 1);

      const exam = lines.findIndex((line) => line.includes("· Klausur ·"));
      expect(exam).toBeGreaterThanOrEqual(0);
      expect(lines[exam + 1]).toMatch(
        /^ {2}Shortfall: \d+ min missing; tradeoffs: .*plan \d+ min less for it/,
      );
    });

    it("says why an Obligation due in the range cannot be planned", async () => {
      const { headers, chatId } = await examChat("chat-agenda-unplanned", 1);

      const lines = await readAgenda(headers, chatId, 1);

      const exam = lines.findIndex((line) => line.includes("· Klausur ·"));
      expect(lines[exam + 1]).toBe("  cannot be planned: needs an Estimate");
    });

    it("lists every current Shortfall, also of an Obligation due after the range", async () => {
      // An exam in three days needing 30 hours cannot fit: at most 4 hours a day before it.
      const { headers, chatId } = await examChat(
        "chat-agenda-shortfall-later",
        3,
        1800,
      );

      const lines = await readAgenda(headers, chatId, 0);

      expect(lines.slice(0, 2)).toEqual([
        `Obligations due ${berlinDay(0)} to ${berlinDay(0)}:`,
        "none",
      ]);
      const summary = lines.indexOf("Shortfalls until their deadlines:");
      expect(summary).toBeGreaterThanOrEqual(0);
      expect(lines.slice(summary + 1)).toContainEqual(
        expect.stringMatching(
          new RegExp(
            `^O\\d+ · Klausur · due ${berlinDay(3)} 12:00 · \\d+ min missing$`,
          ),
        ),
      );
    });
  });

  it("tells the model in later turns where an Artifact it started stands", async () => {
    const { headers, chatId } = await topicChat("chat-practice-history");
    steps.push(
      calls("courseFacts", { course: "K1" }),
      startsOnTopic("startPracticeSet"),
      says("Ich erstelle dir ein Practice Set."),
    );
    await askInChat(headers, chatId, "Gib mir Übungsaufgaben.");
    reply = "Gern.";
    prompts.length = 0;

    await askInChat(headers, chatId, "Danke!");

    const answer = conversation(prompts[0]).find(
      ([role]) => role === "assistant",
    )?.[1];
    expect(answer).toContain("Ich erstelle dir ein Practice Set.");
    expect(answer).toMatch(
      /started a practice set on 1 Topic: still being made/,
    );
  });

  it("says nothing of Courses to the model when the student has none, nor offers to read one, so selected material still gets searched", async () => {
    const cookie = await signUp("chat-context-no-courses");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const handbook = await chatSource(
      cookie,
      "Skript.pdf",
      "Die Klausur dauert 90 Minuten.",
    );
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [handbook] }),
      })
    ).json()) as { id: string };
    reply = "90 Minuten.";
    prompts.length = 0;
    offeredTools.length = 0;

    await askInChat(headers, id, "Wie lange dauert die Klausur?");

    expect(offeredTools[0]).not.toContain("courseFacts");

    const context = conversation(prompts[0])
      .map(([, text]) => text)
      .find((text) => text?.includes("Europe/Berlin"));
    expect(context).toBeDefined();
    expect(context).not.toMatch(/Course/i);
  });

  it("offers no search in a Chat with nothing selected, but still the Plan", async () => {
    const { headers, id } = await emptyChat("chat-no-search");
    reply = "Für diesen Chat ist kein Material ausgewählt.";
    offeredTools.length = 0;

    const chunks = await sseChunks(
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: randomUUID(),
          text: "Wann ist die Klausur?",
        }),
      }),
    );

    expect(offeredTools).toEqual([
      [
        "agenda",
        "proposeStudyBlock",
        "proposeStudyBlockMove",
        "proposeStudyBlockRemove",
        "proposeTask",
        "proposeTaskReopen",
      ],
    ]);
    expect(chunks.map((chunk) => chunk.type)).toContain("data-committed");
  });

  it("gives the model the passages a search found, but the student only how many and where", async () => {
    const cookie = await signUp("chat-search-summary");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const handbook = await chatSource(
      cookie,
      "Modulhandbuch.pdf",
      "Die Klausur ist am 10. Februar im Audimax.",
    );
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [handbook] }),
      })
    ).json()) as { id: string };
    steps.push(searches("Klausur"));
    reply = "Der Termin steht im Modulhandbuch [S1].";
    prompts.length = 0;

    const stream = await (
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: randomUUID(),
          text: "Wann ist die Klausur?",
        }),
      })
    ).text();

    expect(JSON.stringify(prompts[1])).toContain("im Audimax");
    expect(stream).toContain("data-committed");
    expect(stream).not.toContain("im Audimax");
    const reopened = await (
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
        headers: { cookie },
      })
    ).text();
    expect(reopened).toContain("Modulhandbuch.pdf");
    expect(reopened).not.toContain("im Audimax");
  });

  it("lets the model search at most five times, then has it answer without tools", async () => {
    const cookie = await signUp("chat-step-limit");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const handbook = await chatSource(
      cookie,
      "Modulhandbuch.pdf",
      "Die Klausur ist am 10. Februar.",
    );
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [handbook] }),
      })
    ).json()) as { id: string };
    for (let n = 1; n <= 5; n++) steps.push(searches(`Klausur ${n}`));
    reply = "Am 10. Februar [S1].";
    toolChoices.length = 0;

    const chunks = await sseChunks(
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: randomUUID(),
          text: "Wann ist die Klausur?",
        }),
      }),
    );

    expect(toolChoices).toEqual([
      ...Array.from({ length: 5 }, () => ({ type: "auto" })),
      { type: "none" },
    ]);
    expect(chunks.map((chunk) => chunk.type)).toContain("data-committed");
  });

  it("refuses a turn when the Allowance no longer covers a later step, recording nothing but keeping the steps taken charged", async () => {
    const cookie = await signUp("chat-later-step");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const handbook = await chatSource(
      cookie,
      "Modulhandbuch.pdf",
      "Die Klausur ist am 10. Februar.",
    );
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/chats`, {
        method: "POST",
        headers,
        body: JSON.stringify({ courseIds: [], sourceIds: [handbook] }),
      })
    ).json()) as { id: string };
    const allowance = async () =>
      (await (
        await app.request(`${apiOrigin}/api/me/allowance`, {
          headers: { cookie },
        })
      ).json()) as { usedMicroUsd: number; heldMicroUsd: number };
    const before = (await allowance()).usedMicroUsd;
    // Enough for the first step and its search, each charged 1 µUSD, but not for a second step.
    await admin.allowance.update({
      where: { studentId: await studentId(cookie) },
      data: { limitMicroUsd: before + 2 },
    });
    steps.push(searches("Klausur"));
    reply = "Am 10. Februar [S1].";
    prompts.length = 0;

    const chunks = await sseChunks(
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: randomUUID(),
          text: "Wann ist die Klausur?",
        }),
      }),
    );

    expect(prompts).toHaveLength(1);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "data-refused",
        data: { error: "allowance_exhausted" },
      }),
    );
    expect(chunks.map((chunk) => chunk.type)).not.toContain("data-committed");
    expect(
      await (
        await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
          headers: { cookie },
        })
      ).json(),
    ).toEqual([]);
    expect(await allowance()).toMatchObject({
      usedMicroUsd: before + 2,
      heldMicroUsd: 0,
    });
  });

  describe("a step the provider rate-limits", () => {
    async function rateLimitedChat(name: string) {
      const { cookie, headers, id } = await emptyChat(name);
      const allowance = async () =>
        (await (
          await app.request(`${apiOrigin}/api/me/allowance`, {
            headers: { cookie },
          })
        ).json()) as { usedMicroUsd: number; heldMicroUsd: number };
      const ask = async () =>
        sseChunks(
          await app.request(`${apiOrigin}/api/me/chats/${id}/messages/stream`, {
            method: "POST",
            headers,
            body: JSON.stringify({ id: randomUUID(), text: "Hallo?" }),
          }),
        );
      const messages = async () =>
        (await (
          await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
            headers: { cookie },
          })
        ).json()) as { role: string; text: string }[];
      return { allowance, ask, messages, before: await allowance() };
    }

    it("is tried again, charging only the attempt that answered", async () => {
      const chat = await rateLimitedChat("chat-rate-limited-once");
      steps.push(rejects(429), says("Hallo!"));
      prompts.length = 0;

      const chunks = await chat.ask();

      expect(prompts).toHaveLength(2);
      expect(chunks.filter((chunk) => chunk.type === "text-delta")).toEqual([
        expect.objectContaining({ delta: "Hallo!" }),
      ]);
      expect(chunks.map((chunk) => chunk.type)).toContain("data-committed");
      expect(await chat.messages()).toEqual([
        expect.objectContaining({ role: "student", text: "Hallo?" }),
        expect.objectContaining({ role: "assistant", text: "Hallo!" }),
      ]);
      expect(await chat.allowance()).toEqual({
        ...chat.before,
        usedMicroUsd: chat.before.usedMicroUsd + 1,
        heldMicroUsd: 0,
      });
    });

    it("fails the turn after two more attempts, recording and charging nothing", async () => {
      const chat = await rateLimitedChat("chat-rate-limited-thrice");
      const limited = rejects(429, { "retry-after": "0" });
      steps.push(limited, limited, limited);
      prompts.length = 0;

      const chunks = await chat.ask();

      expect(prompts).toHaveLength(3);
      expect(chunks.map((chunk) => chunk.type)).toContain("error");
      expect(chunks.map((chunk) => chunk.type)).not.toContain("data-committed");
      expect(await chat.messages()).toEqual([]);
      expect(await chat.allowance()).toEqual(chat.before);
    });

    it("is not tried again when the provider asks for a longer wait than 10 seconds", async () => {
      const chat = await rateLimitedChat("chat-rate-limited-long");
      steps.push(rejects(429, { "retry-after": "11" }));
      prompts.length = 0;

      const chunks = await chat.ask();

      expect(prompts).toHaveLength(1);
      expect(chunks.map((chunk) => chunk.type)).toContain("error");
      expect(await chat.messages()).toEqual([]);
    });

    it("is not tried again after a provider error, which may have cost something", async () => {
      const chat = await rateLimitedChat("chat-provider-error");
      steps.push(rejects(500, { "retry-after": "0" }));
      prompts.length = 0;

      const chunks = await chat.ask();

      expect(prompts).toHaveLength(1);
      expect(chunks.map((chunk) => chunk.type)).toContain("error");
      expect(await chat.messages()).toEqual([]);
    });
  });
});

describe("Plan", () => {
  /** A student with one entered Obligation due in three days at noon. */
  async function planFixture(name: string) {
    const cookie = await signUp(name);
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const due = new Date(Date.now() + 3 * 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
    const entered = await app.request(`${apiOrigin}/api/me/obligations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        course: { title: "Analysis I", code: "MA-101" },
        kind: "assignment",
        title: "Blatt 3",
        due: { date: due, time: "12:00", timeZone: null },
        destination: null,
      }),
    });
    const { id } = (await entered.json()) as { id: string };
    return { cookie, headers, obligationId: id };
  }
  type PlanBody = {
    obligations: { id: string; estimate: unknown }[];
    studyBlocks: { placedBy: string }[];
    proposal: {
      moves: { kind: string; workId: string; start: string; end: string }[];
    };
  };

  it("proposes Estimates, then applies a proposed move as a Study Block, through origin-protected routes", async () => {
    const { cookie, headers, obligationId } = await planFixture("plan");
    const plan = async () =>
      (await (
        await app.request(`${apiOrigin}/api/me/plan`, { headers: { cookie } })
      ).json()) as PlanBody;

    expect(
      (
        await app.request(`${apiOrigin}/api/me/plan/estimates`, {
          method: "POST",
          headers: { ...headers, origin: evilOrigin },
        })
      ).status,
    ).toBe(403);
    const proposed = await app.request(`${apiOrigin}/api/me/plan/estimates`, {
      method: "POST",
      headers,
    });
    expect([proposed.status, await proposed.json()]).toEqual([
      200,
      { proposed: 1 },
    ]);
    const before = await plan();
    expect(before.obligations).toEqual([
      expect.objectContaining({
        id: obligationId,
        estimate: {
          minutes: 120,
          estimatedBy: "nunio",
          rationale: "Two proofs.",
        },
      }),
    ]);
    const [move] = before.proposal.moves;
    expect(move).toMatchObject({ kind: "create", workId: obligationId });

    const apply = (body: unknown) =>
      app.request(`${apiOrigin}/api/me/plan/apply`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    expect((await apply(move)).status).toBe(200);
    expect((await apply(move)).status).toBe(409);
    expect((await plan()).studyBlocks).toEqual([
      expect.objectContaining({ placedBy: "nunio" }),
    ]);
    const corrected = await app.request(
      `${apiOrigin}/api/me/estimates/obligation/${obligationId}`,
      { method: "PUT", headers, body: JSON.stringify({ minutes: 60 }) },
    );
    expect(corrected.status).toBe(200);
    const stranger = await app.request(
      `${apiOrigin}/api/me/estimates/obligation/${obligationId}`,
      {
        method: "PUT",
        headers: { ...headers, cookie: await signUp("plan-stranger") },
        body: JSON.stringify({ minutes: 60 }),
      },
    );
    expect(stranger.status).toBe(404);
  });

  it("refuses proposing Estimates once the Allowance is exhausted, without asking the model", async () => {
    const { cookie, headers } = await planFixture("plan-allowance");
    await admin.allowance.update({
      where: { studentId: await studentId(cookie) },
      data: { limitMicroUsd: 0 },
    });
    estimatorCalls = 0;

    const refused = await app.request(`${apiOrigin}/api/me/plan/estimates`, {
      method: "POST",
      headers,
    });

    expect([refused.status, await refused.json()]).toEqual([
      403,
      { error: "allowance_exhausted" },
    ]);
    expect(estimatorCalls).toBe(0);
  });

  it("edits Tasks, Study Blocks and Limits through the student's own routes", async () => {
    const { cookie, headers, obligationId } = await planFixture("plan-edits");
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`${apiOrigin}/api/me${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    const task = await call("POST", "/tasks", {
      title: "Aufgaben 1–4",
      obligationId,
    });
    expect(task.status).toBe(201);
    const { id: taskId } = (await task.json()) as { id: string };
    expect(
      (await call("POST", `/tasks/${taskId}/done`, { done: true })).status,
    ).toBe(200);
    const start = new Date(Date.now() + 24 * 60 * 60_000),
      end = new Date(start.getTime() + 60 * 60_000);
    const placed = await call("POST", "/study-blocks", {
      work: { kind: "obligation", id: obligationId },
      start,
      end,
    });
    expect(placed.status).toBe(201);
    const { id: blockId } = (await placed.json()) as { id: string };
    expect(
      (await call("POST", `/study-blocks/${blockId}/lock`, { locked: true }))
        .status,
    ).toBe(200);
    expect(
      (
        await call("PUT", "/preferences", {
          studyFromMinute: 600,
          studyToMinute: 960,
          maxMinutesPerDay: 120,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("PUT", "/preferences", {
          studyFromMinute: 960,
          studyToMinute: 600,
          maxMinutesPerDay: 120,
        })
      ).status,
    ).toBe(400);
    const off = await call("POST", "/protected-time", {
      weekday: 7,
      fromMinute: 0,
      toMinute: 1440,
    });
    expect(off.status).toBe(201);
    const trip = await call("POST", "/protected-time", {
      start: new Date(Date.now() + 30 * 24 * 60 * 60_000),
      end: new Date(Date.now() + 33 * 24 * 60 * 60_000),
    });
    expect(trip.status).toBe(201);
    const courseId = (
      (await (
        await app.request(`${apiOrigin}/api/me/plan`, { headers: { cookie } })
      ).json()) as { obligations: { courseId: string }[] }
    ).obligations[0]!.courseId;
    expect(
      (
        await call("PUT", `/courses/${courseId}/limit`, {
          maxMinutesPerDay: 60,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call("PUT", `/tasks/${taskId}/limit`, { maxMinutesPerDay: 90 }))
        .status,
    ).toBe(200);
    expect(
      (await call("PUT", `/tasks/${taskId}/limit`, { maxMinutesPerDay: 5 }))
        .status,
    ).toBe(400);
    expect(
      (
        await call("PUT", "/priorities", {
          items: [
            { kind: "obligation", id: obligationId },
            { kind: "course", id: courseId },
          ],
        })
      ).status,
    ).toBe(200);
    const view = (await (
      await app.request(`${apiOrigin}/api/me/plan`, { headers: { cookie } })
    ).json()) as {
      tasks: { done: boolean }[];
      studyBlocks: { locked: boolean; placedBy: string }[];
      limits: { protectedTime: unknown[] };
      priorities: unknown[];
    };
    expect(view).toMatchObject({
      tasks: [{ done: true, maxMinutesPerDay: 90 }],
      studyBlocks: [{ locked: true, placedBy: "student" }],
      limits: {
        courses: [{ courseId, maxMinutesPerDay: 60 }],
        protectedTime: [{ weekday: 7 }, { start: expect.any(String) }],
      },
      priorities: [
        { kind: "obligation", id: obligationId },
        { kind: "course", id: courseId },
      ],
    });
    const { id: offId } = (await off.json()) as { id: string };
    expect((await call("DELETE", `/protected-time/${offId}`)).status).toBe(200);
    expect((await call("DELETE", `/study-blocks/${blockId}`)).status).toBe(200);
    expect((await call("DELETE", `/study-blocks/${blockId}`)).status).toBe(404);
  });

  it("enters Fixed Events and imports a calendar file, refusing one it cannot read", async () => {
    const { cookie, headers } = await planFixture("plan-calendar");
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`${apiOrigin}/api/me${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const start = new Date(Date.now() + 24 * 60 * 60_000),
      end = new Date(start.getTime() + 60 * 60_000);
    const stamp = (d: Date) =>
      d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:a@test",
      `DTSTAMP:${stamp(start)}`,
      "SUMMARY:Vorlesung",
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    expect(
      (await call("POST", "/fixed-events", { title: "Schicht", start, end }))
        .status,
    ).toBe(201);
    const imported = await call("POST", "/calendar-sources", {
      name: "Stundenplan.ics",
      ics,
    });
    expect([imported.status, await imported.json()]).toEqual([
      201,
      {
        id: expect.any(String),
        events: 1,
        skipped: { allDay: 0, outsideWindow: 0, truncated: false },
        proposedCourses: 1,
      },
    ]);
    expect(
      (
        await call("POST", "/calendar-sources", {
          name: "kaputt.ics",
          ics: "nope",
        })
      ).status,
    ).toBe(400);
    const view = (await (
      await app.request(`${apiOrigin}/api/me/plan`, { headers: { cookie } })
    ).json()) as {
      fixedEvents: { title: string }[];
      calendars: { id: string; events: number }[];
    };
    expect(view.fixedEvents.map((e) => e.title).sort()).toEqual([
      "Schicht",
      "Vorlesung",
    ]);
    expect(
      (await call("DELETE", `/calendar-sources/${view.calendars[0]!.id}`))
        .status,
    ).toBe(200);
  });

  it("proposes a Course for each Event Series of an added calendar, which the student confirms or rejects, and takes one event out", async () => {
    const { cookie, headers } = await planFixture("plan-series");
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`${apiOrigin}/api/me${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const stamp = (days: number, hour: number) => {
      const day = new Date(Date.now() + days * 24 * 60 * 60_000)
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, "");
      return `${day}T${String(hour).padStart(2, "0")}0000Z`;
    };
    const event = (uid: string, title: string, days: number) => [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp(0, 0)}`,
      `SUMMARY:${title}`,
      `DTSTART:${stamp(days, 9)}`,
      `DTEND:${stamp(days, 11)}`,
      "END:VEVENT",
    ];
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      ...event("vl-1@uni", "Analysis Vorlesung", 1),
      ...event("vl-2@uni", "Analysis Vorlesung", 8),
      ...event("yoga@uni", "Yoga", 2),
      "END:VCALENDAR",
    ].join("\r\n");
    type View = {
      eventSeries: {
        id: string;
        title: string;
        courseId: string | null;
        state: string;
      }[];
      fixedEvents: { id: string; courseId: string | null }[];
      tasks: {
        fixedEventId: string | null;
        role: string | null;
        window: { start: string; end: string } | null;
      }[];
    };
    const view = async () =>
      (await (
        await app.request(`${apiOrigin}/api/me/plan`, { headers: { cookie } })
      ).json()) as View;

    const added = await call("POST", "/calendar-sources", {
      name: "Stundenplan.ics",
      ics,
    });
    expect([added.status, await added.json()]).toEqual([
      201,
      expect.objectContaining({ events: 3, proposedCourses: 2 }),
    ]);
    const [lecture, yoga] = (await view()).eventSeries;
    expect([lecture, yoga]).toEqual([
      expect.objectContaining({
        title: "Analysis Vorlesung",
        state: "proposed",
      }),
      expect.objectContaining({ title: "Yoga", state: "proposed" }),
    ]);

    expect(
      (
        await call("POST", `/event-series/${lecture!.id}/decision`, {
          courseId: lecture!.courseId,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("POST", `/event-series/${yoga!.id}/decision`, {
          reject: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("POST", `/event-series/${randomUUID()}/decision`, {
          reject: true,
        })
      ).status,
    ).toBe(404);
    const decided = await view();
    expect(decided.eventSeries.map((s) => s.state)).toEqual([
      "confirmed",
      "rejected",
    ]);
    const courseEvents = decided.fixedEvents.filter((e) => e.courseId);
    expect(courseEvents).toHaveLength(2);

    expect(
      (
        await call("PUT", `/event-series/${lecture!.id}/routine`, {
          preparationMinutes: 30,
          followUpMinutes: 60,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("PUT", `/event-series/${lecture!.id}/routine`, {
          preparationMinutes: -5,
          followUpMinutes: 60,
        })
      ).status,
    ).toBe(400);
    const tasks = (await view()).tasks;
    expect(tasks.map((t) => [t.fixedEventId, t.role]).sort()).toEqual(
      [
        [courseEvents[0]!.id, "follow_up"],
        [courseEvents[0]!.id, "preparation"],
        [courseEvents[1]!.id, "follow_up"],
        [courseEvents[1]!.id, "preparation"],
      ].sort(),
    );
    expect(tasks.every((t) => t.window !== null)).toBe(true);

    // Skipping the Routine past both lectures leaves them without Preparations and Follow-ups.
    const until = new Date(Date.now() + 10 * 24 * 60 * 60_000);
    expect(
      (
        await call("POST", `/event-series/${lecture!.id}/routine/skip`, {
          until,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call("POST", `/event-series/${randomUUID()}/routine/skip`, {
          until,
        })
      ).status,
    ).toBe(404);
    expect((await view()).tasks).toEqual([]);

    expect(
      (await call("POST", `/fixed-events/${courseEvents[0]!.id}/detach`))
        .status,
    ).toBe(200);
    expect(
      (await view()).fixedEvents.filter((e) => e.courseId).map((e) => e.id),
    ).toEqual([courseEvents[1]!.id]);
  });
});

it("creates, renames, relates and deletes Projects through origin-protected routes", async () => {
  const { cookie, headers } = await reviewFixture("projects");
  const [course] = (
    (await (
      await app.request(`${apiOrigin}/api/me/review`, { headers: { cookie } })
    ).json()) as ReviewBody
  ).courses;
  const call = (
    method: string,
    path: string,
    body?: unknown,
    origin = appOrigin,
  ) =>
    app.request(`${apiOrigin}/api/me/projects${path}`, {
      method,
      headers: { ...headers, origin },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  expect(
    (
      await call(
        "POST",
        "",
        { name: "Klausur", courseIds: [], obligationId: null },
        evilOrigin,
      )
    ).status,
  ).toBe(403);
  const created = await call("POST", "", {
    name: "Klausurvorbereitung",
    courseIds: [course!.id],
    obligationId: course!.obligations[0]!.id,
  });
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect(
    (await call("PATCH", `/${id}`, { name: "Prüfungsphase" })).status,
  ).toBe(200);
  expect(
    (
      await call("PUT", `/${id}/relations`, {
        courseIds: [],
        obligationId: null,
      })
    ).status,
  ).toBe(200);
  expect(
    await (
      await app.request(`${apiOrigin}/api/me/projects`, { headers: { cookie } })
    ).json(),
  ).toEqual([{ id, name: "Prüfungsphase", courseIds: [], obligationId: null }]);
  expect(
    (
      await app.request(`${apiOrigin}/api/me/projects/${id}`, {
        method: "PATCH",
        headers: { origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      })
    ).status,
  ).toBe(401);
  expect((await call("DELETE", `/${id}`)).status).toBe(200);
  expect((await call("DELETE", `/${id}`)).status).toBe(404);
});

type CoursesBody = {
  current: string;
  choices: string[];
  courses: {
    id: string;
    title: string;
    code: string | null;
    semester: string;
    color: string;
    status: string;
    entered: boolean;
    archived: boolean;
    next: unknown;
    lastActivityAt: string | null;
  }[];
};

it("creates, edits, archives and deletes Courses through origin-protected routes", async () => {
  const cookie = await signUp("courses");
  const call = (
    method: string,
    path: string,
    body?: unknown,
    origin = appOrigin,
  ) =>
    app.request(`${apiOrigin}/api/me/courses${path}`, {
      method,
      headers: { cookie, origin, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const listed = async () =>
    (await (await call("GET", "")).json()) as CoursesBody;
  const { current, choices } = await listed();
  expect(choices).toContain(current);

  const analysis = { title: "Analysis I", code: "MA-101", semester: current };
  expect((await call("POST", "", analysis, evilOrigin)).status).toBe(403);
  const created = await call("POST", "", analysis);
  expect(created.status).toBe(201);
  const { id } = (await created.json()) as { id: string };
  expect(
    (await call("POST", "", { ...analysis, semester: "1999-ws" })).status,
  ).toBe(400);
  const clash = await call("POST", "", { ...analysis, title: "analysis i" });
  expect(clash.status).toBe(409);
  expect(await clash.json()).toEqual({
    error: "clash",
    course: { id, title: "Analysis I", status: "accepted", archived: false },
  });

  expect((await call("PATCH", `/${id}`, { color: "teal" })).status).toBe(200);
  expect((await listed()).courses).toEqual([
    {
      id,
      title: "Analysis I",
      code: "MA-101",
      semester: current,
      color: "teal",
      status: "accepted",
      entered: true,
      archived: false,
      next: null,
      lastActivityAt: null,
    },
  ]);
  expect(await (await call("GET", `/${id}/impact`)).json()).toEqual({
    obligations: 0,
    tasks: 0,
    studyBlocks: 0,
    futureStudyBlocks: 0,
    agents: 0,
  });
  expect((await call("POST", `/${id}/archive`)).status).toBe(200);
  expect((await listed()).courses[0]!.archived).toBe(true);
  expect((await call("POST", `/${id}/unarchive`)).status).toBe(200);
  expect((await listed()).courses[0]!.archived).toBe(false);

  const stranger = await signUp("courses-stranger");
  expect(
    (
      await app.request(`${apiOrigin}/api/me/courses/${id}`, {
        method: "PATCH",
        headers: {
          cookie: stranger,
          origin: appOrigin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: "Mine" }),
      })
    ).status,
  ).toBe(404);
  expect((await app.request(`${apiOrigin}/api/me/courses`)).status).toBe(401);

  expect((await call("DELETE", `/${id}`)).status).toBe(200);
  expect((await call("DELETE", `/${id}`)).status).toBe(404);
  expect((await listed()).courses).toEqual([]);
});

it("refuses Obligations and Agents on an Archived Course with a conflict", async () => {
  const cookie = await signUp("courses-archived");
  const headers = {
    cookie,
    origin: appOrigin,
    "content-type": "application/json",
  };
  const { current } = (await (
    await app.request(`${apiOrigin}/api/me/courses`, { headers })
  ).json()) as CoursesBody;
  const { id } = (await (
    await app.request(`${apiOrigin}/api/me/courses`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Statistik II",
        code: null,
        semester: current,
      }),
    })
  ).json()) as { id: string };
  await app.request(`${apiOrigin}/api/me/courses/${id}/archive`, {
    method: "POST",
    headers,
  });

  const obligation = await app.request(`${apiOrigin}/api/me/obligations`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      course: { id },
      kind: "exam",
      title: "Klausur",
      due: { date: "2027-02-12", time: null, timeZone: null },
      destination: null,
    }),
  });
  expect(obligation.status).toBe(409);
  const agent = await app.request(`${apiOrigin}/api/me/agents`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "Statistik organisieren",
      description: "",
      emoji: "📚",
      instructions: "Halte Statistik II organisiert.",
      courseIds: [id],
      capabilities: [],
      budgetMicroUsd: 100_000,
      trigger: { rhythm: "daily", minute: 360 },
      modelKey: "sonnet-5.5-reasoning-high",
    }),
  });
  expect(agent.status).toBe(409);
  expect(await agent.json()).toEqual({ error: "course_archived" });
  const rejected = await app.request(
    `${apiOrigin}/api/me/courses/${id}/decision`,
    { method: "POST", headers, body: JSON.stringify({ decision: "reject" }) },
  );
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toEqual({ error: "entered" });
});

describe("Home", () => {
  it("surfaces an overload's Shortfall with its tradeoffs, beside placeholders for later work", async () => {
    const { cookie, headers } = await reviewFixture("home");
    const [course] = (
      (await (
        await app.request(`${apiOrigin}/api/me/review`, { headers: { cookie } })
      ).json()) as ReviewBody
    ).courses;
    await app.request(`${apiOrigin}/api/me/courses/${course!.id}/decision`, {
      method: "POST",
      headers,
      body: JSON.stringify({ decision: "accept" }),
    });
    // An exam tomorrow at noon needing 20 hours cannot fit: at most 4 hours a day before it.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60_000)
      .toISOString()
      .slice(0, 10);
    const entered = await app.request(`${apiOrigin}/api/me/obligations`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        course: { id: course!.id },
        kind: "exam",
        title: "Klausur",
        due: { date: tomorrow, time: "12:00", timeZone: null },
        destination: null,
      }),
    });
    const { id: examId } = (await entered.json()) as { id: string };
    await app.request(`${apiOrigin}/api/me/estimates/obligation/${examId}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ minutes: 1200 }),
    });

    const home = await app.request(`${apiOrigin}/api/me/home`, {
      headers: { cookie },
    });

    expect(home.status).toBe(200);
    const body = (await home.json()) as {
      attention: { kind: string }[];
      ongoing: unknown[];
      artifacts: unknown[];
      agentWork: unknown[];
    };
    expect(body.attention).toContainEqual({
      kind: "shortfall",
      workId: examId,
      title: "Klausur",
      course: "Analysis I",
      due: expect.any(String),
      shortMinutes: expect.any(Number),
      tradeoffs: expect.arrayContaining([
        expect.objectContaining({ kind: "reduce_estimate", workId: examId }),
      ]),
      unreviewed: false,
    });
    expect(body).toMatchObject({ ongoing: [], artifacts: [], agentWork: [] });
    expect(
      (
        await app.request(`${apiOrigin}/api/me/home`, {
          headers: { cookie: "" },
        })
      ).status,
    ).toBe(401);
  });
});

/** A Plan executor that takes every effect; the API never dispatches, the Run does. */
const executor: Executor = {
  async execute(_, { idempotencyKey }) {
    return { status: "done", effect: { studyBlockId: idempotencyKey } };
  },
  async lookup() {
    return { status: "unknown" };
  },
};

/**
 * A student whose Agent's Run asked to move a block they placed, under Lernblöcke verschieben, or moved its own block
 * nunio placed for it under Eigene Lernblöcke verschieben on Immer erlaubt.
 */
async function askedForApproval(
  name: string,
  { placedBy = "student" as "student" | "nunio", executes = executor } = {},
) {
  const cookie = await signUp(name);
  const id = await studentId(cookie);
  const blockId = randomUUID();
  await admin.allowance.upsert({
    where: { studentId: id },
    create: { studentId: id, limitMicroUsd: 1_000_000 },
    update: {},
  });
  const entered = await facts.enterObligation(
    principal.fromSession({ studentId: id }),
    {
      course: { title: "Analysis I", code: "MA-101" },
      kind: "assignment",
      title: "Problem sheet 1",
      due: { date: "2099-01-05", time: "12:00", timeZone: null },
      destination: null,
    },
  );
  if (entered.status !== "ok") throw new Error(entered.status);
  const obligationId = entered.id;
  const { courseId } = await admin.obligation.findUniqueOrThrow({
    where: { id: obligationId },
  });
  await admin.course.update({
    where: { id: courseId },
    data: { status: "accepted" },
  });
  const created = await agents.create(
    principal.fromSession({ studentId: id }),
    {
      name: "Analysis organisieren",
      description: "",
      emoji: "📚",
      instructions: "Halte Analysis I organisiert.",
      courseIds: [courseId],
      capabilities: [
        { id: "moveOwnStudyBlocks", mode: "always" },
        { id: "moveStudyBlocks", mode: "ask" },
      ],
      budgetMicroUsd: 1_000_000,
      trigger: { rhythm: "daily", minute: 360 },
      modelKey: "sonnet-5.5-reasoning-high",
    },
  );
  if (created.status !== "ok") throw new Error(created.status);
  await admin.studyBlock.create({
    data: {
      id: blockId,
      studentId: id,
      obligationId,
      placedBy,
      createdByAgentId: placedBy === "nunio" ? created.id : null,
      start: new Date("2099-01-01T09:00:00Z"),
      end: new Date("2099-01-01T10:00:00Z"),
    },
  });
  const runId = randomUUID(),
    workflowId = `agentRun/${created.id}-2099-01-01T06:00:00Z`;
  await agents.startRun({
    studentId: id,
    agentId: created.id,
    runId,
    workflowId,
  });
  const intent = {
    kind: "studyBlock.move" as const,
    studyBlockId: blockId,
    start: new Date("2099-01-02T14:00:00Z"),
    end: new Date("2099-01-02T15:00:00Z"),
  };
  const gate = createDelegation({
    db: prisma,
    aiEnabled: () => true,
    executors: { plan: executes },
    planRules,
  });
  const outcome = await gate.perform(principal.fromRun(runId), {
    key: `${runId}:1:1`,
    intent,
  });
  const asking = outcome as Extract<
    typeof outcome,
    { status: "awaiting_approval" }
  >;
  return {
    cookie,
    outcome,
    headers: { cookie, origin: appOrigin, "content-type": "application/json" },
    asking,
    runId,
    workflowId,
    agentId: created.id,
    blockId,
    obligationId,
  };
}

describe("Approvals", () => {
  it("shows the student the exact Action a Run asked about, with its fingerprint and expiry", async () => {
    const asked = await askedForApproval("approval-list");

    const response = await app.request(`${apiOrigin}/api/me/approvals`, {
      headers: { cookie: asked.cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        actionId: asked.asking.actionId,
        action: {
          kind: "studyBlock.move",
          work: { title: "Problem sheet 1", course: "Analysis I" },
          from: {
            start: "2099-01-01T09:00:00.000Z",
            end: "2099-01-01T10:00:00.000Z",
          },
          to: {
            start: "2099-01-02T14:00:00.000Z",
            end: "2099-01-02T15:00:00.000Z",
          },
          task: null,
        },
        fingerprint: asked.asking.fingerprint,
        expiresAt: asked.asking.expiresAt.toISOString(),
        agent: { id: asked.agentId, name: "Analysis organisieren" },
      },
    ]);
  });

  it("records an Approval of the fingerprint the student was shown, then performs it as the Run's", async () => {
    const asked = await askedForApproval("approval-approve");

    const response = await app.request(
      `${apiOrigin}/api/me/approvals/${asked.asking.actionId}`,
      {
        method: "POST",
        headers: asked.headers,
        body: JSON.stringify({
          decision: "approve",
          fingerprint: asked.asking.fingerprint,
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(
      (
        await delegation.history(
          principal.fromSession({ studentId: await studentId(asked.cookie) }),
          {},
        )
      )[0],
    ).toMatchObject({
      runId: asked.runId,
      status: "done",
      approval: { decision: "approved" },
    });
  });

  it("refuses an Approval of any other fingerprint", async () => {
    const asked = await askedForApproval("approval-stale");

    const response = await app.request(
      `${apiOrigin}/api/me/approvals/${asked.asking.actionId}`,
      {
        method: "POST",
        headers: asked.headers,
        body: JSON.stringify({
          decision: "approve",
          fingerprint: "not-what-was-shown",
        }),
      },
    );

    expect(response.status).toBe(409);
  });

  it("answers another student's Action as gone", async () => {
    const theirs = await askedForApproval("approval-theirs");
    const cookie = await signUp("approval-intruder");

    const response = await app.request(
      `${apiOrigin}/api/me/approvals/${theirs.asking.actionId}`,
      {
        method: "POST",
        headers: {
          cookie,
          origin: appOrigin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          decision: "approve",
          fingerprint: theirs.asking.fingerprint,
        }),
      },
    );

    expect(response.status).toBe(404);
  });

  it("records a denial, which takes no Action", async () => {
    const asked = await askedForApproval("approval-deny");

    const response = await app.request(
      `${apiOrigin}/api/me/approvals/${asked.asking.actionId}`,
      {
        method: "POST",
        headers: asked.headers,
        body: JSON.stringify({ decision: "deny" }),
      },
    );

    expect(response.status).toBe(200);
    const listed = await app.request(`${apiOrigin}/api/me/approvals`, {
      headers: { cookie: asked.cookie },
    });
    expect(await listed.json()).toEqual([]);
  });
});

describe("an Unconfirmed Action", () => {
  it("is listed for the student, as the exact Action nunio could not confirm", async () => {
    const ambiguous: Executor = {
      ...executor,
      execute: async () => ({ status: "ambiguous" }),
    };
    const unconfirmed = await askedForApproval("unconfirmed-list", {
      placedBy: "nunio",
      executes: ambiguous,
    });

    const listed = await app.request(
      `${apiOrigin}/api/me/actions/unconfirmed`,
      { headers: { cookie: unconfirmed.cookie } },
    );

    expect(await listed.json()).toEqual([
      {
        actionId: unconfirmed.outcome.actionId,
        action: expect.objectContaining({
          kind: "studyBlock.move",
          work: { title: "Problem sheet 1", course: "Analysis I" },
        }),
      },
    ]);
  });

  it("is resolved by the student, as having happened or not", async () => {
    const ambiguous: Executor = {
      ...executor,
      execute: async () => ({ status: "ambiguous" }),
    };
    const unconfirmed = await askedForApproval("unconfirmed-resolve", {
      placedBy: "nunio",
      executes: ambiguous,
    });
    expect(unconfirmed.outcome).toMatchObject({ status: "unconfirmed" });

    const response = await app.request(
      `${apiOrigin}/api/me/actions/${unconfirmed.outcome.actionId}/resolve`,
      {
        method: "POST",
        headers: unconfirmed.headers,
        body: JSON.stringify({ resolution: "did_not_happen" }),
      },
    );
    const again = await app.request(
      `${apiOrigin}/api/me/actions/${unconfirmed.outcome.actionId}/resolve`,
      {
        method: "POST",
        headers: unconfirmed.headers,
        body: JSON.stringify({ resolution: "happened" }),
      },
    );

    expect(response.status).toBe(200);
    expect(again.status).toBe(409);
    expect(
      (
        await delegation.history(
          principal.fromSession({
            studentId: await studentId(unconfirmed.cookie),
          }),
          {},
        )
      )[0],
    ).toMatchObject({ status: "failed" });
  });
});

/** A student with one entered Obligation in "Analysis I", estimated so the Plan proposes work for it. */
async function withCourse(name: string) {
  const cookie = await signUp(name);
  const id = await studentId(cookie);
  const headers = {
    cookie,
    origin: appOrigin,
    "content-type": "application/json",
  };
  const entered = await facts.enterObligation(
    principal.fromSession({ studentId: id }),
    {
      course: { title: "Analysis I", code: "MA-101" },
      kind: "assignment",
      title: "Problem sheet 1",
      due: { date: "2099-01-05", time: "12:00", timeZone: null },
      destination: null,
    },
  );
  if (entered.status !== "ok") throw new Error(entered.status);
  await app.request(`${apiOrigin}/api/me/estimates/obligation/${entered.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ minutes: 60 }),
  });
  const { courseId } = await admin.obligation.findUniqueOrThrow({
    where: { id: entered.id },
  });
  return { cookie, headers, courseId, obligationId: entered.id };
}

describe("Agents", () => {
  it("show on Home as Agent work: the Approvals waiting first, then each Agent", async () => {
    const asked = await askedForApproval("agent-home");

    const home = await app.request(`${apiOrigin}/api/me/home`, {
      headers: { cookie: asked.cookie },
    });

    expect(((await home.json()) as { agentWork: unknown[] }).agentWork).toEqual(
      [
        {
          kind: "approval",
          actionId: asked.asking.actionId,
          title: "Problem sheet 1",
          expiresAt: asked.asking.expiresAt.toISOString(),
        },
        {
          kind: "agent",
          id: asked.agentId,
          name: "Analysis organisieren",
          state: "active",
        },
      ],
    );
  });

  it("shows when its next Run starts: its Uhrzeit in the student's time zone, within a day", async () => {
    const asked = await askedForApproval("agent-next-run");

    const shown = await app.request(
      `${apiOrigin}/api/me/agents/${asked.agentId}`,
      { headers: { cookie: asked.cookie } },
    );

    const runAt = new Date(
      ((await shown.json()) as { next: { runAt: string } }).next.runAt,
    );
    expect(runAt.getTime() - Date.now()).toBeGreaterThan(0);
    expect(runAt.getTime() - Date.now()).toBeLessThanOrEqual(24 * 60 * 60_000);
    expect(
      runAt.toLocaleTimeString("en-GB", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        minute: "2-digit",
      }),
    ).toBe("06:00");
  });
});

describe("an Agent's form", () => {
  /** A Course of the student's, accepted unless told otherwise. */
  async function course(
    studentId: string,
    title: string,
    data: { archivedAt?: Date; status?: "accepted" | "proposed" } = {},
  ) {
    const id = randomUUID();
    await admin.course.create({
      data: {
        id,
        studentId,
        title,
        matchTitle: title.toLowerCase(),
        semester: "2026-ws",
        color: "violet",
        status: data.status ?? "accepted",
        archivedAt: data.archivedAt ?? null,
      },
    });
    return id;
  }
  async function student(name: string) {
    const cookie = await signUp(name);
    const id = await studentId(cookie);
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`${apiOrigin}/api/me/agents${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    return { id, call, headers };
  }
  const form = (
    courseIds: string[],
    capabilities: { id: string; mode: string | null }[] = [],
  ) => ({
    name: "Klausur Statistik",
    description: "Hält meine Klausurvorbereitung auf Kurs.",
    emoji: "🤖",
    instructions: "Bereite mich auf die Klausur in Statistics II vor.",
    courseIds,
    capabilities,
    budgetMicroUsd: 5_000_000,
    trigger: { rhythm: "daily", minute: 360 } as Record<string, unknown>,
    modelKey: "sonnet-5.5-reasoning-high",
  });

  it("creates an Agent from the whole form and reads it back, each Course with its Topic and Source counts", async () => {
    const s = await student("agent-form-create");
    const statistics = await course(s.id, "Statistics II");
    await admin.fact.createMany({
      data: ["Regression", "Varianz", "Verworfen"].map((key) => ({
        id: randomUUID(),
        studentId: s.id,
        courseId: statistics,
        type: "topic" as const,
        matchKey: key,
        state:
          key === "Verworfen" ? ("rejected" as const) : ("confirmed" as const),
      })),
    });
    const source = (data: { courseId?: string; deletedAt?: Date }) =>
      admin.source.create({
        data: {
          id: randomUUID(),
          studentId: s.id,
          title: "Vorlesung.pdf",
          bytes: 1,
          uploadExpiresAt: new Date(),
          ...data,
        },
      });
    await source({ courseId: statistics });
    await source({ courseId: statistics, deletedAt: new Date() });
    const matched = await source({});
    await admin.sourceCourse.create({
      data: { sourceId: matched.id, courseId: statistics, studentId: s.id },
    });

    const created = await s.call("POST", "", form([statistics]));
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const shown = await s.call("GET", `/${id}`);

    expect(shown.status).toBe(200);
    expect(await shown.json()).toMatchObject({
      id,
      name: "Klausur Statistik",
      description: "Hält meine Klausurvorbereitung auf Kurs.",
      emoji: "🤖",
      instructions: "Bereite mich auf die Klausur in Statistics II vor.",
      courses: [
        {
          id: statistics,
          title: "Statistics II",
          color: "violet",
          archived: false,
          topics: 2,
          sources: 2,
        },
      ],
      budget: { limitMicroUsd: 5_000_000, usedMicroUsd: 0, heldMicroUsd: 0 },
      trigger: { rhythm: "daily", minute: 360 },
      state: "active",
      grants: [],
    });
    expect(scheduled).toContain(
      `save ${id} {"rhythm":"daily","minute":360} Europe/Berlin`,
    );
    expect(await (await s.call("GET", "")).json()).toEqual([
      expect.objectContaining({ id, name: "Klausur Statistik" }),
    ]);
  });

  it("runs on the Schedule of its trigger: saved with the form, paused with the Agent and removed on End", async () => {
    const s = await student("agent-trigger");
    const statistics = await course(s.id, "Statistics II");
    await admin.planPreference.create({
      data: { studentId: s.id, timeZone: "Europe/Vienna" },
    });
    const weekdays = { rhythm: "weekdays", weekdays: [5, 1], minute: 1170 };

    const created = await s.call("POST", "", {
      ...form([statistics]),
      trigger: weekdays,
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      trigger: { rhythm: "weekdays", weekdays: [1, 5], minute: 1170 },
    });
    const updated = await s.call("PUT", `/${id}`, {
      ...form([statistics]),
      trigger: { rhythm: "daily", minute: 450 },
    });
    expect(updated.status).toBe(200);
    expect((await s.call("POST", `/${id}/pause`)).status).toBe(200);
    expect((await s.call("POST", `/${id}/resume`)).status).toBe(200);
    expect((await s.call("POST", `/${id}/end`)).status).toBe(200);

    expect(scheduled.filter((call) => call.includes(id))).toEqual([
      `save ${id} {"rhythm":"weekdays","weekdays":[1,5],"minute":1170} Europe/Vienna`,
      `save ${id} {"rhythm":"daily","minute":450} Europe/Vienna`,
      `save ${id} {"rhythm":"daily","minute":450} Europe/Vienna paused`,
      `save ${id} {"rhythm":"daily","minute":450} Europe/Vienna`,
      `delete ${id}`,
    ]);
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      trigger: { rhythm: "daily", minute: 450 },
      state: "ended",
      next: { runAt: null },
    });
  });

  it("accepts only Täglich or one or more Wochentage at a minute of the day", async () => {
    const s = await student("agent-trigger-invalid");
    const statistics = await course(s.id, "Statistics II");
    const { trigger: _, ...untriggered } = form([statistics]);

    expect((await s.call("POST", "", untriggered)).status).toBe(400);
    for (const trigger of [
      { rhythm: "weekdays", weekdays: [], minute: 360 },
      { rhythm: "weekdays", weekdays: [0], minute: 360 },
      { rhythm: "weekdays", weekdays: [1, 1], minute: 360 },
      { rhythm: "daily", minute: 1440 },
      { rhythm: "daily", minute: 6.5 },
      { rhythm: "daily", weekdays: [1], minute: 360 },
      { rhythm: "hourly", minute: 0 },
    ])
      expect(
        (await s.call("POST", "", { ...form([statistics]), trigger })).status,
      ).toBe(400);
    expect(await (await s.call("GET", "")).json()).toEqual([]);
  });

  it("shows when its next Run starts: the next Uhrzeit on one of its Wochentage, in the Plan's time zone", async () => {
    const s = await student("agent-trigger-next");
    const statistics = await course(s.id, "Statistics II");
    await admin.planPreference.create({
      data: { studentId: s.id, timeZone: "America/New_York" },
    });
    const { id } = (await (
      await s.call("POST", "", {
        ...form([statistics]),
        trigger: { rhythm: "weekdays", weekdays: [3], minute: 1170 },
      })
    ).json()) as { id: string };

    const { next } = (await (await s.call("GET", `/${id}`)).json()) as {
      next: { runAt: string };
    };

    const runAt = new Date(next.runAt);
    expect(runAt.getTime()).toBeGreaterThan(Date.now());
    expect(runAt.getTime() - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
    expect(
      runAt.toLocaleString("en-GB", {
        timeZone: "America/New_York",
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
      }),
    ).toBe("Wednesday 19:30");
  });

  it("updates the whole form, keeping a Course that was Archived since and showing it as archived", async () => {
    const s = await student("agent-form-update");
    const statistics = await course(s.id, "Statistics II");
    const micro = await course(s.id, "Microeconomics");
    const { id } = (await (
      await s.call("POST", "", form([statistics]))
    ).json()) as { id: string };
    await admin.course.update({
      where: { id: statistics },
      data: { archivedAt: new Date() },
    });

    const updated = await s.call("PUT", `/${id}`, {
      ...form([statistics, micro]),
      name: "Mikro und Statistik",
      description: "",
      instructions: "Plane beide Kurse.",
      budgetMicroUsd: 2_500_000,
    });

    expect(updated.status).toBe(200);
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      name: "Mikro und Statistik",
      description: "",
      instructions: "Plane beide Kurse.",
      budget: { limitMicroUsd: 2_500_000 },
      courses: expect.arrayContaining([
        expect.objectContaining({ id: statistics, archived: true }),
        expect.objectContaining({ id: micro, archived: false }),
      ]),
    });
    expect(
      (await (await s.call("PUT", `/${id}`, form([micro]))).json()) as object,
    ).toEqual({ status: "ok" });
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      courses: [expect.objectContaining({ id: micro })],
    });
  });

  it("requires at least one Course, and only the student's accepted, unarchived Courses can be added", async () => {
    const s = await student("agent-form-courses");
    const statistics = await course(s.id, "Statistics II");
    const archived = await course(s.id, "Alte Vorlesung", {
      archivedAt: new Date(),
    });
    const proposed = await course(s.id, "Vorgeschlagen", {
      status: "proposed",
    });
    const stranger = await student("agent-form-stranger");
    const theirs = await course(stranger.id, "Fremder Kurs");

    expect((await s.call("POST", "", form([]))).status).toBe(400);
    expect(
      (await s.call("POST", "", { ...form([statistics]), name: " " })).status,
    ).toBe(400);
    const onArchived = await s.call("POST", "", form([archived]));
    expect(onArchived.status).toBe(409);
    expect(await onArchived.json()).toEqual({ error: "course_archived" });
    expect((await s.call("POST", "", form([proposed]))).status).toBe(404);
    expect((await s.call("POST", "", form([theirs]))).status).toBe(404);

    const { id } = (await (
      await s.call("POST", "", form([statistics]))
    ).json()) as { id: string };
    expect((await s.call("PUT", `/${id}`, form([]))).status).toBe(400);
    expect(
      (await s.call("PUT", `/${id}`, form([statistics, archived]))).status,
    ).toBe(409);
    expect((await stranger.call("PUT", `/${id}`, form([theirs]))).status).toBe(
      404,
    );
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      courses: [expect.objectContaining({ id: statistics })],
    });
  });

  it("offers the student's accepted, unarchived Courses with their Topic and Source counts", async () => {
    const s = await student("agent-form-offered");
    const statistics = await course(s.id, "Statistics II");
    await course(s.id, "Alte Vorlesung", { archivedAt: new Date() });
    await course(s.id, "Vorgeschlagen", { status: "proposed" });

    const offered = await s.call("GET", "/courses");

    expect(offered.status).toBe(200);
    expect(await offered.json()).toEqual([
      {
        id: statistics,
        title: "Statistics II",
        color: "violet",
        archived: false,
        topics: 0,
        sources: 0,
      },
    ]);
  });

  it("runs on a Model the student picks from those Chat offers, and keeps its Model once no longer offered", async () => {
    const s = await student("agent-model");
    const statistics = await course(s.id, "Statistics II");
    // Never offered: the founder has not enabled it in Chat.
    await admin.catalogModel.create({
      data: {
        key: "agent-test-off",
        providerModelId: "anthropic/claude-haiku-5.5",
        reasoningEffort: "low",
        maxOutputTokens: 8000,
        name: "Aus",
        provider: "Anthropic",
        description: "Nicht angeboten.",
      },
    });
    await admin.catalogModel.create({
      data: {
        key: "agent-test-model",
        providerModelId: "anthropic/claude-haiku-5.5",
        reasoningEffort: "medium",
        maxOutputTokens: 8000,
        name: "Agent-Testmodell",
        provider: "Anthropic",
        description: "Nur für diesen Test.",
        position: 99,
        chatEnabled: true,
        prices: [
          {
            minPromptTokens: 0,
            inputMicroUsdPerMTok: 1,
            outputMicroUsdPerMTok: 1,
          },
        ],
        zeroRetentionAvailable: true,
        syncedAt: new Date(),
      },
    });

    const { modelKey: _, ...unpicked } = form([statistics]);
    expect((await s.call("POST", "", unpicked)).status).toBe(400);
    for (const modelKey of ["agent-test-off", "no-such-model"]) {
      const refused = await s.call("POST", "", {
        ...form([statistics]),
        modelKey,
      });
      expect(refused.status).toBe(422);
      expect(await refused.json()).toEqual({ error: "model_unavailable" });
    }
    const created = await s.call("POST", "", {
      ...form([statistics]),
      modelKey: "agent-test-model",
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      modelKey: "agent-test-model",
    });

    // The founder stops offering it: the Agent keeps it, and may change only to one offered.
    await admin.catalogModel.update({
      where: { key: "agent-test-model" },
      data: { chatEnabled: false },
    });
    const kept = await s.call("PUT", `/${id}`, {
      ...form([statistics]),
      modelKey: "agent-test-model",
      name: "Umbenannt",
    });
    expect(kept.status).toBe(200);
    const elsewhere = await s.call("PUT", `/${id}`, {
      ...form([statistics]),
      modelKey: "agent-test-off",
    });
    expect(elsewhere.status).toBe(422);
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      name: "Umbenannt",
      modelKey: "agent-test-model",
    });
    expect(
      (
        await s.call("PUT", `/${id}`, {
          ...form([statistics]),
          modelKey: "opus-5.5-reasoning-high",
        })
      ).status,
    ).toBe(200);
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      modelKey: "opus-5.5-reasoning-high",
    });
  });

  /** The Agent's Grants as stored, by kind. */
  const grantsOf = async (agentId: string) =>
    (
      await admin.grant.findMany({
        where: { agentId },
        orderBy: { kind: "asc" },
      })
    ).map(({ kind }) => ({ kind }));

  it("saves the Agent's Capabilities with their modes, holding an unscoped Grant exactly for each on Immer erlaubt or Automatisch", async () => {
    const s = await student("agent-capabilities");
    const statistics = await course(s.id, "Statistics II");

    const created = await s.call(
      "POST",
      "",
      form(
        [statistics],
        [
          { id: "removeOwnStudyBlocks", mode: "ask" },
          { id: "moveStudyBlocks", mode: "ask" },
          { id: "createStudyBlocks", mode: "automatic" },
          { id: "moveOwnStudyBlocks", mode: "always" },
        ],
      ),
    );
    const { id } = (await created.json()) as { id: string };

    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      capabilities: [
        { id: "createStudyBlocks", mode: "automatic" },
        { id: "moveOwnStudyBlocks", mode: "always" },
        { id: "moveStudyBlocks", mode: "ask" },
        { id: "removeOwnStudyBlocks", mode: "ask" },
      ],
      grants: ["studyBlock.create", "studyBlock.move"],
    });
    // No scope of its own: each covers its kind across the Agent's current Courses.
    expect(await grantsOf(id)).toEqual([
      { kind: "studyBlock.create" },
      { kind: "studyBlock.move" },
    ]);

    // A mode changed to Nachfragen, a Capability removed and one turned on: the Grants follow.
    const updated = await s.call(
      "PUT",
      `/${id}`,
      form(
        [statistics],
        [
          { id: "createStudyBlocks", mode: "ask" },
          { id: "removeOwnStudyBlocks", mode: "automatic" },
          { id: "createTasks", mode: "automatic" },
        ],
      ),
    );

    expect(updated.status).toBe(200);
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      capabilities: [
        { id: "createStudyBlocks", mode: "ask" },
        { id: "removeOwnStudyBlocks", mode: "automatic" },
        { id: "createTasks", mode: "automatic" },
      ],
      grants: ["studyBlock.remove", "task.create"],
    });
    expect(await grantsOf(id)).toEqual([
      { kind: "studyBlock.remove" },
      { kind: "task.create" },
    ]);
    await s.call("PUT", `/${id}`, form([statistics]));
    expect(await grantsOf(id)).toEqual([]);
  });

  it("keeps Lernblöcke verschieben fixed on Nachfragen and refuses unknown, repeated or unset Capabilities", async () => {
    const s = await student("agent-capabilities-fixed");
    const statistics = await course(s.id, "Statistics II");
    const { id } = (await (
      await s.call("POST", "", form([statistics]))
    ).json()) as { id: string };

    for (const capabilities of [
      [{ id: "moveStudyBlocks", mode: "automatic" }],
      [{ id: "moveStudyBlocks", mode: "always" }],
      [{ id: "createFlashcards", mode: "automatic" }],
      [{ id: "createStudyBlocks", mode: "sometimes" }],
      [
        { id: "createStudyBlocks", mode: "automatic" },
        { id: "createStudyBlocks", mode: "ask" },
      ],
    ]) {
      expect(
        (await s.call("POST", "", form([statistics], capabilities))).status,
      ).toBe(400);
      expect(
        (await s.call("PUT", `/${id}`, form([statistics], capabilities)))
          .status,
      ).toBe(400);
    }
    const { capabilities: _, ...withoutCapabilities } = form([statistics]);
    expect((await s.call("PUT", `/${id}`, withoutCapabilities)).status).toBe(
      400,
    );

    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      capabilities: [],
      grants: [],
    });
    expect(await (await s.call("GET", "")).json()).toHaveLength(1);
  });

  it("saves Karteikarten and Übungsaufgaben erstellen simply on, without a mode or a Grant, and refuses a mode for them", async () => {
    const s = await student("agent-capabilities-material");
    const statistics = await course(s.id, "Statistics II");

    const created = await s.call(
      "POST",
      "",
      form(
        [statistics],
        [
          { id: "createPracticeSets", mode: null },
          { id: "createFlashcards", mode: null },
          { id: "createStudyBlocks", mode: "automatic" },
        ],
      ),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      capabilities: [
        { id: "createStudyBlocks", mode: "automatic" },
        { id: "createFlashcards", mode: null },
        { id: "createPracticeSets", mode: null },
      ],
      grants: ["studyBlock.create"],
    });
    for (const capabilities of [
      [{ id: "createFlashcards", mode: "ask" }],
      [{ id: "createPracticeSets", mode: "always" }],
      [{ id: "createStudyBlocks", mode: null }],
    ])
      expect(
        (await s.call("PUT", `/${id}`, form([statistics], capabilities)))
          .status,
      ).toBe(400);
  });

  it("gives an Ended Agent no Grants back when its form is saved", async () => {
    const s = await student("agent-capabilities-ended");
    const statistics = await course(s.id, "Statistics II");
    const granted = form(
      [statistics],
      [{ id: "createStudyBlocks", mode: "automatic" }],
    );
    const { id } = (await (await s.call("POST", "", granted)).json()) as {
      id: string;
    };
    await s.call("POST", `/${id}/end`);

    expect((await s.call("PUT", `/${id}`, granted)).status).toBe(200);

    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      state: "ended",
      capabilities: [{ id: "createStudyBlocks", mode: "automatic" }],
      grants: [],
    });
    expect(await grantsOf(id)).toEqual([]);
  });

  it("starts a Run now with the saved configuration, and shows it under way until it ends", async () => {
    const s = await student("agent-run-now");
    const { id } = (await (
      await s.call("POST", "", form([await course(s.id, "Statistics II")]))
    ).json()) as { id: string };
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      running: false,
    });

    const startedNow = await s.call("POST", `/${id}/runs`);

    expect(startedNow.status).toBe(201);
    const { id: runId } = (await startedNow.json()) as { id: string };
    expect(agentRunsStarted.at(-1)).toEqual({
      studentId: s.id,
      agentId: id,
      runId,
      workflowId: `agentRun/${runId}`,
    });
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      running: true,
    });
    // One Run at a time: nothing is queued.
    const again = await s.call("POST", `/${id}/runs`);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "running" });

    await admin.run.update({
      where: { id: runId },
      data: { status: "done", endedAt: new Date() },
    });
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      running: false,
    });
    expect((await s.call("POST", `/${id}/runs`)).status).toBe(201);
  });

  it("refuses to start a Run of a Paused or Ended Agent", async () => {
    const s = await student("agent-run-refused");
    const statistics = await course(s.id, "Statistics II");
    const created = async () =>
      (
        (await (await s.call("POST", "", form([statistics]))).json()) as {
          id: string;
        }
      ).id;
    const paused = await created();
    await s.call("POST", `/${paused}/pause`);
    const ended = await created();
    await s.call("POST", `/${ended}/end`);
    const before = agentRunsStarted.length;

    for (const [agent, status, error] of [
      [paused, 409, "paused"],
      [ended, 409, "ended"],
      [randomUUID(), 404, "gone"],
    ] as const) {
      const refused = await s.call("POST", `/${agent}/runs`);
      expect([refused.status, await refused.json()]).toEqual([
        status,
        { error },
      ]);
    }
    expect(agentRunsStarted).toHaveLength(before);
    expect(
      await admin.run.count({ where: { agentId: { in: [paused, ended] } } }),
    ).toBe(0);
  });

  it("does not leave a Run under way when Temporal cannot start it", async () => {
    const s = await student("agent-run-down");
    const { id } = (await (
      await s.call("POST", "", form([await course(s.id, "Statistics II")]))
    ).json()) as { id: string };

    agentRunsDown = true;
    try {
      const failed = await s.call("POST", `/${id}/runs`);
      expect([failed.status, await failed.json()]).toEqual([
        503,
        { error: "not_started" },
      ]);
    } finally {
      agentRunsDown = false;
    }

    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      running: false,
    });
    expect((await s.call("POST", `/${id}/runs`)).status).toBe(201);
  });

  /** A Run of the Agent as the worker records it, started `minutesAgo`. */
  async function recordedRun(
    studentId: string,
    agentId: string,
    minutesAgo: number,
    data: {
      status?: "running" | "done" | "stopped" | "failed";
      stopReason?: string;
      summary?: string;
    } = {},
  ) {
    const id = randomUUID();
    const startedAt = new Date(Date.now() - minutesAgo * 60_000);
    const status = data.status ?? "done";
    await admin.run.create({
      data: {
        id,
        studentId,
        agentId,
        workflowId: `agentRun/${id}`,
        status,
        trigger: "schedule",
        startedAt,
        endedAt:
          status === "running"
            ? null
            : new Date(startedAt.getTime() + 2 * 60_000),
        stopReason: data.stopReason ?? null,
        summaryContent: data.summary ? Buffer.from(data.summary) : null,
      },
    });
    return id;
  }
  /** An Action the Run asked the gate for, still waiting for the student's Approval until `expiresAt`. */
  async function asked(
    studentId: string,
    runId: string,
    expiresAt = new Date(Date.now() + 86_400_000),
  ) {
    const actionId = randomUUID();
    await admin.action.create({
      data: {
        id: actionId,
        studentId,
        runId,
        key: `${runId}:1:${actionId}`,
        kind: "studyBlock.create",
        args: {},
        status: "awaiting_approval",
      },
    });
    await admin.approval.create({
      data: {
        id: randomUUID(),
        studentId,
        actionId,
        fingerprint: "f",
        expiresAt,
      },
    });
  }

  it("tells its Run under way to stop at once when it is Paused or Ended", async () => {
    const s = await student("agent-run-stopped");
    const { id } = (await (
      await s.call("POST", "", form([await course(s.id, "Statistics II")]))
    ).json()) as { id: string };
    const { id: runId } = (await (
      await s.call("POST", `/${id}/runs`)
    ).json()) as { id: string };

    expect((await s.call("POST", `/${id}/pause`)).status).toBe(200);
    expect((await s.call("POST", `/${id}/resume`)).status).toBe(200);
    expect((await s.call("POST", `/${id}/end`)).status).toBe(200);

    expect(
      agentRunsStopped.filter((r) => r.workflowId === `agentRun/${runId}`),
    ).toEqual([
      { workflowId: `agentRun/${runId}`, reason: "paused" },
      { workflowId: `agentRun/${runId}`, reason: "ended" },
    ]);
  });

  it("ends a Run whose workflow no longer runs as failed, so it holds up no other Run", async () => {
    const s = await student("agent-run-gone");
    const { id } = (await (
      await s.call("POST", "", form([await course(s.id, "Statistics II")]))
    ).json()) as { id: string };
    // Under way a while, then its workflow was terminated: it would block every Run after it.
    const stale = await recordedRun(s.id, id, 30, { status: "running" });
    goneWorkflows.add(`agentRun/${stale}`);

    // The list, behind Home and Inbox, never waits on Temporal; opening the Agent asks.
    expect(await (await s.call("GET", "")).json()).toEqual([
      expect.objectContaining({ id, badge: "running" }),
    ]);
    expect(workflowsAsked).not.toContain(`agentRun/${stale}`);
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      running: false,
    });
    expect(workflowsAsked).toContain(`agentRun/${stale}`);
    // The list no longer reads "Läuft gerade" for it.
    expect(await (await s.call("GET", "")).json()).toEqual([
      expect.objectContaining({ id, badge: null }),
    ]);
    expect(
      await admin.run.findUniqueOrThrow({
        where: { id: stale },
        select: { status: true, endedAt: true },
      }),
    ).toEqual({ status: "failed", endedAt: expect.any(Date) });

    // A Run just started is not asked about on every read.
    const { id: fresh } = (await (
      await s.call("POST", `/${id}/runs`)
    ).json()) as { id: string };
    expect(await (await s.call("GET", `/${id}`)).json()).toMatchObject({
      running: true,
    });
    expect(workflowsAsked).not.toContain(`agentRun/${fresh}`);
    // Pausing finds a gone one too.
    goneWorkflows.add(`agentRun/${fresh}`);
    expect((await s.call("POST", `/${id}/pause`)).status).toBe(200);
    expect(
      await admin.run.findUniqueOrThrow({
        where: { id: fresh },
        select: { status: true },
      }),
    ).toEqual({ status: "failed" });
  });

  it("deletes an Agent for good: its Activity, Grants and Schedule go, and its Run under way is told to stop", async () => {
    const s = await student("agent-delete");
    const statistics = await course(s.id, "Statistics II");
    const { id } = (await (
      await s.call(
        "POST",
        "",
        form([statistics], [{ id: "createStudyBlocks", mode: "automatic" }]),
      )
    ).json()) as { id: string };
    await asked(s.id, await recordedRun(s.id, id, 30));
    const { id: runId } = (await (
      await s.call("POST", `/${id}/runs`)
    ).json()) as { id: string };
    const kept = (
      (await (await s.call("POST", "", form([statistics]))).json()) as {
        id: string;
      }
    ).id;
    const other = await student("agent-delete-other");

    expect((await other.call("DELETE", `/${id}`)).status).toBe(404);
    const deleted = await s.call("DELETE", `/${id}`);

    expect([deleted.status, await deleted.json()]).toEqual([
      200,
      { status: "ok" },
    ]);
    expect((await s.call("GET", `/${id}`)).status).toBe(404);
    expect(
      ((await (await s.call("GET", "")).json()) as { id: string }[]).map(
        (agent) => agent.id,
      ),
    ).toEqual([kept]);
    expect(await admin.run.count({ where: { agentId: id } })).toBe(0);
    expect(await admin.action.count({ where: { studentId: s.id } })).toBe(0);
    expect(await admin.grant.count({ where: { agentId: id } })).toBe(0);
    expect(scheduled.at(-1)).toBe(`delete ${id}`);
    expect(runsCancelled).toContain(`agentRun/${runId}`);
    expect((await s.call("DELETE", `/${id}`)).status).toBe(404);
  });

  it("keeps the Agent when its Schedule cannot be deleted, so Löschen can be asked again", async () => {
    const s = await student("agent-delete-down");
    const { id } = (await (
      await s.call("POST", "", form([await course(s.id, "Statistics II")]))
    ).json()) as { id: string };
    const remove = vi
      .spyOn(schedules, "delete")
      .mockRejectedValueOnce(new Error("Temporal unavailable"));
    try {
      expect((await s.call("DELETE", `/${id}`)).status).toBe(503);
    } finally {
      remove.mockRestore();
    }

    expect((await s.call("GET", `/${id}`)).status).toBe(200);
    expect((await s.call("DELETE", `/${id}`)).status).toBe(200);
  });

  it("opens Freigaben bestätigen on the oldest Run still awaiting Approval", async () => {
    const s = await student("agent-approval-run");
    const { id } = (await (
      await s.call("POST", "", form([await course(s.id, "Statistics II")]))
    ).json()) as { id: string };
    // Its Approval expired, so it no longer awaits one.
    await asked(
      s.id,
      await recordedRun(s.id, id, 300),
      new Date(Date.now() - 1_000),
    );
    const oldest = await recordedRun(s.id, id, 200);
    await asked(s.id, oldest);
    await asked(s.id, await recordedRun(s.id, id, 100));

    expect(await (await s.call("GET", "")).json()).toEqual([
      expect.objectContaining({ id, approvalRunId: oldest }),
    ]);
  });

  it("lists an Agent's Runs newest first, a page at a time, each with its open Approvals", async () => {
    const s = await student("agent-activity-list");
    const { id } = (await (
      await s.call("POST", "", form([await course(s.id, "Statistics II")]))
    ).json()) as { id: string };
    const oldest = await recordedRun(s.id, id, 300, {
      status: "stopped",
      stopReason: "budget_exhausted",
    });
    const asking = await recordedRun(s.id, id, 200);
    await asked(s.id, asking);
    // An expired Approval no longer needs the student.
    await asked(s.id, asking, new Date(Date.now() - 1_000));
    const newest = await recordedRun(s.id, id, 1, { status: "running" });

    const first = await s.call("GET", `/${id}/runs?limit=2`);

    expect(first.status).toBe(200);
    const page = (await first.json()) as {
      runs: unknown[];
      nextCursor: string | null;
    };
    expect(page.runs).toEqual([
      {
        id: newest,
        status: "running",
        trigger: "schedule",
        startedAt: expect.any(String),
        endedAt: null,
        stopReason: null,
        openApprovals: 0,
      },
      expect.objectContaining({ id: asking, status: "done", openApprovals: 1 }),
    ]);
    const rest = (await (
      await s.call("GET", `/${id}/runs?limit=2&cursor=${page.nextCursor}`)
    ).json()) as typeof page;
    expect(rest).toEqual({
      runs: [
        expect.objectContaining({
          id: oldest,
          status: "stopped",
          stopReason: "budget_exhausted",
        }),
      ],
      nextCursor: null,
    });
  });

  it("lists the student's Agents with one badge each: Pausiert, then Freigabe benötigt, then Läuft gerade, then none, Beendet last", async () => {
    const s = await student("agent-list-badges");
    const statistics = await course(s.id, "Statistics II");
    const created = async (name: string) =>
      (
        (await (
          await s.call("POST", "", { ...form([statistics]), name })
        ).json()) as { id: string }
      ).id;
    const ended = await created("Beendet");
    await s.call("POST", `/${ended}/end`);
    // An Ended Agent reads Beendet even with an open Approval or a Run left over.
    await asked(s.id, await recordedRun(s.id, ended, 5));
    await recordedRun(s.id, ended, 1, { status: "running" });
    await created("Ohne Lauf");
    const running = await created("Läuft");
    await recordedRun(s.id, running, 1, { status: "running" });
    const asking = await created("Fragt");
    await asked(s.id, await recordedRun(s.id, asking, 30));
    // Its Approval wins over its Run under way.
    await recordedRun(s.id, asking, 1, { status: "running" });
    const expired = await created("Abgelaufen");
    await asked(
      s.id,
      await recordedRun(s.id, expired, 30),
      new Date(Date.now() - 1_000),
    );
    const paused = await created("Pausiert");
    await s.call("POST", `/${paused}/pause`);

    const listed = await s.call("GET", "");

    expect(listed.status).toBe(200);
    const agents = (await listed.json()) as {
      id: string;
      name: string;
      badge: string | null;
    }[];
    expect(agents.map(({ name, badge }) => [name, badge])).toEqual([
      ["Pausiert", "paused"],
      ["Fragt", "approval_needed"],
      ["Läuft", "running"],
      // Without a badge, newest first.
      ["Abgelaufen", null],
      ["Ohne Lauf", null],
      ["Beendet", "ended"],
    ]);
    expect(agents[0]).toEqual({
      id: paused,
      name: "Pausiert",
      description: "Hält meine Klausurvorbereitung auf Kurs.",
      emoji: "🤖",
      state: "paused",
      pausedBy: "student",
      badge: "paused",
      approvalRunId: null,
    });
  });

  it("starts its Budget over in a new month, clearing what it used and keeping what it holds, and leaves a Budget-Paused Agent Paused", async () => {
    const s = await student("agent-budget-reset");
    const { id } = (await (
      await s.call("POST", "", form([await course(s.id, "Statistics II")]))
    ).json()) as { id: string };
    // Out of Budget in an earlier month, with one call's outcome still unknown.
    await admin.agent.update({
      where: { id },
      data: {
        budgetMonth: "2026-01",
        usedMicroUsd: 4_500_000,
        heldMicroUsd: 1_000_000,
        state: "paused",
        pausedBy: "budget",
      },
    });
    const shown = async () =>
      (await (await s.call("GET", `/${id}`)).json()) as Record<string, unknown>;

    expect(await shown()).toMatchObject({
      state: "paused",
      pausedBy: "budget",
      budget: {
        limitMicroUsd: 5_000_000,
        usedMicroUsd: 0,
        heldMicroUsd: 1_000_000,
      },
    });
    expect((await s.call("POST", `/${id}/resume`)).status).toBe(200);
    const run = principal.fromRun(
      await recordedRun(s.id, id, 0, { status: "running" }),
    );
    const step = (microUsd: number) =>
      delegation.meter(run, { microUsd }, async () => ({
        value: "step",
        usage: { microUsd },
      }));
    // What it holds still counts against the new month: 4 of the 5 USD are left.
    expect(await step(4_000_000)).toMatchObject({ status: "ok" });
    expect(await step(1)).toEqual({
      status: "refused",
      reason: "budget_exhausted",
    });
    expect(await shown()).toMatchObject({
      state: "paused",
      pausedBy: "budget",
      budget: { usedMicroUsd: 4_000_000, heldMicroUsd: 1_000_000 },
    });
  });

  it("shows a Run's cost against the Budget, its summary and its Verlauf, naming only a deleted Course, Source or work gelöscht", async () => {
    const s = await student("agent-activity-run");
    const statistics = await course(s.id, "Statistics II");
    const { id } = (await (
      await s.call("POST", "", form([statistics]))
    ).json()) as { id: string };
    const exam = await facts.enterObligation(
      principal.fromSession({ studentId: s.id }),
      {
        course: { id: statistics },
        kind: "exam",
        title: "Klausur Statistik",
        due: { date: "2099-02-05", time: "10:00", timeZone: null },
        destination: null,
      },
    );
    if (exam.status !== "ok") throw new Error(exam.status);
    // Archived since: its work is still named, not gelöscht.
    await admin.course.update({
      where: { id: statistics },
      data: { archivedAt: new Date() },
    });
    const removed = await course(s.id, "Alte Vorlesung");
    await admin.course.delete({ where: { id: removed } });
    const deletedSource = randomUUID();
    await admin.source.create({
      data: {
        id: deletedSource,
        studentId: s.id,
        title: "Altes Skript.pdf",
        bytes: 100,
        uploadExpiresAt: new Date(),
        deletedAt: new Date(),
      },
    });
    const runId = await recordedRun(s.id, id, 10, {
      summary: "Ich habe einen Lernblock für deine Klausur eingetragen.",
    });
    await admin.allowance.upsert({
      where: { studentId: s.id },
      create: { studentId: s.id, limitMicroUsd: 1_000_000 },
      update: {},
    });
    // Settled usage, one call still in flight, and one released, which cost nothing.
    await admin.usageReservation.createMany({
      data: [
        {
          studentId: s.id,
          agentId: id,
          runId,
          estimateMicroUsd: 200_000,
          actualMicroUsd: 90_000,
          status: "settled",
        },
        {
          studentId: s.id,
          agentId: id,
          runId,
          estimateMicroUsd: 30_000,
          status: "reserved",
        },
        {
          studentId: s.id,
          agentId: id,
          runId,
          estimateMicroUsd: 50_000,
          status: "released",
        },
      ],
    });
    const start = "2099-02-01T09:00:00.000Z";
    const end = "2099-02-01T10:00:00.000Z";
    const call = (n: number, detail: object) => ({
      runId,
      studentId: s.id,
      key: `action:2:${n}`,
      type: "action",
      detail: {
        step: 2,
        call: n,
        capability: "createStudyBlocks",
        refusal: null,
        brokenPreferences: [],
        ...detail,
      },
    });
    await admin.runEvent.createMany({
      data: [
        {
          runId,
          studentId: s.id,
          key: "read:1",
          type: "read",
          detail: {
            step: 1,
            plan: true,
            courseIds: [statistics, removed],
            sourceIds: [deletedSource],
          },
        },
        call(1, {
          actionId: randomUUID(),
          kind: "studyBlock.create",
          workId: exam.id,
          start,
          end,
          outcome: "done",
          brokenPreferences: ["outside_study_window"],
        }),
        call(2, {
          actionId: randomUUID(),
          kind: "studyBlock.create",
          workId: randomUUID(),
          start,
          end,
          outcome: "refused",
          refusal: "run_cap",
        }),
        call(3, {
          actionId: null,
          kind: null,
          workId: null,
          start: null,
          end: null,
          outcome: "refused",
          refusal: "invalid",
        }),
      ],
    });

    const shown = await s.call("GET", `/${id}/runs/${runId}`);

    expect(shown.status).toBe(200);
    const run = (await shown.json()) as { verlauf: { at: string }[] };
    expect(run).toMatchObject({
      id: runId,
      status: "done",
      costMicroUsd: 120_000,
      budgetMicroUsd: 5_000_000,
      summary: "Ich habe einen Lernblock für deine Klausur eingetragen.",
      summaryGone: false,
      openApprovals: 0,
    });
    expect(run.verlauf.map(({ at: _, ...entry }) => entry)).toEqual([
      { type: "start", trigger: "schedule" },
      {
        type: "read",
        step: 1,
        plan: true,
        approvals: false,
        inbox: false,
        courses: [
          { id: statistics, title: "Statistics II" },
          { id: removed, title: null },
        ],
        sources: [{ id: deletedSource, title: null }],
      },
      {
        type: "action",
        step: 2,
        capability: "createStudyBlocks",
        action: {
          kind: "studyBlock.create",
          work: { title: "Klausur Statistik", course: "Statistics II" },
          start,
          end,
        },
        outcome: "done",
        refusal: null,
        brokenPreferences: ["outside_study_window"],
      },
      {
        type: "action",
        step: 2,
        capability: "createStudyBlocks",
        action: { kind: "studyBlock.create", work: null, start, end },
        outcome: "refused",
        refusal: "run_cap",
        brokenPreferences: [],
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
      { type: "end", status: "done", reason: null },
    ]);
  });

  it("tells a summary gone with a deleted Source apart from a Run that wrote none", async () => {
    const s = await student("agent-activity-summary-gone");
    const { id } = (await (
      await s.call("POST", "", form([await course(s.id, "Statistics II")]))
    ).json()) as { id: string };
    const deletedSource = randomUUID();
    await admin.source.create({
      data: {
        id: deletedSource,
        studentId: s.id,
        title: "Skript.pdf",
        bytes: 100,
        uploadExpiresAt: new Date(),
        deletedAt: new Date(),
      },
    });
    const shredded = await recordedRun(s.id, id, 20);
    await admin.run.update({
      where: { id: shredded },
      data: {
        summaryContent: Buffer.from("sealed"),
        summaryKey: Buffer.from("wrapped"),
        derivedFrom: [deletedSource],
      },
    });
    const without = await recordedRun(s.id, id, 10);

    for (const [runId, summaryGone] of [
      [shredded, true],
      [without, false],
    ] as const)
      expect(
        await (await s.call("GET", `/${id}/runs/${runId}`)).json(),
      ).toMatchObject({ summary: null, summaryGone });
  });

  it("shows no Activity of another student's Agent, nor a Run under another Agent", async () => {
    const owner = await student("agent-activity-owner");
    const statistics = await course(owner.id, "Statistics II");
    const created = async () =>
      (
        (await (await owner.call("POST", "", form([statistics]))).json()) as {
          id: string;
        }
      ).id;
    const agent = await created();
    const other = await created();
    const runId = await recordedRun(owner.id, agent, 5);
    const stranger = await student("agent-activity-stranger");

    for (const [who, path] of [
      [stranger, `/${agent}/runs?limit=10`],
      [stranger, `/${agent}/runs/${runId}`],
      [owner, `/${other}/runs/${runId}`],
      [owner, `/${randomUUID()}/runs?limit=10`],
    ] as const) {
      const response = await who.call("GET", path);
      expect([response.status, await response.json()]).toEqual([
        404,
        { error: "gone" },
      ]);
    }
  });

  describe("a Run's Approvals (Freigaben)", () => {
    const asks = {
      start: "2099-02-02T09:00:00.000Z",
      end: "2099-02-02T10:00:00.000Z",
    };
    /**
     * A free-text Agent that asks before each Action of `capability`, with its exam's Course and any `more` Courses,
     * and a Run of it that ended after asking for one: a new block for the exam, or a move of the student's block.
     */
    async function askedByRun(
      name: string,
      capability: "createStudyBlocks" | "moveStudyBlocks",
      more: string[] = [],
      run: { status?: "running" } = {},
    ) {
      const s = await student(name);
      const statistics = await course(s.id, "Statistics II");
      const others = await Promise.all(
        more.map((title) => course(s.id, title)),
      );
      const { id: agentId } = (await (
        await s.call(
          "POST",
          "",
          form([statistics, ...others], [{ id: capability, mode: "ask" }]),
        )
      ).json()) as { id: string };
      const exam = await facts.enterObligation(
        principal.fromSession({ studentId: s.id }),
        {
          course: { id: statistics },
          kind: "exam",
          title: "Klausur Statistik",
          due: { date: "2099-02-05", time: "10:00", timeZone: null },
          destination: null,
        },
      );
      if (exam.status !== "ok") throw new Error(exam.status);
      const blockId = randomUUID();
      await admin.studyBlock.create({
        data: {
          id: blockId,
          studentId: s.id,
          obligationId: exam.id,
          placedBy: "student",
          start: new Date("2099-02-01T09:00:00Z"),
          end: new Date("2099-02-01T10:00:00Z"),
        },
      });
      // Asked while under way; a Run that ended takes no new Action.
      const runId = await recordedRun(s.id, agentId, 10, { status: "running" });
      const outcome = await delegation.perform(principal.fromRun(runId), {
        key: `${runId}:1:1`,
        intent:
          capability === "createStudyBlocks"
            ? {
                kind: "studyBlock.create",
                workId: exam.id,
                start: new Date(asks.start),
                end: new Date(asks.end),
              }
            : {
                kind: "studyBlock.move",
                studyBlockId: blockId,
                start: new Date(asks.start),
                end: new Date(asks.end),
              },
      });
      if (outcome.status !== "awaiting_approval")
        throw new Error(outcome.status);
      if (run.status !== "running")
        await admin.run.update({
          where: { id: runId },
          data: { status: "done", endedAt: new Date() },
        });
      const decide = (body: object) =>
        app.request(`${apiOrigin}/api/me/approvals/${outcome.actionId}`, {
          method: "POST",
          headers: s.headers,
          body: JSON.stringify(body),
        });
      const shown = async () =>
        (await (await s.call("GET", `/${agentId}/runs/${runId}`)).json()) as {
          openApprovals: number;
          approvals: { actionId: string }[];
          verlauf: { type: string; at: string }[];
        };
      return {
        s,
        agentId,
        runId,
        blockId,
        others,
        asking: outcome,
        decide,
        shown,
      };
    }
    /** The Verlauf's entries for the Run's decided or expired Approvals, without their times. */
    const decisions = (verlauf: { type: string; at: string }[]) =>
      verlauf
        .filter((entry) => entry.type === "approval")
        .map(({ at: _, ...entry }) => entry);

    it("shows each open Approval as nunio renders it, then applies an approved one through the gate as the Run's Action", async () => {
      const a = await askedByRun("run-approval-approve", "createStudyBlocks");

      const before = await a.shown();
      expect(before.openApprovals).toBe(1);
      expect(before.approvals).toEqual([
        {
          actionId: a.asking.actionId,
          action: {
            kind: "studyBlock.create",
            work: { title: "Klausur Statistik", course: "Statistics II" },
            from: null,
            to: asks,
            task: null,
          },
          fingerprint: a.asking.fingerprint,
          expiresAt: a.asking.expiresAt.toISOString(),
          agent: { id: a.agentId, name: "Klausur Statistik" },
        },
      ]);

      const decided = await a.decide({
        decision: "approve",
        fingerprint: a.asking.fingerprint,
      });

      expect([decided.status, await decided.json()]).toEqual([
        200,
        { status: "ok" },
      ]);
      // The Action stays the Run's, and the block is the Agent's own, as one made on a Grant is.
      expect(
        await admin.action.findUniqueOrThrow({
          where: { id: a.asking.actionId },
          select: { runId: true, status: true },
        }),
      ).toEqual({ runId: a.runId, status: "done" });
      expect(
        await admin.studyBlock.findMany({
          where: { studentId: a.s.id, start: new Date(asks.start) },
          select: { createdByAgentId: true },
        }),
      ).toEqual([{ createdByAgentId: a.agentId }]);
      const after = await a.shown();
      expect(after).toMatchObject({ openApprovals: 0, approvals: [] });
      expect(decisions(after.verlauf)).toEqual([
        {
          type: "approval",
          action: {
            kind: "studyBlock.create",
            work: { title: "Klausur Statistik", course: "Statistics II" },
            ...asks,
          },
          decision: "approved",
          outcome: "done",
          refusal: null,
        },
      ]);
      // Decided after the Run ended, it follows the Run's end.
      expect(after.verlauf.at(-1)).toMatchObject({ type: "approval" });
    });

    it("shows an asked Task by its title, its Obligation and that Obligation's Course, then adds it once approved, its Estimate as nunio's", async () => {
      const s = await student("run-approval-task");
      const statistics = await course(s.id, "Statistics II");
      const { id: agentId } = (await (
        await s.call(
          "POST",
          "",
          form([statistics], [{ id: "createTasks", mode: "ask" }]),
        )
      ).json()) as { id: string };
      const exam = await facts.enterObligation(
        principal.fromSession({ studentId: s.id }),
        {
          course: { id: statistics },
          kind: "exam",
          title: "Klausur Statistik",
          due: { date: "2099-02-05", time: "10:00", timeZone: null },
          destination: null,
        },
      );
      if (exam.status !== "ok") throw new Error(exam.status);
      const runId = await recordedRun(s.id, agentId, 10, { status: "running" });
      const asking = await delegation.perform(principal.fromRun(runId), {
        key: `${runId}:1:1`,
        intent: {
          kind: "task.create",
          title: "Altklausur 2024 rechnen",
          courseId: null,
          obligationId: exam.id,
          fixedEventId: null,
          role: null,
          estimateMinutes: 90,
        },
      });
      if (asking.status !== "awaiting_approval") throw new Error(asking.status);
      await admin.run.update({
        where: { id: runId },
        data: { status: "done", endedAt: new Date() },
      });
      const shown = async () =>
        (await (await s.call("GET", `/${agentId}/runs/${runId}`)).json()) as {
          approvals: { action: unknown }[];
          verlauf: { type: string; at: string }[];
        };

      expect((await shown()).approvals.map((a) => a.action)).toEqual([
        {
          kind: "task.create",
          work: { title: "Altklausur 2024 rechnen", course: "Statistics II" },
          from: null,
          to: null,
          task: {
            role: null,
            minutes: 90,
            event: null,
            obligation: "Klausur Statistik",
          },
        },
      ]);
      const decided = await app.request(
        `${apiOrigin}/api/me/approvals/${asking.actionId}`,
        {
          method: "POST",
          headers: s.headers,
          body: JSON.stringify({
            decision: "approve",
            fingerprint: asking.fingerprint,
          }),
        },
      );

      expect(decided.status).toBe(200);
      expect(
        await admin.task.findMany({
          where: { studentId: s.id },
          select: {
            title: true,
            obligationId: true,
            courseId: true,
            estimateMinutes: true,
            estimatedBy: true,
          },
        }),
      ).toEqual([
        {
          title: "Altklausur 2024 rechnen",
          obligationId: exam.id,
          courseId: null,
          estimateMinutes: 90,
          estimatedBy: "nunio",
        },
      ]);
      expect(decisions((await shown()).verlauf)).toEqual([
        {
          type: "approval",
          action: {
            kind: "task.create",
            work: {
              title: "Altklausur 2024 rechnen",
              course: "Statistics II",
              obligation: "Klausur Statistik",
            },
            start: null,
            end: null,
          },
          decision: "approved",
          outcome: "done",
          refusal: null,
        },
      ]);
    });

    it("takes no Action the student declined, and shows it declined", async () => {
      const a = await askedByRun("run-approval-deny", "createStudyBlocks");

      const decided = await a.decide({ decision: "deny" });

      expect(decided.status).toBe(200);
      expect(
        await admin.studyBlock.count({
          where: { studentId: a.s.id, start: new Date(asks.start) },
        }),
      ).toBe(0);
      const after = await a.shown();
      expect(after).toMatchObject({ openApprovals: 0, approvals: [] });
      expect(decisions(after.verlauf)).toEqual([
        expect.objectContaining({
          decision: "denied",
          outcome: null,
          refusal: null,
        }),
      ]);
    });

    it("answers that the Action changed, and moves nothing, once the block was moved since it was asked", async () => {
      const a = await askedByRun("run-approval-changed", "moveStudyBlocks");
      // The student moved the block after the Run asked to move it.
      const moved = {
        start: new Date("2099-02-01T15:00:00Z"),
        end: new Date("2099-02-01T16:00:00Z"),
      };
      await admin.studyBlock.update({ where: { id: a.blockId }, data: moved });

      const decided = await a.decide({
        decision: "approve",
        fingerprint: a.asking.fingerprint,
      });

      expect([decided.status, await decided.json()]).toEqual([
        409,
        { error: "changed" },
      ]);
      expect(
        await admin.studyBlock.findUniqueOrThrow({
          where: { id: a.blockId },
          select: { start: true, end: true },
        }),
      ).toEqual(moved);
      // The card goes; the next Run may ask again for the block where it is now.
      const after = await a.shown();
      expect(after).toMatchObject({ openApprovals: 0, approvals: [] });
      expect(decisions(after.verlauf)).toEqual([
        expect.objectContaining({
          outcome: "refused",
          refusal: "approval_mismatch",
        }),
      ]);
    });

    it("refuses an approved Action for a Course the Agent no longer has", async () => {
      const a = await askedByRun(
        "run-approval-removed-course",
        "createStudyBlocks",
        ["Microeconomics"],
      );
      expect(
        (
          await a.s.call(
            "PUT",
            `/${a.agentId}`,
            form(a.others, [{ id: "createStudyBlocks", mode: "ask" }]),
          )
        ).status,
      ).toBe(200);

      const decided = await a.decide({
        decision: "approve",
        fingerprint: a.asking.fingerprint,
      });

      expect(decided.status).toBe(200);
      expect(
        await admin.action.findUniqueOrThrow({
          where: { id: a.asking.actionId },
          select: { status: true, refusal: true },
        }),
      ).toEqual({ status: "refused", refusal: "out_of_scope" });
      expect(
        await admin.studyBlock.count({
          where: { studentId: a.s.id, start: new Date(asks.start) },
        }),
      ).toBe(0);
      expect(decisions((await a.shown()).verlauf)).toEqual([
        expect.objectContaining({
          decision: "approved",
          outcome: "refused",
          refusal: "out_of_scope",
        }),
      ]);
    });

    it("lets an unanswered Approval expire lazily: no longer open, shown expired, refused when approved late, and raising nothing", async () => {
      const a = await askedByRun("run-approval-expired", "createStudyBlocks");
      const expiredAt = new Date(Date.now() - 60_000);
      await admin.approval.update({
        where: { actionId: a.asking.actionId },
        data: { expiresAt: expiredAt },
      });

      const shown = await a.shown();
      expect(shown).toMatchObject({ openApprovals: 0, approvals: [] });
      expect(shown.verlauf.find((entry) => entry.type === "approval")).toEqual({
        type: "approval",
        at: expiredAt.toISOString(),
        action: expect.objectContaining({ kind: "studyBlock.create" }),
        decision: "expired",
        outcome: null,
        refusal: null,
      });
      const late = await a.decide({
        decision: "approve",
        fingerprint: a.asking.fingerprint,
      });
      expect([late.status, await late.json()]).toEqual([
        409,
        { error: "expired" },
      ]);
      const denied = await a.decide({ decision: "deny" });
      expect(denied.status).toBe(409);
      expect(
        await admin.studyBlock.count({
          where: { studentId: a.s.id, start: new Date(asks.start) },
        }),
      ).toBe(0);
      expect(decisions((await a.shown()).verlauf)).toEqual([
        expect.objectContaining({ decision: "expired" }),
      ]);
      // No timer, no Intervention and no email.
      expect(
        await admin.intervention.count({ where: { studentId: a.s.id } }),
      ).toBe(0);
    });

    it.each(["pause", "end"] as const)(
      "withdraws every open Approval of the Agent on %s, for good: shown withdrawn, refused when approved late, and never back on resume",
      async (control) => {
        const a = await askedByRun(
          `run-approval-withdrawn-${control}`,
          "createStudyBlocks",
        );
        // Freigaben bestätigen opens the Run awaiting Approval.
        expect(
          await (await a.s.call("GET", `/${a.agentId}`)).json(),
        ).toMatchObject({ approvalRunId: a.runId });
        // Another Run of the same Agent asked too.
        const other = await recordedRun(a.s.id, a.agentId, 5);
        await asked(a.s.id, other);
        const before = Date.now();

        expect(
          (await a.s.call("POST", `/${a.agentId}/${control}`)).status,
        ).toBe(200);

        const shown = await a.shown();
        expect(shown).toMatchObject({ openApprovals: 0, approvals: [] });
        const withdrawn = shown.verlauf.find(
          (entry) => entry.type === "approval",
        )!;
        expect(withdrawn).toEqual({
          type: "approval",
          at: expect.any(String),
          action: expect.objectContaining({ kind: "studyBlock.create" }),
          decision: "withdrawn",
          outcome: null,
          refusal: null,
        });
        expect(new Date(withdrawn.at).getTime()).toBeGreaterThanOrEqual(
          before - 1_000,
        );
        const runs = (await (
          await a.s.call("GET", `/${a.agentId}/runs?limit=10`)
        ).json()) as { runs: { openApprovals: number }[] };
        expect(runs.runs.map((run) => run.openApprovals)).toEqual([0, 0]);
        const late = await a.decide({
          decision: "approve",
          fingerprint: a.asking.fingerprint,
        });
        expect(late.status).toBe(409);
        expect(
          await admin.studyBlock.count({
            where: { studentId: a.s.id, start: new Date(asks.start) },
          }),
        ).toBe(0);
        if (control === "pause")
          expect((await a.s.call("POST", `/${a.agentId}/resume`)).status).toBe(
            200,
          );
        expect(await a.shown()).toMatchObject({
          openApprovals: 0,
          approvals: [],
        });
        const [listed] = (await (await a.s.call("GET", "")).json()) as {
          badge: string | null;
          approvalRunId: string | null;
        }[];
        expect(listed).toMatchObject({
          badge: control === "end" ? "ended" : null,
          approvalRunId: null,
        });
      },
    );

    it.each([
      ["archived", "archive", "course_archived"],
      ["deleted", "", "no_course"],
      ["rejected", "decision", "no_course"],
    ] as const)(
      "withdraws every open Approval of the Agent once its last Course is %s and it pauses",
      async (change, path, pausedBy) => {
        const a = await askedByRun(
          `run-approval-course-${change}`,
          "createStudyBlocks",
        );
        const { courseId } = await admin.agentCourse.findFirstOrThrow({
          where: { agentId: a.agentId },
        });

        const changed = await app.request(
          `${apiOrigin}/api/me/courses/${courseId}${path && `/${path}`}`,
          {
            method: path ? "POST" : "DELETE",
            headers: a.s.headers,
            body:
              path === "decision"
                ? JSON.stringify({ decision: "reject" })
                : undefined,
          },
        );

        expect(changed.status).toBe(200);
        expect(
          await (await a.s.call("GET", `/${a.agentId}`)).json(),
        ).toMatchObject({ state: "paused", pausedBy, approvalRunId: null });
        expect(await a.shown()).toMatchObject({
          openApprovals: 0,
          approvals: [],
        });
        expect(decisions((await a.shown()).verlauf)).toEqual([
          expect.objectContaining({ decision: "withdrawn" }),
        ]);
        const late = await a.decide({
          decision: "approve",
          fingerprint: a.asking.fingerprint,
        });
        expect(late.status).toBe(409);
      },
    );

    it("pauses the Agent with reason budget once its Budget runs out, withdrawing its open Approvals and pausing its Schedule until the student resumes it", async () => {
      const a = await askedByRun(
        "agent-budget-exhausted",
        "createStudyBlocks",
        [],
        {
          status: "running",
        },
      );
      const run = principal.fromRun(a.runId);
      const step = (microUsd: number) =>
        delegation.meter(run, { microUsd }, async () => ({
          value: "step",
          usage: { microUsd },
        }));
      expect(await step(4_000_000)).toMatchObject({ status: "ok" });

      expect(await step(1_500_000)).toEqual({
        status: "refused",
        reason: "budget_exhausted",
      });
      await agentRuns.finish(
        { runId: a.runId, studentId: a.s.id },
        { status: "stopped", reason: "budget_exhausted" },
      );

      expect(
        await (await a.s.call("GET", `/${a.agentId}`)).json(),
      ).toMatchObject({
        state: "paused",
        pausedBy: "budget",
        approvalRunId: null,
        budget: {
          limitMicroUsd: 5_000_000,
          usedMicroUsd: 4_000_000,
          heldMicroUsd: 0,
        },
      });
      const shown = await a.shown();
      expect(shown).toMatchObject({
        status: "stopped",
        stopReason: "budget_exhausted",
        openApprovals: 0,
        approvals: [],
      });
      expect(decisions(shown.verlauf)).toEqual([
        expect.objectContaining({ decision: "withdrawn" }),
      ]);
      expect(scheduled.at(-1)).toBe(
        `save ${a.agentId} {"rhythm":"daily","minute":360} Europe/Berlin paused`,
      );
      // Paused, it spends nothing more, however small, until the student resumes it.
      expect(await step(1)).toEqual({
        status: "refused",
        reason: "budget_exhausted",
      });
      expect((await a.s.call("POST", `/${a.agentId}/resume`)).status).toBe(200);
      expect(await step(1)).toMatchObject({ status: "ok" });
    });

    it("keeps the student's answer to an Approval decided while the Agent is being Paused", async () => {
      const a = await askedByRun(
        "run-approval-decided-while-paused",
        "createStudyBlocks",
      );
      // The student's approval holds the Action, as deciding does, while Pause comes in.
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const deciding = admin.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "action" WHERE "id" = ${a.asking.actionId} FOR UPDATE`;
        await tx.approval.update({
          where: { actionId: a.asking.actionId },
          data: { decision: "approved", decidedAt: new Date() },
        });
        locked();
        await held;
      });
      await lockTaken;
      const pausing = a.s.call("POST", `/${a.agentId}/pause`);
      await new Promise((resolve) => setTimeout(resolve, 300));
      release();
      await deciding;

      expect((await pausing).status).toBe(200);
      expect(
        await admin.action.findUniqueOrThrow({
          where: { id: a.asking.actionId },
          select: { status: true, refusal: true },
        }),
      ).toEqual({ status: "awaiting_approval", refusal: null });
      expect(decisions((await a.shown()).verlauf)).toEqual([
        expect.objectContaining({ decision: "approved" }),
      ]);
    });

    describe("the Run's Intervention in the Inbox", () => {
      /** A Run under way that asked for Approvals, as the Inbox shows its Interventions. */
      async function asking(name: string) {
        const a = await askedByRun(name, "createStudyBlocks", [], {
          status: "running",
        });
        const inbox = async () => {
          const response = await app.request(`${apiOrigin}/api/me/inbox`, {
            headers: { cookie: a.s.headers.cookie },
          });
          expect(response.status).toBe(200);
          return ((await response.json()) as { interventions: unknown[] })
            .interventions;
        };
        const end = () =>
          agentRuns.finish(
            { runId: a.runId, studentId: a.s.id },
            { status: "done" },
          );
        return { ...a, inbox, end };
      }

      it("raises one once the Run ends with Approvals open, naming its Agent and opening that Run", async () => {
        const a = await asking("run-intervention-raised");
        expect(await a.inbox()).toEqual([]);

        await a.end();
        await a.end();

        expect(await a.inbox()).toEqual([
          {
            id: expect.any(String),
            kind: "run_approvals",
            title: "Klausur Statistik",
            course: null,
            action: null,
            shortMinutes: null,
            run: {
              id: a.runId,
              agentId: a.agentId,
              openApprovals: 1,
            },
            raisedAt: expect.any(String),
            state: "open",
            closedAt: null,
          },
        ]);
      });

      it.each([
        [
          "decided",
          (a: Awaited<ReturnType<typeof asking>>) =>
            a.decide({ decision: "deny" }),
        ],
        [
          "expired",
          (a: Awaited<ReturnType<typeof asking>>) =>
            admin.approval.update({
              where: { actionId: a.asking.actionId },
              data: { expiresAt: new Date(Date.now() - 60_000) },
            }),
        ],
        [
          "withdrawn",
          (a: Awaited<ReturnType<typeof asking>>) =>
            a.s.call("POST", `/${a.agentId}/pause`),
        ],
      ])(
        "lapses once no Approval of the Run is open, the last one %s, with no timer",
        async (how, close) => {
          const a = await asking(`run-intervention-lapses-${how}`);
          await a.end();

          await close(a);

          expect(await a.inbox()).toEqual([
            expect.objectContaining({
              kind: "run_approvals",
              run: expect.objectContaining({ openApprovals: 0 }),
              state: "lapsed",
              closedAt: expect.any(String),
            }),
          ]);
        },
      );

      it("raises none for a Run that ends with nothing open", async () => {
        const a = await asking("run-intervention-none");
        await a.decide({ decision: "deny" });

        await a.end();

        expect(await a.inbox()).toEqual([]);
      });
    });
  });

  describe("as its Courses are Archived, deleted, Rejected or merged", () => {
    type Student = Awaited<ReturnType<typeof student>>;
    const onCourse = (
      s: Student,
      path: string,
      body?: unknown,
      method = "POST",
    ) =>
      app.request(`${apiOrigin}/api/me/courses/${path}`, {
        method,
        headers: s.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const archive = (s: Student, id: string) => onCourse(s, `${id}/archive`);
    const unarchive = (s: Student, id: string) =>
      onCourse(s, `${id}/unarchive`);
    const remove = (s: Student, id: string) =>
      onCourse(s, id, undefined, "DELETE");
    const reject = (s: Student, id: string) =>
      onCourse(s, `${id}/decision`, { decision: "reject" });
    const merge = (s: Student, id: string, into: string) =>
      onCourse(s, `${id}/merge`, { into });
    const agentOn = async (s: Student, courseIds: string[]) =>
      (
        (await (await s.call("POST", "", form(courseIds))).json()) as {
          id: string;
        }
      ).id;
    const shown = async (s: Student, id: string) =>
      (await (await s.call("GET", `/${id}`)).json()) as {
        state: string;
        pausedBy: string | null;
        courses: { id: string; archived: boolean }[];
      };
    const status = async (response: Response | Promise<Response>) =>
      (await response).status;

    it("keeps working for its other Courses when one is Archived, and pauses with reason course_archived, its Schedule too, once all are", async () => {
      const s = await student("agent-courses-archived");
      const statistics = await course(s.id, "Statistics II");
      const micro = await course(s.id, "Microeconomics");
      const id = await agentOn(s, [statistics, micro]);

      expect(await status(archive(s, statistics))).toBe(200);
      expect(await shown(s, id)).toMatchObject({
        state: "active",
        pausedBy: null,
        courses: [
          { id: micro, archived: false },
          { id: statistics, archived: true },
        ],
      });

      expect(await status(archive(s, micro))).toBe(200);
      expect(await shown(s, id)).toMatchObject({
        state: "paused",
        pausedBy: "course_archived",
        courses: [
          { id: micro, archived: true },
          { id: statistics, archived: true },
        ],
      });
      expect(scheduled.at(-1)).toBe(
        `save ${id} {"rhythm":"daily","minute":360} Europe/Berlin paused`,
      );
      expect(
        (await (await s.call("GET", "")).json()) as object[],
      ).toMatchObject([{ id, badge: "paused", pausedBy: "course_archived" }]);
    });

    it("stays Paused as a Course is unarchived: only the student resumes it, once one of its Courses is unarchived", async () => {
      const s = await student("agent-courses-unarchived");
      const statistics = await course(s.id, "Statistics II");
      const id = await agentOn(s, [statistics]);
      await archive(s, statistics);

      const refused = await s.call("POST", `/${id}/resume`);
      expect([refused.status, await refused.json()]).toEqual([
        409,
        { error: "course_archived" },
      ]);
      expect(await status(unarchive(s, statistics))).toBe(200);
      // For no reason that holds any longer.
      expect(await shown(s, id)).toMatchObject({
        state: "paused",
        pausedBy: null,
      });
      expect(await status(s.call("POST", `/${id}/resume`))).toBe(200);
      expect(await shown(s, id)).toMatchObject({
        state: "active",
        pausedBy: null,
      });
      expect(scheduled.at(-1)).toBe(
        `save ${id} {"rhythm":"daily","minute":360} Europe/Berlin`,
      );
    });

    it("drops a deleted Course, and pauses with reason no_course once it has none left, until the student gives it one and resumes it", async () => {
      const s = await student("agent-courses-deleted");
      const statistics = await course(s.id, "Statistics II");
      const micro = await course(s.id, "Microeconomics");
      const id = await agentOn(s, [statistics, micro]);

      expect(await status(remove(s, statistics))).toBe(200);
      expect(await shown(s, id)).toMatchObject({
        state: "active",
        courses: [{ id: micro }],
      });

      expect(await status(remove(s, micro))).toBe(200);
      expect(await shown(s, id)).toMatchObject({
        state: "paused",
        pausedBy: "no_course",
        courses: [],
      });
      expect(scheduled.at(-1)).toBe(
        `save ${id} {"rhythm":"daily","minute":360} Europe/Berlin paused`,
      );
      const refused = await s.call("POST", `/${id}/resume`);
      expect([refused.status, await refused.json()]).toEqual([
        409,
        { error: "no_course" },
      ]);
      const finance = await course(s.id, "Finance");
      expect(await status(s.call("PUT", `/${id}`, form([finance])))).toBe(200);
      // Paused still, for no reason that holds: the student resumes it.
      expect(await shown(s, id)).toMatchObject({
        state: "paused",
        pausedBy: null,
      });
      expect(await status(s.call("POST", `/${id}/resume`))).toBe(200);
    });

    it("drops a Rejected Course, and pauses with reason no_course once it has none left", async () => {
      const s = await student("agent-courses-rejected");
      const statistics = await course(s.id, "Statistics II");
      const micro = await course(s.id, "Microeconomics");
      const kept = await agentOn(s, [statistics, micro]);
      const alone = await agentOn(s, [statistics]);

      expect(await status(reject(s, statistics))).toBe(200);

      expect(await shown(s, kept)).toMatchObject({
        state: "active",
        courses: [{ id: micro }],
      });
      expect(await shown(s, alone)).toMatchObject({
        state: "paused",
        pausedBy: "no_course",
        courses: [],
      });
      expect(scheduled.at(-1)).toBe(
        `save ${alone} {"rhythm":"daily","minute":360} Europe/Berlin paused`,
      );
      // Restored, it is a proposal again, and joins no Agent on its own.
      expect(
        await status(
          onCourse(s, `${statistics}/decision`, { decision: "restore" }),
        ),
      ).toBe(200);
      expect(await shown(s, alone)).toMatchObject({ courses: [] });
    });

    it("moves the Agent's entry for a merged Course to the Course it went into, pausing it if that one is Archived", async () => {
      const s = await student("agent-courses-merged");
      const statistics = await course(s.id, "Statistics II");
      const duplicate = await course(s.id, "Statistik II");
      const archived = await course(s.id, "Statistik (alt)");
      const micro = await course(s.id, "Microeconomics");
      const both = await agentOn(s, [statistics, duplicate]);
      const one = await agentOn(s, [micro]);
      await archive(s, archived);

      expect(await status(merge(s, duplicate, statistics))).toBe(200);
      expect(await shown(s, both)).toMatchObject({
        state: "active",
        courses: [{ id: statistics, archived: false }],
      });

      expect(await status(merge(s, micro, archived))).toBe(200);
      expect(await shown(s, one)).toMatchObject({
        state: "paused",
        pausedBy: "course_archived",
        courses: [{ id: archived, archived: true }],
      });
    });

    it.each([
      ["Rejected", "no_course"],
      ["merged", null],
    ] as const)(
      "keeps a %s Course so when its Agents cannot follow, and they follow on the next change to the Courses",
      async (change, pausedBy) => {
        const s = await student(
          `agent-courses-follow-fails-${change.toLowerCase()}`,
        );
        const statistics = await course(s.id, "Statistics II");
        const micro = await course(s.id, "Microeconomics");
        const id = await agentOn(s, [statistics]);
        const follow = agents.followCourses;
        agents.followCourses = async () => {
          throw new Error("Database unavailable");
        };
        const logged = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          const changed = await (change === "Rejected"
            ? reject(s, statistics)
            : merge(s, statistics, micro));
          expect(changed.status).toBe(200);
        } finally {
          agents.followCourses = follow;
          logged.mockRestore();
        }
        expect(await shown(s, id)).toMatchObject({
          state: "active",
          courses: [{ id: statistics }],
        });

        expect(await status(remove(s, await course(s.id, "Finance")))).toBe(
          200,
        );

        expect(await shown(s, id)).toMatchObject(
          pausedBy
            ? { state: "paused", pausedBy, courses: [] }
            : { state: "active", courses: [{ id: micro }] },
        );
      },
    );

    it("pauses with reason course_archived once its form is saved with only Archived Courses", async () => {
      const s = await student("agent-courses-saved-archived");
      const statistics = await course(s.id, "Statistics II");
      const micro = await course(s.id, "Microeconomics");
      const id = await agentOn(s, [statistics, micro]);
      await archive(s, statistics);

      expect(await status(s.call("PUT", `/${id}`, form([statistics])))).toBe(
        200,
      );

      expect(await shown(s, id)).toMatchObject({
        state: "paused",
        pausedBy: "course_archived",
        courses: [{ id: statistics, archived: true }],
      });
      expect(scheduled.at(-1)).toBe(
        `save ${id} {"rhythm":"daily","minute":360} Europe/Berlin paused`,
      );
    });
  });

  it("lists the capability set the drawer offers, with each Capability's modes and default", async () => {
    const s = await student("agent-capabilities-set");

    const listed = await s.call("GET", "/capabilities");

    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual([
      {
        id: "createStudyBlocks",
        section: "Lernblöcke",
        title: "Lernblöcke erstellen",
        description: "Neue Lernzeit in freie Zeitfenster eintragen.",
        modes: ["automatic", "always", "ask"],
      },
      {
        id: "moveOwnStudyBlocks",
        section: "Lernblöcke",
        title: "Eigene Lernblöcke verschieben",
        description: "Nur Blöcke, die dieser Agent erstellt hat.",
        modes: ["automatic", "always", "ask"],
      },
      {
        id: "moveStudyBlocks",
        section: "Lernblöcke",
        title: "Lernblöcke verschieben",
        description: "Auch Blöcke, die du oder andere geplant haben.",
        modes: ["ask"],
      },
      {
        id: "removeOwnStudyBlocks",
        section: "Lernblöcke",
        title: "Eigene Lernblöcke entfernen",
        description: "Nur Blöcke, die dieser Agent erstellt hat.",
        modes: ["automatic", "always", "ask"],
      },
      // Grantable like Lernblöcke erstellen, but asking until the student says otherwise (#154).
      {
        id: "createTasks",
        section: "Aufgaben",
        title: "Aufgaben erstellen",
        description:
          "Neue Aufgaben in deinen Kursen anlegen, auch zu Prüfungen und Abgaben oder zur Vor- und Nachbereitung.",
        modes: ["ask", "automatic", "always"],
      },
      // No Action, so no mode: simply on or off (#143).
      {
        id: "createFlashcards",
        section: "Lernmaterial",
        title: "Karteikarten erstellen",
        description: "Karteikarten zu Themen deiner Kurse erstellen.",
        modes: [],
      },
      {
        id: "createPracticeSets",
        section: "Lernmaterial",
        title: "Übungsaufgaben erstellen",
        description: "Übungsaufgaben zu Themen deiner Kurse erstellen.",
        modes: [],
      },
      {
        id: "notifyStudent",
        section: "Benachrichtigungen",
        title: "Dich benachrichtigen",
        description:
          "Dir eine kurze Nachricht in deine Inbox schreiben, höchstens eine pro Lauf.",
        modes: [],
      },
      {
        id: "createBriefing",
        section: "Briefings",
        title: "Briefing erstellen",
        description:
          "Offene Hinweise, Freigaben, ungelesene Nachrichten und fertiges Lernmaterial zu einem Briefing in deiner Inbox zusammenfassen.",
        modes: [],
      },
    ]);
  });

  describe("its Notices in the Inbox (#155)", () => {
    /** A student whose Agent may notify them, with a Run under way that sent `text` as its Notice. */
    async function notified(name: string, text: string) {
      const s = await student(name);
      const statistics = await course(s.id, "Statistics II");
      const created = await s.call(
        "POST",
        "",
        form([statistics], [{ id: "notifyStudent", mode: null }]),
      );
      expect(created.status).toBe(201);
      const { id: agentId } = (await created.json()) as { id: string };
      const runId = await recordedRun(s.id, agentId, 1, { status: "running" });
      const sent = await withOwner(prisma, principal.fromRun(runId), (tx) =>
        sendNotice(
          tx,
          runId,
          {
            content: Uint8Array.from(Buffer.from(text)),
            contentKey: null,
            derivedFrom: [],
          },
          new Date(),
        ),
      );
      if (sent.status !== "sent") throw new Error(sent.reason);
      const inbox = async () => {
        const response = await app.request(`${apiOrigin}/api/me/inbox`, {
          headers: { cookie: s.headers.cookie },
        });
        expect(response.status).toBe(200);
        return ((await response.json()) as { notices: unknown[] }).notices;
      };
      const read = (noticeId: string, headers = s.headers) =>
        app.request(`${apiOrigin}/api/me/notices/${noticeId}/read`, {
          method: "POST",
          headers,
        });
      return { s, agentId, runId, noticeId: sent.noticeId, inbox, read };
    }

    it("shows a Notice as its Agent's message, unread until the student opens it", async () => {
      const n = await notified(
        "agent-notice-inbox",
        "Deine Klausur ist am 5. Februar. **Fang** an: <b>jetzt</b>",
      );

      expect(await n.inbox()).toEqual([
        {
          id: n.noticeId,
          agentId: n.agentId,
          agentName: "Klausur Statistik",
          runId: n.runId,
          text: "Deine Klausur ist am 5. Februar. **Fang** an: <b>jetzt</b>",
          sentAt: expect.any(String),
          readAt: null,
          announcement: "pending",
        },
      ]);

      expect((await n.read(n.noticeId)).status).toBe(200);
      const [opened] = (await n.inbox()) as {
        readAt: string;
        announcement: string;
      }[];
      expect(opened).toMatchObject({
        readAt: expect.any(String),
        announcement: "inbox_only",
      });
      // Opening it again keeps when it was first read.
      expect((await n.read(n.noticeId)).status).toBe(200);
      expect(await n.inbox()).toEqual([opened]);
    });

    it("does not let another student read or open a Notice", async () => {
      const n = await notified("agent-notice-owner", "Nur für dich.");
      const other = await student("agent-notice-other");

      expect((await n.read(n.noticeId, other.headers)).status).toBe(404);
      expect(
        await (
          await app.request(`${apiOrigin}/api/me/inbox`, {
            headers: { cookie: other.headers.cookie },
          })
        ).json(),
      ).toMatchObject({ notices: [] });
      expect(await n.inbox()).toMatchObject([{ readAt: null }]);
    });

    it("keeps a Notice once its Agent is Ended, and drops it with the Agent once deleted", async () => {
      const n = await notified("agent-notice-lifecycle", "Bis bald.");

      expect((await n.s.call("POST", `/${n.agentId}/end`)).status).toBe(200);
      expect(await n.inbox()).toMatchObject([{ text: "Bis bald." }]);

      expect((await n.s.call("DELETE", `/${n.agentId}`)).status).toBe(200);
      expect(await n.inbox()).toEqual([]);
    });

    it("shows the Notice sent in its Run's Verlauf, without its text", async () => {
      const n = await notified("agent-notice-verlauf", "Geheim.");
      await admin.runEvent.create({
        data: {
          runId: n.runId,
          studentId: n.s.id,
          key: "notice:1:1",
          type: "notice",
          detail: {
            step: 1,
            call: 1,
            capability: "notifyStudent",
            noticeId: n.noticeId,
            outcome: "sent",
            refusal: null,
          },
        },
      });

      const shown = await n.s.call("GET", `/${n.agentId}/runs/${n.runId}`);

      expect(shown.status).toBe(200);
      const { verlauf } = (await shown.json()) as { verlauf: unknown[] };
      expect(verlauf).toContainEqual({
        type: "notice",
        at: expect.any(String),
        step: 1,
        capability: "notifyStudent",
        outcome: "sent",
        refusal: null,
      });
      expect(JSON.stringify(verlauf)).not.toContain("Geheim");
    });
  });

  describe("its Briefings in the Inbox (#188)", () => {
    it("shows an Agent's Briefing with live Approvals, Notices, and Artifacts, and keeps past nunio Briefings readable", async () => {
      const asked = await askedForApproval("agent-briefing-inbox");
      const sid = await studentId(asked.cookie);
      const statsCourse = await course(sid, "Statistics II");
      const created = await app.request(`${apiOrigin}/api/me/agents`, {
        method: "POST",
        headers: asked.headers,
        body: JSON.stringify(
          form(
            [statsCourse],
            [
              { id: "createBriefing", mode: null },
              { id: "notifyStudent", mode: null },
            ],
          ),
        ),
      });
      expect(created.status).toBe(201);
      const { id: agentId } = (await created.json()) as { id: string };
      const runId = await recordedRun(sid, agentId, 1, { status: "running" });

      // An unread Notice and a ready Artifact, plus the open Approval from askedForApproval.
      const notice = await withOwner(prisma, principal.fromRun(runId), (tx) =>
        sendNotice(
          tx,
          runId,
          {
            content: Uint8Array.from(Buffer.from("Kurze Erinnerung.")),
            contentKey: null,
            derivedFrom: [],
          },
          new Date(),
        ),
      );
      if (notice.status !== "sent") throw new Error(notice.reason);

      const artifactId = randomUUID();
      const artifactRunId = randomUUID();
      await admin.run.create({
        data: {
          id: artifactRunId,
          studentId: sid,
          status: "done",
          startedAt: new Date(),
          endedAt: new Date(),
        },
      });
      await admin.artifact.create({
        data: {
          id: artifactId,
          studentId: sid,
          runId: artifactRunId,
          kind: "flashcards",
          status: "ready",
          request: {},
        },
      });
      await admin.artifactVersion.create({
        data: {
          artifactId,
          studentId: sid,
          version: 1,
          content: Uint8Array.from(
            Buffer.from(
              JSON.stringify({
                title: "Stochastik Karten",
                items: [
                  {
                    id: "c1",
                    topicIds: [],
                    front: "F",
                    back: "B",
                    citations: [],
                  },
                ],
              }),
            ),
          ),
          derivedFrom: [],
        },
      });

      // Past nunio Briefing stays readable alongside the Agent's Briefing.
      await admin.briefing.create({
        data: {
          id: randomUUID(),
          studentId: sid,
          localDate: "2025-01-01",
          createdAt: new Date("2025-01-01T07:00:00Z"),
          items: { interventions: [], approvals: [], agents: [] },
        },
      });

      const written = await withOwner(prisma, principal.fromRun(runId), (tx) =>
        sendBriefing(
          tx,
          runId,
          {
            text: {
              content: Uint8Array.from(
                Buffer.from("Morgenbriefing: Alles offen."),
              ),
              contentKey: null,
              derivedFrom: [],
            },
            items: {
              interventions: [],
              approvals: [asked.asking.actionId],
              notices: [notice.noticeId],
              artifacts: [artifactId],
            },
          },
          new Date(),
        ),
      );
      expect(written.status).toBe("written");
      if (written.status !== "written") throw new Error("unreachable");

      const loadInbox = async () => {
        const response = await app.request(`${apiOrigin}/api/me/inbox`, {
          headers: { cookie: asked.cookie },
        });
        expect(response.status).toBe(200);
        return (await response.json()) as {
          notices: { id: string; readAt: string | null }[];
          briefings: {
            id: string;
            agentId: string | null;
            agentName: string | null;
            runId: string | null;
            text: string | null;
            announcement: string;
            approvals: {
              actionId: string;
              fingerprint: string | null;
              expiresAt: string | null;
              state: string;
            }[];
            notices: string[];
            artifacts: {
              id: string;
              kind: string | null;
              title: string | null;
              state: string;
            }[];
          }[];
        };
      };

      const first = await loadInbox();
      expect(first.briefings).toHaveLength(2);
      const [agentBriefing, legacyBriefing] = first.briefings;
      expect(agentBriefing).toMatchObject({
        id: written.briefingId,
        agentId,
        agentName: "Klausur Statistik",
        runId,
        text: "Morgenbriefing: Alles offen.",
        announcement: "pending",
        notices: [notice.noticeId],
        artifacts: [
          expect.objectContaining({
            id: artifactId,
            kind: "flashcards",
            title: "Stochastik Karten",
            state: "ready",
          }),
        ],
      });
      expect(agentBriefing!.approvals).toEqual([
        expect.objectContaining({
          actionId: asked.asking.actionId,
          fingerprint: expect.any(String),
          expiresAt: expect.any(String),
          state: "waiting",
        }),
      ]);
      // Bundling a Notice never marks it read.
      expect(
        first.notices.find((n) => n.id === notice.noticeId)?.readAt,
      ).toBeNull();
      // Legacy nunio Briefing stays readable.
      expect(legacyBriefing).toMatchObject({
        agentId: null,
        agentName: null,
        runId: null,
        text: null,
        notices: [],
        artifacts: [],
      });

      // Deciding the Approval via the real endpoint updates live status in the Briefing.
      const decided = await app.request(
        `${apiOrigin}/api/me/approvals/${asked.asking.actionId}`,
        {
          method: "POST",
          headers: asked.headers,
          body: JSON.stringify({ decision: "deny" }),
        },
      );
      expect(decided.status).toBe(200);
      await admin.artifact.update({
        where: { id: artifactId },
        data: { openedAt: new Date() },
      });

      const after = await loadInbox();
      expect(after.briefings[0]!.approvals[0]).toMatchObject({
        actionId: asked.asking.actionId,
        fingerprint: null,
        state: "denied",
      });
      expect(after.briefings[0]!.artifacts[0]).toMatchObject({
        id: artifactId,
        state: "opened",
      });
    });

    it("shows inbox read and Briefing written in the Run's Verlauf without leaking text", async () => {
      const s = await student("agent-briefing-verlauf");
      const statsCourse = await course(s.id, "Statistics II");
      const created = await s.call(
        "POST",
        "",
        form([statsCourse], [{ id: "createBriefing", mode: null }]),
      );
      expect(created.status).toBe(201);
      const { id: agentId } = (await created.json()) as { id: string };
      const runId = await recordedRun(s.id, agentId, 1, { status: "running" });
      await admin.runEvent.createMany({
        data: [
          {
            runId,
            studentId: s.id,
            key: "read:1",
            type: "read",
            detail: {
              step: 1,
              plan: false,
              approvals: false,
              inbox: true,
              courseIds: [],
              sourceIds: [],
            },
          },
          {
            runId,
            studentId: s.id,
            key: "briefing:1:1",
            type: "briefing",
            detail: {
              step: 1,
              call: 1,
              capability: "createBriefing",
              briefingId: randomUUID(),
              outcome: "written",
              refusal: null,
            },
          },
        ],
      });

      const shown = await s.call("GET", `/${agentId}/runs/${runId}`);
      expect(shown.status).toBe(200);
      const { verlauf } = (await shown.json()) as { verlauf: unknown[] };
      expect(verlauf).toContainEqual({
        type: "read",
        at: expect.any(String),
        step: 1,
        plan: false,
        approvals: false,
        inbox: true,
        courses: [],
        sources: [],
      });
      expect(verlauf).toContainEqual({
        type: "briefing",
        at: expect.any(String),
        step: 1,
        capability: "createBriefing",
        outcome: "written",
        refusal: null,
      });
    });
  });
});

describe("outreach settings after retiring nunio's own Briefing (#189)", () => {
  it("returns and updates Outreach settings without Briefing fields", async () => {
    const cookie = await signUp("outreach-settings-no-briefing");

    const initial = await app.request(`${apiOrigin}/api/me/outreach-settings`, {
      headers: { cookie },
    });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({
      email: true,
      quietHours: null,
      dailyLimit: 3,
    });

    const updated = await app.request(`${apiOrigin}/api/me/outreach-settings`, {
      method: "PATCH",
      headers: {
        cookie,
        origin: appOrigin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: false,
        quietHours: { fromMinute: 1320, toMinute: 420 },
        dailyLimit: 5,
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      email: false,
      quietHours: { fromMinute: 1320, toMinute: 420 },
      dailyLimit: 5,
    });
  });

  it("no longer serves the Briefing one-click unsubscribe route", async () => {
    const response = await app.request(
      `${apiOrigin}/unsubscribe/briefing-email?s=any&t=${"0".repeat(64)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      },
    );

    expect(response.status).toBe(404);
  });
});

describe("a Briefing's Approvals", () => {
  it("shows each bundled Approval as it stands now, not as it stood then", async () => {
    const asked = await askedForApproval("briefing-approval-state");
    const id = await studentId(asked.cookie);
    await admin.briefing.create({
      data: {
        id: randomUUID(),
        studentId: id,
        localDate: "2099-01-01",
        items: {
          interventions: [],
          approvals: [asked.asking.actionId],
          agents: [],
        },
      },
    });
    const stateNow = async () => {
      const inbox = (await (
        await app.request(`${apiOrigin}/api/me/inbox`, {
          headers: { cookie: asked.cookie },
        })
      ).json()) as { briefings: { approvals: { state: string }[] }[] };
      return inbox.briefings[0]!.approvals[0]!.state;
    };

    expect(await stateNow()).toBe("waiting");
    await admin.approval.update({
      where: { actionId: asked.asking.actionId },
      data: { expiresAt: new Date("2000-01-01T00:00:00Z") },
    });
    expect(await stateNow()).toBe("expired");
    // An Agent's Approval expires lazily, so a late answer changes nothing (ADR-0006).
    const late = await app.request(
      `${apiOrigin}/api/me/approvals/${asked.asking.actionId}`,
      {
        method: "POST",
        headers: asked.headers,
        body: JSON.stringify({ decision: "deny" }),
      },
    );
    expect(late.status).toBe(409);
    expect(await stateNow()).toBe("expired");
  });
});

/** A student with Analysis I: a Topic "Klausur" and problem sheet 3, handed in on Moodle, from one ready Source. */
async function studyFixture(name: string) {
  const cookie = await signUp(name);
  const p = principal.fromSession({ studentId: await studentId(cookie) });
  const upload = await sources.upload(p, {
    title: "Skript.pdf",
    bytes: 100,
    type: "application/pdf",
  });
  if (upload.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, upload.source.id);
  const pages = [
    "MA-101 Analysis I",
    "Klausur: gleichmäßige Konvergenz.",
    "Blatt 3 zur Klausur, Abgabe über Moodle.",
  ];
  await sources.ingest(p, upload.source.id, {
    delegation,
    parse: async () => ({
      pages: pages.map((text, i) => ({ page: i + 1, text })),
    }),
    embedder: chatEmbedder,
    scans: {
      estimateMicroUsd: () => 1,
      read: async () => ({ text: "", usage: { microUsd: 1 } }),
    },
  });
  await facts.extract(p, upload.source.id, {
    delegation,
    extractor: {
      model: "test",
      windows: (all) => [[...all]],
      estimateMicroUsd: () => 1,
      extract: async () => ({
        usage: { microUsd: 1 },
        value: {
          courses: [
            {
              code: "MA-101",
              title: "Analysis I",
              page: 1,
              quote: "MA-101 Analysis I",
            },
          ],
          obligations: [
            {
              course: "MA-101",
              kind: "assignment",
              title: "Blatt 3 zur Klausur",
              key: "Blatt 3",
              destination: "Moodle",
              due: { date: "2026-11-20", time: null, timeZone: null, text: "" },
              page: 3,
              quote: "Blatt 3 zur Klausur, Abgabe über Moodle.",
              uncertainty: null,
            },
          ],
          facts: [
            {
              course: "MA-101",
              type: "topic",
              key: "Klausur",
              value: "Klausur",
              page: 2,
              quote: "Klausur",
              uncertainty: null,
            },
          ],
        },
      }),
    },
  });
  const course = (await facts.review(p)).courses[0]!;
  await facts.decideCourse(p, course.id, "accept");
  const headers = {
    cookie,
    origin: appOrigin,
    "content-type": "application/json",
  };
  const send = (path: string, body: unknown, origin = appOrigin) =>
    app.request(`${apiOrigin}${path}`, {
      method: "POST",
      headers: { ...headers, origin },
      body: JSON.stringify(body),
    });
  const get = (path: string) =>
    app.request(`${apiOrigin}${path}`, { headers: { cookie } });
  return {
    cookie,
    send,
    get,
    courseId: course.id,
    topicId: course.facts[0]!.id,
    sheetId: course.obligations[0]!.id,
    selection: { selection: { courseIds: [course.id], sourceIds: [] } },
  };
}

describe("study execution", () => {
  it("starts an Artifact's Run on request, and shows the Artifact ready on Home until it is opened", async () => {
    const s = await studyFixture("study-request");
    const body = {
      kind: "practice_set",
      topicIds: [s.topicId],
      from: s.selection,
    };

    expect((await s.send("/api/me/artifacts", body, evilOrigin)).status).toBe(
      403,
    );
    expect((await app.request(`${apiOrigin}/api/me/artifacts`)).status).toBe(
      401,
    );
    const requested = await s.send("/api/me/artifacts", body);
    expect(requested.status).toBe(202);
    const { artifactId, runId } = (await requested.json()) as {
      artifactId: string;
      runId: string;
    };
    expect(artifactRuns).toContain(runId);
    // As the worker's Activity would, once the Run starts.
    expect(await artifacts.make(runId)).toBe("ready");

    const home = async () =>
      ((await (await s.get("/api/me/home")).json()) as { artifacts: unknown[] })
        .artifacts;
    expect(await home()).toEqual([
      expect.objectContaining({ id: artifactId, kind: "practice_set" }),
    ]);
    const ready = await s.get("/api/me/artifacts?ready=true");
    expect(await ready.json()).toEqual([
      expect.objectContaining({ id: artifactId, status: "ready" }),
    ]);
    const opened = await s.get(`/api/me/artifacts/${artifactId}`);
    expect([opened.status, await opened.json()]).toEqual([
      200,
      expect.objectContaining({
        id: artifactId,
        content: {
          title: "Klausurthemen",
          items: [
            expect.objectContaining({
              question: "Was kommt in der Klausur dran? [S1]",
              citations: [
                {
                  tag: "S1",
                  provenance: expect.objectContaining({ kind: "source" }),
                },
              ],
            }),
          ],
        },
      }),
    ]);
    expect(await home()).toEqual([]);
    const other = await studyFixture("study-request-other");
    expect((await other.get(`/api/me/artifacts/${artifactId}`)).status).toBe(
      404,
    );
  });

  it("refuses to draft with 409 and the reason until the student answers the AI-use Rule, and 404 for another student's Obligation", async () => {
    const s = await studyFixture("study-ai-use");
    const draft = {
      kind: "draft",
      obligationId: s.sheetId,
      instructions: "Nur Aufgabe 1.",
      from: s.selection,
    };
    const runs = artifactRuns.length;

    const refused = await s.send("/api/me/artifacts", draft);
    expect([refused.status, await refused.json()]).toEqual([
      409,
      { error: "ai_use_unknown" },
    ]);
    expect(artifactRuns).toHaveLength(runs);
    expect(
      (
        await s.send(`/api/me/obligations/${s.sheetId}/ai-use`, {
          level: "course",
          value: "allowed",
        })
      ).status,
    ).toBe(200);
    expect((await s.send("/api/me/artifacts", draft)).status).toBe(202);
    const other = await studyFixture("study-ai-use-other");
    expect((await other.send("/api/me/artifacts", draft)).status).toBe(404);
  });

  it("saves a student's edit of flashcards as a new version, and downloads them for Anki", async () => {
    const s = await studyFixture("study-anki");
    const requested = await s.send("/api/me/artifacts", {
      kind: "flashcards",
      topicIds: [s.topicId],
      from: s.selection,
    });
    const { artifactId, runId } = (await requested.json()) as {
      artifactId: string;
      runId: string;
    };
    await artifacts.make(runId);
    const edit = {
      baseVersion: 1,
      content: { cards: [{ id: "1", front: "Klausur", back: "Kürzer." }] },
    };

    const edited = await s.send(
      `/api/me/artifacts/${artifactId}/versions`,
      edit,
    );
    expect([edited.status, await edited.json()]).toEqual([201, { version: 2 }]);
    const stale = await s.send(
      `/api/me/artifacts/${artifactId}/versions`,
      edit,
    );
    expect([stale.status, await stale.json()]).toEqual([
      409,
      { error: "stale" },
    ]);
    const download = await s.get(`/api/me/artifacts/${artifactId}/anki.tsv`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe(
      "text/tab-separated-values; charset=utf-8",
    );
    expect(download.headers.get("content-disposition")).toMatch(
      /^attachment; filename="nunio-flashcards-\d{4}-\d{2}-\d{2}\.tsv"$/,
    );
    expect((await download.text()).split("\n").slice(6, 7)).toEqual([
      `Klausur\tKürzer.\tKlausur\tnunio-${artifactId}-1`,
    ]);
    const other = await studyFixture("study-anki-other");
    expect(
      (await other.get(`/api/me/artifacts/${artifactId}/anki.tsv`)).status,
    ).toBe(404);
  });

  it("lists an Artifact as shaky while the student calls one of its Topics weak or shaky, never for Attempts alone, with when they last practised it", async () => {
    const s = await studyFixture("study-list");
    const requested = await s.send("/api/me/artifacts", {
      kind: "practice_set",
      topicIds: [s.topicId],
      from: s.selection,
    });
    const { artifactId, runId } = (await requested.json()) as {
      artifactId: string;
      runId: string;
    };
    await artifacts.make(runId);
    const listed = async () => (await s.get("/api/me/artifacts")).json();

    expect(await listed()).toEqual([
      expect.objectContaining({
        id: artifactId,
        title: "Klausurthemen",
        courseId: s.courseId,
        count: 1,
        version: 1,
        updatedAt: expect.any(String),
        lastPractisedAt: null,
        shaky: false,
      }),
    ]);
    await s.send(`/api/me/artifacts/${artifactId}/attempts`, {
      answers: [{ itemId: "1", text: "Konvergenz." }],
    });

    expect(await listed()).toEqual([
      expect.objectContaining({
        id: artifactId,
        lastPractisedAt: expect.any(String),
        shaky: false,
      }),
    ]);
    const shakyAfter = async (level: string) => {
      await s.send(`/api/me/topics/${s.topicId}/self-assessment`, { level });
      return ((await listed()) as { shaky: boolean }[])[0]?.shaky;
    };
    expect(await shakyAfter("weak")).toBe(true);
    expect(await shakyAfter("solid")).toBe(false);
    expect(await shakyAfter("not_studied")).toBe(false);
    expect(await shakyAfter("shaky")).toBe(true);

    await s.send(`/api/me/review/fact/${s.topicId}/reject`, {});
    expect(await listed()).toEqual([
      expect.objectContaining({ id: artifactId, shaky: false }),
    ]);
  });

  it("offers a Course's Topics with their Levels, and the Obligations nunio may write for, soonest first with their AI-use Rule", async () => {
    const s = await studyFixture("study-options");
    const enter = async (kind: string, title: string, date: string) => {
      const entered = await s.send("/api/me/obligations", {
        course: { id: s.courseId },
        kind,
        title,
        due: { date, time: null, timeZone: null },
        destination: null,
      });
      return ((await entered.json()) as { id: string }).id;
    };
    await enter("exam", "Klausur", "2026-11-05");
    const paper = await enter("thesis", "Seminararbeit", "2026-11-10");
    const handedIn = await enter("assignment", "Blatt 2", "2026-11-01");
    await s.send(`/api/me/obligations/${handedIn}/reported-submitted`, {
      reported: true,
    });
    await s.send(`/api/me/obligations/${paper}/ai-use`, {
      level: "obligation",
      value: "forbidden",
    });

    const options = await s.get(
      `/api/me/courses/${s.courseId}/artifact-options`,
    );

    expect([options.status, await options.json()]).toEqual([
      200,
      {
        topics: [{ id: s.topicId, title: "Klausur", level: "not_studied" }],
        obligations: [
          {
            id: paper,
            title: "Seminararbeit",
            kind: "thesis",
            due: expect.objectContaining({ date: "2026-11-10" }),
            aiUse: expect.objectContaining({ status: "forbidden" }),
          },
          {
            id: s.sheetId,
            title: "Blatt 3 zur Klausur",
            kind: "assignment",
            due: expect.objectContaining({ date: "2026-11-20" }),
            aiUse: expect.objectContaining({ status: "unknown" }),
          },
        ],
      },
    ]);
    const other = await studyFixture("study-options-other");
    expect(
      (await other.get(`/api/me/courses/${s.courseId}/artifact-options`))
        .status,
    ).toBe(404);
  });

  it("grades the student's Attempts, sets each Topic's Level by Self-assessment with the latest Attempt beside it, and shows its Evidence", async () => {
    const s = await studyFixture("study-practice");
    const requested = await s.send("/api/me/artifacts", {
      kind: "practice_set",
      topicIds: [s.topicId],
      from: s.selection,
    });
    const { artifactId, runId } = (await requested.json()) as {
      artifactId: string;
      runId: string;
    };
    await artifacts.make(runId);
    const levels = async () =>
      (await s.get(`/api/me/courses/${s.courseId}/levels`)).json();

    expect(
      await (await s.get(`/api/me/artifacts/${artifactId}/attempts`)).json(),
    ).toEqual([]);
    const attempted = await s.send(`/api/me/artifacts/${artifactId}/attempts`, {
      answers: [{ itemId: "1", text: "Konvergenz." }],
    });
    const answered = [
      expect.objectContaining({
        itemId: "1",
        text: "Konvergenz.",
        verdict: "correct",
        feedback: expect.objectContaining({ text: "Richtig [S1]." }),
        ungradedReason: null,
      }),
    ];
    expect([attempted.status, await attempted.json()]).toEqual([201, answered]);
    expect(
      await (await s.get(`/api/me/artifacts/${artifactId}/attempts`)).json(),
    ).toEqual(answered);
    expect(await levels()).toEqual([
      {
        topicId: s.topicId,
        level: "not_studied",
        latestAttempt: { verdict: "correct", at: expect.any(String) },
        lastEvidenceAt: expect.any(String),
      },
    ]);
    expect(
      (
        await s.send(`/api/me/topics/${s.topicId}/self-assessment`, {
          level: "weak",
        })
      ).status,
    ).toBe(200);
    expect(await levels()).toEqual([
      expect.objectContaining({
        level: "weak",
        latestAttempt: expect.objectContaining({ verdict: "correct" }),
      }),
    ]);
    expect(
      (
        await s.send(`/api/me/topics/${s.topicId}/self-assessment`, {
          level: "maybe",
        })
      ).status,
    ).toBe(400);
    expect(
      await (await s.get(`/api/me/topics/${s.topicId}/evidence`)).json(),
    ).toEqual([
      expect.objectContaining({ kind: "self_assessment", level: "weak" }),
      expect.objectContaining({ kind: "attempt" }),
    ]);

    const other = await studyFixture("study-practice-other");
    expect(
      (
        await other.send(`/api/me/artifacts/${artifactId}/attempts`, {
          answers: [{ itemId: "1", text: "Fremd." }],
        })
      ).status,
    ).toBe(404);
    expect(
      (await other.get(`/api/me/artifacts/${artifactId}/attempts`)).status,
    ).toBe(404);
    expect(
      (
        await other.send(`/api/me/topics/${s.topicId}/self-assessment`, {
          level: "solid",
        })
      ).status,
    ).toBe(404);
  });

  it("prepares a Handoff with the Destination, the AI-use Rule and the student's drafts, and shows it reported", async () => {
    const s = await studyFixture("study-handoff");
    await s.send(`/api/me/obligations/${s.sheetId}/ai-use`, {
      level: "obligation",
      value: "conditional",
    });
    const requested = await s.send("/api/me/artifacts", {
      kind: "draft",
      obligationId: s.sheetId,
      instructions: "Aufgabe 1.",
      conditionsConfirmed: true,
      from: s.selection,
    });
    const { artifactId, runId } = (await requested.json()) as {
      artifactId: string;
      runId: string;
    };
    await artifacts.make(runId);
    await s.send(`/api/me/obligations/${s.sheetId}/reported-submitted`, {
      reported: true,
    });

    const handoff = await s.get(`/api/me/obligations/${s.sheetId}/handoff`);

    expect([handoff.status, await handoff.json()]).toEqual([
      200,
      {
        obligation: expect.objectContaining({
          id: s.sheetId,
          title: "Blatt 3 zur Klausur",
          destination: "Moodle",
          reportedSubmittedAt: expect.any(String),
        }),
        rule: expect.objectContaining({
          status: "conditional",
          level: "obligation",
        }),
        drafts: [expect.objectContaining({ id: artifactId, version: 1 })],
      },
    ]);
    const other = await studyFixture("study-handoff-other");
    expect(
      (await other.get(`/api/me/obligations/${s.sheetId}/handoff`)).status,
    ).toBe(404);
  });
});

describe("the course page", () => {
  const extraction = (value: Partial<Extracted>): Extracted => ({
    courses: [
      { code: "OM-1", title: "Operations Management", page: 1, quote: "OM-1" },
    ],
    obligations: [],
    facts: [],
    ...value,
  });
  /** Reads a Source into the student's Courses as nunio would, bound to a Course when one is given. */
  async function read(
    p: Principal,
    title: string,
    bytes: number,
    extracted: Extracted,
    course?: { id: string },
  ) {
    const upload = await sources.upload(p, {
      title,
      bytes,
      type: "application/pdf",
      course,
    });
    if (upload.status !== "ok") throw new Error("upload refused");
    await sources.complete(p, upload.source.id);
    await sources.ingest(p, upload.source.id, {
      delegation,
      // Each page carries the quotes cited on it, so extraction keeps them.
      parse: async () => ({
        pages: Array.from({ length: 9 }, (_, i) => ({
          page: i + 1,
          text: [
            `Seite ${i + 1}`,
            ...[
              ...extracted.courses,
              ...extracted.obligations,
              ...extracted.facts,
            ]
              .filter((item) => item.page === i + 1)
              .map((item) => item.quote),
          ].join("\n"),
        })),
      }),
      embedder: chatEmbedder,
      scans: {
        estimateMicroUsd: () => 1,
        read: async () => ({ text: "", usage: { microUsd: 1 } }),
      },
    });
    await facts.extract(p, upload.source.id, {
      delegation,
      extractor: {
        model: "test",
        windows: (all) => [[...all]],
        estimateMicroUsd: () => 1,
        extract: async () => ({ usage: { microUsd: 1 }, value: extracted }),
      },
    });
    return upload.source.id;
  }
  async function coursePage(
    name: string,
    lectureFacts: Extracted["facts"] = [],
  ) {
    const cookie = await signUp(name);
    const p = principal.fromSession({ studentId: await studentId(cookie) });
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`${apiOrigin}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const lecture = await read(
      p,
      "Vorlesung 04.pdf",
      12_582_912,
      extraction({ facts: lectureFacts }),
    );
    const course = (await facts.review(p)).courses[0]!;
    await facts.decideCourse(p, course.id, "accept");
    return {
      p,
      call,
      courseId: course.id,
      lecture,
      page: () => call("GET", `/api/me/courses/${course.id}`),
    };
  }

  it("shows a Course with its Sources, those nunio matched to it and those bound to it, by size and upload date", async () => {
    const s = await coursePage("course-page-sources");
    const notes = await read(
      s.p,
      "Einführung Operations Management.pdf",
      2_097_152,
      extraction({ courses: [] }),
      { id: s.courseId },
    );
    const gone = await read(s.p, "Alt.pdf", 10, extraction({}));
    await sources.remove(s.p, gone);
    await read(
      s.p,
      "Statistik.pdf",
      10,
      extraction({
        courses: [
          { code: "ST-2", title: "Statistics II", page: 1, quote: "ST-2" },
        ],
      }),
    );

    const page = await s.page();

    expect(page.status).toBe(200);
    expect(await page.json()).toEqual(
      expect.objectContaining({
        course: expect.objectContaining({
          id: s.courseId,
          code: "OM-1",
          title: "Operations Management",
          status: "accepted",
          archived: false,
          color: expect.any(String),
          semester: expect.stringMatching(/^\d{4}-(ws|ss)$/),
        }),
        sources: [
          {
            id: s.lecture,
            title: "Vorlesung 04.pdf",
            bytes: 12_582_912,
            createdAt: expect.any(String),
          },
          {
            id: notes,
            title: "Einführung Operations Management.pdf",
            bytes: 2_097_152,
            createdAt: expect.any(String),
          },
        ],
      }),
    );
  });

  it("lists the Course's Topics in the order first found, each with the student's Level and the pages of its Sources, without deleted ones", async () => {
    const topic = (value: string, page: number) => ({
      course: "OM-1",
      type: "topic" as const,
      key: value,
      value,
      page,
      quote: value,
      uncertainty: null,
    });
    const s = await coursePage("course-page-topics", [
      topic("Hashing", 3),
      topic("Graphen", 5),
      topic("Sortieralgorithmen", 7),
    ]);
    const notes = await read(
      s.p,
      "Notizen.pdf",
      10,
      extraction({
        facts: [topic("Dynamische Programmierung", 1), topic("Hashing", 2)],
      }),
      { id: s.courseId },
    );
    const id = async (title: string) =>
      (await facts.review(s.p)).courses[0]!.facts.find(
        (f) => f.value === title,
      )!.id;
    await s.call(
      "POST",
      `/api/me/topics/${await id("Hashing")}/self-assessment`,
      {
        level: "weak",
      },
    );
    await s.call(
      "POST",
      `/api/me/review/fact/${await id("Graphen")}/reject`,
      {},
    );

    const { topics } = (await (await s.page()).json()) as { topics: unknown };

    expect(topics).toEqual([
      {
        id: await id("Hashing"),
        title: "Hashing",
        level: "weak",
        lastEvidenceAt: expect.any(String),
        sources: [
          { id: s.lecture, title: "Vorlesung 04.pdf", pages: [3] },
          { id: notes, title: "Notizen.pdf", pages: [2] },
        ],
      },
      {
        id: await id("Sortieralgorithmen"),
        title: "Sortieralgorithmen",
        level: "not_studied",
        lastEvidenceAt: null,
        sources: [{ id: s.lecture, title: "Vorlesung 04.pdf", pages: [7] }],
      },
      {
        id: await id("Dynamische Programmierung"),
        title: "Dynamische Programmierung",
        level: "not_studied",
        lastEvidenceAt: null,
        sources: [{ id: notes, title: "Notizen.pdf", pages: [1] }],
      },
    ]);
  });

  it("lists every dated item of the Course, soonest first: its Obligations, the Study Blocks for its work and its Course Events", async () => {
    const at = (days: number, hour: number) =>
      new Date(
        Date.UTC(
          new Date().getUTCFullYear(),
          new Date().getUTCMonth(),
          new Date().getUTCDate() + days,
          hour,
        ),
      );
    const date = (days: number) => at(days, 12).toISOString().slice(0, 10);
    const obligation = (
      kind: Extracted["obligations"][number]["kind"],
      title: string,
      due: { date: string | null; time: string | null },
      page: number,
    ) => ({
      course: "OM-1",
      kind,
      title,
      key: title,
      destination: null,
      due: { ...due, timeZone: due.time ? "Europe/Berlin" : null, text: "" },
      page,
      quote: title,
      uncertainty: null,
    });
    const cookie = await signUp("course-page-dated");
    const p = principal.fromSession({ studentId: await studentId(cookie) });
    await read(
      p,
      "Modulhandbuch.pdf",
      10,
      extraction({
        obligations: [
          obligation("exam", "Klausur", { date: date(10), time: null }, 1),
          obligation(
            "assignment",
            "Übungsblatt 3",
            { date: date(4), time: "12:00" },
            2,
          ),
          obligation(
            "assignment",
            "Übungsblatt 1",
            { date: date(-3), time: null },
            3,
          ),
          obligation(
            "presentation",
            "Referat",
            { date: date(5), time: null },
            4,
          ),
          obligation(
            "registration",
            "Anmeldung",
            { date: null, time: null },
            5,
          ),
        ],
      }),
    );
    const review = (await facts.review(p)).courses[0]!;
    await facts.decideCourse(p, review.id, "accept");
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const call = (method: string, path: string, body?: unknown) =>
      app.request(`${apiOrigin}/api/me${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const id = (title: string) =>
      review.obligations.find((o) => o.title === title)!.id;
    await call("POST", `/review/obligation/${id("Übungsblatt 3")}/confirm`, {});
    await call(
      "POST",
      `/obligations/${id("Übungsblatt 1")}/reported-submitted`,
      {
        reported: true,
      },
    );
    await call("POST", `/review/obligation/${id("Referat")}/reject`, {});
    const task = (await (
      await call("POST", "/tasks", {
        title: "Bäume wiederholen",
        obligationId: null,
        courseId: review.id,
      })
    ).json()) as { id: string };
    for (const [work, days] of [
      [{ kind: "task", id: task.id }, 1],
      [{ kind: "obligation", id: id("Übungsblatt 3") }, 3],
    ] as const)
      expect(
        (
          await call("POST", "/study-blocks", {
            work,
            start: at(days, 9).toISOString(),
            end: at(days, 11).toISOString(),
          })
        ).status,
      ).toBe(201);
    const stamp = (days: number, hour: number) =>
      at(days, hour)
        .toISOString()
        .replace(/[-:]|\.\d{3}/g, "");
    const event = (uid: string, title: string, days: number) => [
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp(0, 0)}`,
      `SUMMARY:${title}`,
      `DTSTART:${stamp(days, 9)}`,
      `DTEND:${stamp(days, 11)}`,
      "END:VEVENT",
    ];
    await call("POST", "/calendar-sources", {
      name: "Stundenplan.ics",
      ics: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//test//EN",
        ...event("om-1@uni", "OM Vorlesung", 2),
        ...event("yoga@uni", "Yoga", 2),
        "END:VCALENDAR",
      ].join("\r\n"),
    });
    const { eventSeries } = (await (await call("GET", "/plan")).json()) as {
      eventSeries: { id: string; title: string }[];
    };
    await call(
      "POST",
      `/event-series/${eventSeries.find((e) => e.title === "OM Vorlesung")!.id}/decision`,
      { courseId: review.id },
    );

    const page = (await (
      await call("GET", `/courses/${review.id}`)
    ).json()) as {
      dated: unknown;
    };

    const timed = { obligationKind: null, unreviewed: false, allDay: false };
    expect(page.dated).toEqual([
      {
        ...timed,
        kind: "study_block",
        id: expect.any(String),
        title: "Bäume wiederholen",
        start: at(1, 9).toISOString(),
        end: at(1, 11).toISOString(),
      },
      {
        ...timed,
        kind: "course_event",
        id: expect.any(String),
        title: "OM Vorlesung",
        start: at(2, 9).toISOString(),
        end: at(2, 11).toISOString(),
      },
      {
        ...timed,
        kind: "study_block",
        id: expect.any(String),
        title: "Übungsblatt 3",
        start: at(3, 9).toISOString(),
        end: at(3, 11).toISOString(),
      },
      {
        kind: "obligation",
        id: id("Übungsblatt 3"),
        title: "Übungsblatt 3",
        obligationKind: "assignment",
        unreviewed: false,
        allDay: false,
        start: expect.stringMatching(new RegExp(`^${date(4)}T1[01]:00:00`)),
        end: null,
      },
      {
        kind: "obligation",
        id: id("Klausur"),
        title: "Klausur",
        obligationKind: "exam",
        unreviewed: true,
        allDay: true,
        start: expect.any(String),
        end: null,
      },
    ]);
  });

  it("lists the Course's open Disagreements on exam logistics and due dates, each value with the Sources that give it", async () => {
    const fact = (
      type: "exam_logistics" | "course_rule" | "topic",
      key: string,
      value: string,
      page: number,
    ) => ({
      course: "OM-1",
      type,
      key,
      value,
      page,
      quote: `${key}: ${value}`,
      uncertainty: null,
    });
    const sheet = (date: string, page: number) => ({
      course: "OM-1",
      kind: "assignment" as const,
      title: "Übungsblatt 3",
      key: "Blatt 3",
      destination: null,
      due: { date, time: null, timeZone: null, text: date },
      page,
      quote: `Blatt 3 bis ${date}`,
      uncertainty: null,
    });
    const s = await coursePage("course-page-disagreements", [
      fact("exam_logistics", "exam.room", "B 204", 1),
      fact("exam_logistics", "exam.duration", "90 Minuten", 2),
      fact("course_rule", "Zulassung", "50 % der Übungspunkte", 3),
    ]);
    await read(
      s.p,
      "Modulhandbuch.pdf",
      10,
      extraction({
        obligations: [sheet("2026-11-22", 4)],
        facts: [
          fact("exam_logistics", "exam.room", "C 112", 1),
          fact("exam_logistics", "exam.duration", "90 Minuten", 2),
          fact("course_rule", "Zulassung", "60 % der Übungspunkte", 3),
        ],
      }),
    );
    await read(
      s.p,
      "Ankündigung.pdf",
      10,
      extraction({ obligations: [sheet("2026-11-20", 1)] }),
    );
    const course = (await facts.review(s.p)).courses[0]!;
    const room = course.facts.find((f) => f.key === "exam.room")!;
    const due = course.obligations.find((o) => o.title === "Übungsblatt 3")!;
    const extractionOf = (
      values: { citations: { extractionId: string; title: string }[] }[],
      title: string,
    ) =>
      values.flatMap((v) => v.citations).find((c) => c.title === title)!
        .extractionId;

    const { disagreements } = (await (await s.page()).json()) as {
      disagreements: unknown;
    };

    expect(disagreements).toEqual([
      {
        kind: "obligation",
        id: due.id,
        title: "Übungsblatt 3",
        values: [
          {
            due: { date: "2026-11-22", time: null, timeZone: "Europe/Berlin" },
            extractionId: extractionOf(due.values, "Modulhandbuch.pdf"),
            sources: ["Modulhandbuch.pdf"],
          },
          {
            due: { date: "2026-11-20", time: null, timeZone: "Europe/Berlin" },
            extractionId: extractionOf(due.values, "Ankündigung.pdf"),
            sources: ["Ankündigung.pdf"],
          },
        ],
      },
      {
        kind: "fact",
        id: room.id,
        key: "exam.room",
        values: [
          {
            value: "B 204",
            extractionId: extractionOf(room.values, "Vorlesung 04.pdf"),
            sources: ["Vorlesung 04.pdf"],
          },
          {
            value: "C 112",
            extractionId: extractionOf(room.values, "Modulhandbuch.pdf"),
            sources: ["Modulhandbuch.pdf"],
          },
        ],
      },
    ]);

    await s.call("POST", `/api/me/review/fact/${room.id}/use`, {
      extractionId: extractionOf(room.values, "Modulhandbuch.pdf"),
    });
    expect(
      (
        (await (await s.page()).json()) as { disagreements: { id: string }[] }
      ).disagreements.map((d) => d.id),
    ).toEqual([due.id]);
  });

  it("is gone for another student and for a rejected Course", async () => {
    const s = await coursePage("course-page-gone");
    const other = await coursePage("course-page-gone-other");

    expect(
      (await other.call("GET", `/api/me/courses/${s.courseId}`)).status,
    ).toBe(404);
    const proposed = await coursePage("course-page-rejected");
    await facts.decideCourse(proposed.p, proposed.courseId, "reject");
    expect((await proposed.page()).status).toBe(404);
  });
});

describe("Agent Templates API (#190)", () => {
  async function studentWithCourse(slug: string) {
    const cookie = await signUp(slug);
    const id = await studentId(cookie);
    const courseId = randomUUID();
    await admin.course.create({
      data: {
        id: courseId,
        studentId: id,
        title: "Statistik I",
        matchTitle: "statistik i",
        semester: "2026-ws",
        color: "rose",
        status: "accepted",
      },
    });
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const body = (overrides: Record<string, unknown> = {}) => ({
      name: "Klausur vorbereiten",
      description: "Plant deine Vorbereitung bis zum Prüfungstag.",
      emoji: "🎯",
      instructions:
        "Bereite mich auf die nächste Klausur in meinen Kursen vor.",
      courseIds: [courseId],
      capabilities: [
        { id: "createStudyBlocks", mode: "automatic" },
        { id: "moveOwnStudyBlocks", mode: "automatic" },
        { id: "removeOwnStudyBlocks", mode: "automatic" },
        { id: "notifyStudent", mode: null },
      ],
      budgetMicroUsd: 5_000_000,
      trigger: { rhythm: "daily", minute: 360 },
      modelKey: "sonnet-5.5-reasoning-high",
      ...overrides,
    });
    return {
      cookie,
      headers,
      courseId,
      body,
      templates: () =>
        app.request(`${apiOrigin}/api/me/agents/templates`, {
          headers: { cookie },
        }),
      template: (templateId: string) =>
        app.request(`${apiOrigin}/api/me/agents/templates/${templateId}`, {
          headers: { cookie },
        }),
      create: (payload: Record<string, unknown>) =>
        app.request(`${apiOrigin}/api/me/agents`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        }),
    };
  }

  it("requires authentication and lists the three curated Templates and their details", async () => {
    expect(
      (await app.request(`${apiOrigin}/api/me/agents/templates`)).status,
    ).toBe(401);
    expect(
      (await app.request(`${apiOrigin}/api/me/agents/templates/prepareExam`))
        .status,
    ).toBe(401);

    const s = await studentWithCourse("templates-list");
    const response = await s.templates();
    expect(response.status).toBe(200);
    const list = (await response.json()) as {
      id: string;
      name: string;
      emoji: string;
      courses: string;
      createdOn: string;
      othersCount: number;
    }[];
    expect(list.map((t) => [t.id, t.emoji, t.name, t.courses])).toEqual([
      ["prepareExam", "🎯", "Klausur vorbereiten", "none"],
      ["organizeCourse", "📚", "Kurs organisieren", "none"],
      ["createBriefings", "📧", "Briefings erstellen", "all_active"],
    ]);
    for (const item of list) {
      expect(item.createdOn).toBe("2026-11-19");
      expect(item.othersCount).toBeGreaterThanOrEqual(0);
    }

    const detail = await s.template("createBriefings");
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      id: "createBriefings",
      emoji: "📧",
      courses: "all_active",
      trigger: { rhythm: "daily", minute: 420 },
      capabilities: [{ id: "createBriefing", mode: null }],
    });
    expect((await s.template("unknown")).status).toBe(404);
  });

  it("saves templateId on POST, rejects unknown templateId, preserves it on PUT, and computes N across distinct other students", async () => {
    const alice = await studentWithCourse("templates-alice");
    const bob = await studentWithCourse("templates-bob");
    const carol = await studentWithCourse("templates-carol");

    // Reject unknown templateId cleanly.
    expect(
      (await alice.create(alice.body({ templateId: "not_a_template" }))).status,
    ).toBe(400);

    const othersFor = async (
      s: typeof alice,
      templateId: string,
    ): Promise<number> => {
      const list = (await (await s.templates()).json()) as {
        id: string;
        othersCount: number;
      }[];
      return list.find((t) => t.id === templateId)!.othersCount;
    };

    const baseExam = await othersFor(bob, "prepareExam");
    const baseBriefing = await othersFor(bob, "createBriefings");

    // Alice saves an Agent from prepareExam.
    const a1Res = await alice.create(alice.body({ templateId: "prepareExam" }));
    expect(a1Res.status).toBe(201);
    const { id: a1 } = (await a1Res.json()) as { id: string };

    // Saved Agent records its templateId, and editing it keeps templateId intact.
    expect(
      await (
        await app.request(`${apiOrigin}/api/me/agents/${a1}`, {
          headers: { cookie: alice.cookie },
        })
      ).json(),
    ).toMatchObject({ templateId: "prepareExam" });
    expect(
      (
        await app.request(`${apiOrigin}/api/me/agents/${a1}`, {
          method: "PUT",
          headers: alice.headers,
          body: JSON.stringify(alice.body({ name: "Umbenannt" })),
        })
      ).status,
    ).toBe(200);
    expect(
      await (
        await app.request(`${apiOrigin}/api/me/agents/${a1}`, {
          headers: { cookie: alice.cookie },
        })
      ).json(),
    ).toMatchObject({ name: "Umbenannt", templateId: "prepareExam" });

    // Alice's own Agent is NOT counted in Alice's N, but IS counted in Bob's N.
    expect(await othersFor(alice, "prepareExam")).toBe(baseExam);
    expect(await othersFor(bob, "prepareExam")).toBe(baseExam + 1);
    expect(
      (
        (await (await bob.template("prepareExam")).json()) as {
          othersCount: number;
        }
      ).othersCount,
    ).toBe(baseExam + 1);

    // Alice creates a second Agent from prepareExam: still counted once for Bob.
    const a2Res = await alice.create(alice.body({ templateId: "prepareExam" }));
    expect(a2Res.status).toBe(201);
    const { id: a2 } = (await a2Res.json()) as { id: string };
    expect(await othersFor(bob, "prepareExam")).toBe(baseExam + 1);

    // Carol saves from createBriefings and Ends it: Ended Agents stay counted.
    const c1Res = await carol.create(
      carol.body({
        name: "Briefings erstellen",
        emoji: "📧",
        capabilities: [{ id: "createBriefing", mode: null }],
        trigger: { rhythm: "daily", minute: 420 },
        templateId: "createBriefings",
      }),
    );
    expect(c1Res.status).toBe(201);
    const { id: c1 } = (await c1Res.json()) as { id: string };
    await app.request(`${apiOrigin}/api/me/agents/${c1}/end`, {
      method: "POST",
      headers: carol.headers,
    });
    expect(await othersFor(bob, "createBriefings")).toBe(baseBriefing + 1);

    // Deleting Alice's Agents removes her from Bob's count once none remain.
    await app.request(`${apiOrigin}/api/me/agents/${a1}`, {
      method: "DELETE",
      headers: alice.headers,
    });
    expect(await othersFor(bob, "prepareExam")).toBe(baseExam + 1);
    await app.request(`${apiOrigin}/api/me/agents/${a2}`, {
      method: "DELETE",
      headers: alice.headers,
    });
    expect(await othersFor(bob, "prepareExam")).toBe(baseExam);

    // RLS isolation: Bob still cannot view Carol's Agent, even though N counted Carol.
    expect(
      (
        await app.request(`${apiOrigin}/api/me/agents/${c1}`, {
          headers: { cookie: bob.cookie },
        })
      ).status,
    ).toBe(404);
  });
});

describe("the AI builder", () => {
  /** A Course of the student's, accepted unless told otherwise. */
  async function course(
    studentId: string,
    title: string,
    data: { archivedAt?: Date; code?: string } = {},
  ) {
    const id = randomUUID();
    await admin.course.create({
      data: {
        id,
        studentId,
        title,
        code: data.code ?? null,
        matchTitle: title.toLowerCase(),
        semester: "2026-ws",
        color: "violet",
        status: "accepted",
        archivedAt: data.archivedAt ?? null,
      },
    });
    return id;
  }
  async function student(name: string) {
    const cookie = await signUp(name);
    const id = await studentId(cookie);
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    return { id, cookie, headers };
  }
  /** A blank "Neuer Agent" as the form holds it. */
  const blank = {
    name: "",
    description: "",
    instructions: "",
    courseIds: [] as string[],
    capabilities: [] as { id: string; mode: string | null }[],
    trigger: { rhythm: "daily", weekdays: [] as number[], minute: 360 },
  };
  const ask = (
    headers: Record<string, string>,
    body: { form: unknown; messages: { role: string; text: string }[] },
  ) =>
    app.request(`${apiOrigin}/api/me/agents/builder`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  /** The handle the model was given for a Course, such as K2. */
  const handleOf = (prompt: unknown, title: string) =>
    JSON.stringify(prompt).match(new RegExp(`(K\\d+): ${title}`))?.[1];

  it("drafts the form from a description, streaming its reply and the form-fill with Courses by ID", async () => {
    const s = await student("builder-draft");
    const statistics = await course(s.id, "Statistics II", { code: "ST-2" });
    await course(s.id, "Analysis I");
    steps.push((prompt) => [
      ...says("Ich habe dir einen Entwurf gebaut."),
      ...calls("fillForm", {
        name: "Klausur Statistik",
        description: "Hält meine Klausurvorbereitung auf Kurs.",
        instructions: "Bereite mich auf die Klausur in Statistics II vor.",
        trigger: { rhythm: "weekdays", weekdays: [5, 1, 3], time: "07:30" },
        courses: [handleOf(prompt, "Statistics II")],
        capabilities: [
          { id: "createStudyBlocks", mode: "always" },
          { id: "createFlashcards" },
        ],
      }),
    ]);
    const before = offeredTools.length;

    const response = await ask(s.headers, {
      form: blank,
      messages: [
        { role: "student", text: "Bereite mich auf Statistics II vor." },
      ],
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const chunks = await sseChunks(response);
    expect(
      chunks
        .filter((chunk) => chunk.type === "text-delta")
        .map((chunk) => chunk.delta)
        .join(""),
    ).toBe("Ich habe dir einen Entwurf gebaut.");
    // Its one tool, on its task Model; its raw call never reaches the student.
    expect(offeredTools.slice(before)).toEqual([["fillForm"]]);
    expect(chunks.some((chunk) => chunk.type.startsWith("tool-"))).toBe(false);
    expect(chunks.find((chunk) => chunk.type === "data-form")?.data).toEqual({
      name: "Klausur Statistik",
      description: "Hält meine Klausurvorbereitung auf Kurs.",
      instructions: "Bereite mich auf die Klausur in Statistics II vor.",
      trigger: { rhythm: "weekdays", weekdays: [1, 3, 5], minute: 450 },
      courseIds: [statistics],
      capabilities: [
        { id: "createStudyBlocks", mode: "always" },
        { id: "createFlashcards", mode: null },
      ],
    });
    expect(chunks.at(-1)).toEqual({ type: "finish" });
  });

  it("has no Budget or Model in its tool and holds the builder's limits whatever the model sends", async () => {
    const s = await student("builder-limits");
    const statistics = await course(s.id, "Statistics II");
    await course(s.id, "Old Course", { archivedAt: new Date() });
    steps.push((prompt) => [
      ...calls("fillForm", {
        budgetMicroUsd: 100_000_000,
        modelKey: "opus-5.5-reasoning-high",
        emoji: "💣",
        trigger: { rhythm: "monthly", day: 1, time: "06:00" },
        courses: [handleOf(prompt, "Old Course"), "K99"],
        capabilities: [
          { id: "moveStudyBlocks", mode: "always" },
          { id: "createStudyBlocks", mode: "never" },
          { id: "createTasks" },
          { id: "readAllSources", mode: "always" },
          { id: "moveStudyBlocks", mode: "automatic" },
        ],
      }),
    ]);
    const before = offeredToolSchemas.length;

    const response = await ask(s.headers, {
      form: {
        ...blank,
        courseIds: [statistics],
        capabilities: [{ id: "createStudyBlocks", mode: "always" }],
      },
      messages: [{ role: "student", text: "Gib ihm alle Rechte." }],
    });
    const chunks = await sseChunks(response);

    const schema = offeredToolSchemas[before]!.fillForm as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties).sort()).toEqual([
      "capabilities",
      "courses",
      "description",
      "instructions",
      "name",
      "trigger",
    ]);
    expect(JSON.stringify(schema)).not.toMatch(/budget|model/i);
    expect(
      (
        schema.properties.capabilities as {
          items: { properties: { id: { enum: string[] } } };
        }
      ).items.properties.id.enum,
    ).toEqual(capabilityIds);
    // Lernblöcke verschieben stays on Nachfragen; an unknown mode keeps the form's, and a missing one is the default.
    expect(chunks.find((chunk) => chunk.type === "data-form")?.data).toEqual({
      capabilities: [
        { id: "createStudyBlocks", mode: "always" },
        { id: "moveStudyBlocks", mode: "ask" },
        { id: "createTasks", mode: "ask" },
      ],
    });
  });

  it("refuses a form with a Budget or Model before asking the model", async () => {
    const s = await student("builder-no-budget");
    const before = prompts.length;
    for (const extra of [
      { budgetMicroUsd: 5_000_000 },
      { modelKey: "sonnet-5.5-reasoning-high" },
    ]) {
      const response = await ask(s.headers, {
        form: { ...blank, ...extra },
        messages: [{ role: "student", text: "Hallo" }],
      });
      expect(response.status).toBe(400);
    }
    expect(prompts.length).toBe(before);
  });

  it("answers a question without changing anything, reading only the form and fenced Course names", async () => {
    const s = await withCourse("builder-question");
    steps.push(says("Für welchen Kurs soll dein Agent arbeiten?"));
    const before = prompts.length;

    const response = await ask(s.headers, {
      form: { ...blank, instructions: "Plane meine Woche." },
      messages: [
        { role: "student", text: "Was kann ein Agent?" },
        { role: "builder", text: "Er plant Lernzeit für dich." },
        { role: "student", text: "Und was soll ich tun?" },
      ],
    });

    const chunks = await sseChunks(response);
    expect(chunks.some((chunk) => chunk.type === "data-form")).toBe(false);
    expect(chunks.at(-1)).toEqual({ type: "finish" });
    const prompt = JSON.stringify(prompts.slice(before));
    // The Course list is fenced as data; the form says it has no Course, so the model asks which.
    expect(prompt).toMatch(
      /<<<BEGIN courses [0-9a-f]+>>>.*Analysis I \(MA-101\)/,
    );
    expect(prompt).toContain("Plane meine Woche.");
    expect(prompt).toContain("no Course");
    // The conversation as the browser sent it, with the form and Courses just before the latest message.
    expect(conversation(prompts.at(-1))).toEqual([
      ["user", "Was kann ein Agent?"],
      ["assistant", "Er plant Lernzeit für dich."],
      ["user", expect.stringContaining("The form as it stands:")],
      ["user", "Und was soll ich tun?"],
    ]);
    // Never the student's Obligations or Plan.
    expect(prompt).not.toContain("Problem sheet 1");
  });

  it("is paid from the Allowance, never an Agent's Budget, and keeps no conversation", async () => {
    const s = await student("builder-metering");
    const statistics = await course(s.id, "Statistics II");
    const created = await app.request(`${apiOrigin}/api/me/agents`, {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({
        name: "Klausur Statistik",
        description: "",
        emoji: "🤖",
        instructions: "Bereite mich vor.",
        courseIds: [statistics],
        capabilities: [],
        budgetMicroUsd: 5_000_000,
        trigger: { rhythm: "daily", minute: 360 },
        modelKey: "sonnet-5.5-reasoning-high",
      }),
    });
    const { id: agentId } = (await created.json()) as { id: string };
    const chatsBefore = await admin.chatMessage.count();
    steps.push(says("Gern."));

    const response = await ask(s.headers, {
      form: { ...blank, courseIds: [statistics] },
      messages: [{ role: "student", text: "Danke!" }],
    });
    await response.text();

    expect(
      await admin.allowance.findUniqueOrThrow({ where: { studentId: s.id } }),
    ).toMatchObject({ usedMicroUsd: 1n, heldMicroUsd: 0n });
    expect(
      await admin.agent.findUniqueOrThrow({ where: { id: agentId } }),
    ).toMatchObject({ usedMicroUsd: 0n, heldMicroUsd: 0n });
    expect(
      await admin.usageReservation.findMany({ where: { studentId: s.id } }),
    ).toEqual([
      expect.objectContaining({
        agentId: null,
        runId: null,
        status: "settled",
        actualMicroUsd: 1n,
      }),
    ]);
    expect(await admin.chatMessage.count()).toBe(chatsBefore);
  });

  it("is unavailable once the Allowance is exhausted, without asking the model", async () => {
    const s = await student("builder-exhausted");
    await admin.allowance.update({
      where: { studentId: s.id },
      data: { limitMicroUsd: 0 },
    });
    const before = prompts.length;

    const response = await ask(s.headers, {
      form: blank,
      messages: [{ role: "student", text: "Bau mir einen Agenten." }],
    });

    expect(response.status).toBe(200);
    const chunks = await sseChunks(response);
    expect(chunks.find((chunk) => chunk.type === "data-refused")?.data).toEqual(
      { error: "allowance_exhausted" },
    );
    expect(chunks.some((chunk) => chunk.type === "data-form")).toBe(false);
    expect(prompts.length).toBe(before);
  });
});

describe("the Agents cutover", () => {
  const migration = readFileSync(
    new URL(
      "../../../packages/db/prisma/migrations/20261213100000_agent_cutover/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  /** A signed-up student, and a call to their API. */
  const cutoverStudent = async (name: string) => {
    const cookie = await signUp(name);
    const id = await studentId(cookie);
    const headers = {
      cookie,
      origin: appOrigin,
      "content-type": "application/json",
    };
    const call = (method: string, path: string) =>
      app.request(`${apiOrigin}/api/me${path}`, { method, headers });
    // The columns the contract migration dropped, put back as the Responsibilities had them.
    await admin.$executeRawUnsafe(`
      ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "preset" TEXT,
        ADD COLUMN IF NOT EXISTS "courseId" TEXT,
        ADD COLUMN IF NOT EXISTS "obligationId" TEXT,
        ADD COLUMN IF NOT EXISTS "restrictions" JSONB NOT NULL DEFAULT '{}';
      ALTER TABLE "grant" ADD COLUMN IF NOT EXISTS "courseId" TEXT,
        ADD COLUMN IF NOT EXISTS "obligationId" TEXT;
    `);
    return { id, call };
  };
  const course = async (
    id: string,
    title: string,
    data: {
      status?: "accepted" | "rejected" | "merged";
      mergedIntoId?: string;
    } = {},
  ) => {
    const courseId = randomUUID();
    await admin.course.create({
      data: {
        id: courseId,
        studentId: id,
        title,
        matchTitle: title.toLowerCase(),
        semester: "2026-ws",
        color: "violet",
        status: data.status ?? "accepted",
        mergedIntoId: data.mergedIntoId ?? null,
      },
    });
    return courseId;
  };
  /** A preset as the Responsibilities left it: scoped Grants, a lifetime Budget and its `restrictions`. */
  const preset = async (
    id: string,
    kind: "keep_course_organized" | "prepare_for_exam",
    scope: { courseId: string; obligationId?: string },
    data: {
      state?: "active" | "paused" | "ended";
      pausedBy?: string;
      restrictions?: object;
    } = {},
  ) => {
    const agentId = randomUUID();
    await admin.$executeRaw`
      INSERT INTO "agent" ("id", "studentId", "preset", "courseId", "obligationId", "state", "pausedBy",
        "budgetMicroUsd", "usedMicroUsd", "restrictions", "triggerMinute")
      VALUES (${agentId}, ${id}, ${kind}, ${scope.courseId}, ${scope.obligationId ?? null},
        ${data.state ?? "active"}::"agent_state", ${data.pausedBy ?? null}, 1000000, 300000,
        ${JSON.stringify(data.restrictions ?? {})}::jsonb, 420)`;
    for (const grant of ["studyBlock.create", "studyBlock.move"])
      await admin.$executeRaw`
        INSERT INTO "grant" ("id", "studentId", "agentId", "kind", "courseId", "obligationId")
        VALUES (${randomUUID()}, ${id}, ${agentId}, ${grant},
          ${scope.obligationId ? null : scope.courseId}, ${scope.obligationId ?? null})`;
    return agentId;
  };

  it("turns each seeded Responsibility into a Paused Agent with its history, keeping only the authority it had", async () => {
    const { id, call } = await cutoverStudent("agent-cutover");
    const analysis = await course(id, "Analysis I");
    const statistics = await course(id, "Statistics II");
    const rejected = await course(id, "Verworfen", { status: "rejected" });
    const entered = await facts.enterObligation(
      principal.fromSession({ studentId: id }),
      {
        course: { id: analysis },
        kind: "exam",
        title: "Klausur Analysis",
        due: { date: "2027-02-12", time: null, timeZone: null },
        destination: null,
      },
    );
    if (entered.status !== "ok") throw new Error(entered.status);
    const exam = entered.id;
    const organize = await preset(id, "keep_course_organized", {
      courseId: analysis,
    });
    const examAgent = await preset(
      id,
      "prepare_for_exam",
      { courseId: analysis, obligationId: exam },
      {
        state: "paused",
        pausedBy: "budget",
        restrictions: { alwaysAsk: ["studyBlock.move"] },
      },
    );
    const restricted = await preset(
      id,
      "keep_course_organized",
      { courseId: statistics },
      { restrictions: { allowedKinds: ["studyBlock.create"] } },
    );
    const ended = await preset(
      id,
      "keep_course_organized",
      { courseId: statistics },
      { state: "ended" },
    );
    const courseless = await preset(id, "keep_course_organized", {
      courseId: rejected,
    });

    // Its Run waiting on an Approval, after adding one block.
    const runId = randomUUID();
    const startedAt = new Date("2026-11-20T05:00:00Z");
    await admin.run.create({
      data: {
        id: runId,
        studentId: id,
        agentId: organize,
        workflowId: `run/${organize}-2026-11-20T05:00:00Z`,
        startedAt,
      },
    });
    const obligationId = exam;
    const action = async (
      n: number,
      kind: string,
      args: object,
      status: "done" | "awaiting_approval",
    ) => {
      const actionId = randomUUID();
      await admin.action.create({
        data: {
          id: actionId,
          studentId: id,
          runId,
          key: `${runId}:${n}`,
          kind,
          args,
          status,
          createdAt: new Date(startedAt.getTime() + n * 1000),
        },
      });
      await admin.actionEvent.create({
        data: {
          studentId: id,
          actionId,
          at: new Date(startedAt.getTime() + n * 1000),
          type: status === "done" ? "done" : "approval_requested",
        },
      });
      return actionId;
    };
    await action(
      1,
      "studyBlock.create",
      {
        workId: obligationId,
        start: "2099-01-01T09:00:00.000Z",
        end: "2099-01-01T10:00:00.000Z",
      },
      "done",
    );
    const asked = await action(
      2,
      "studyBlock.move",
      {
        studyBlockId: randomUUID(),
        start: "2099-01-02T09:00:00.000Z",
        end: "2099-01-02T10:00:00.000Z",
      },
      "awaiting_approval",
    );
    await admin.approval.create({
      data: {
        id: randomUUID(),
        studentId: id,
        actionId: asked,
        fingerprint: "f",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    await admin.$executeRawUnsafe(migration);
    // Safe to repeat: a second pass changes nothing.
    await admin.$executeRawUnsafe(migration);

    const listed = (await (await call("GET", "/agents")).json()) as {
      id: string;
    }[];
    expect(
      [organize, examAgent, restricted, ended, courseless].map((agentId) =>
        listed.find((r) => r.id === agentId),
      ),
    ).toEqual([
      expect.objectContaining({
        name: "Kurs organisieren · Analysis I",
        emoji: "📚",
        state: "paused",
        pausedBy: "conversion",
        badge: "paused",
      }),
      expect.objectContaining({
        name: "Klausur vorbereiten · Klausur Analysis",
        emoji: "🎯",
        state: "paused",
        pausedBy: "conversion",
      }),
      expect.objectContaining({
        name: "Kurs organisieren · Statistics II",
        state: "paused",
        pausedBy: "conversion",
      }),
      expect.objectContaining({ state: "ended", pausedBy: null }),
      expect.objectContaining({ state: "ended", pausedBy: null }),
    ]);

    const shown = async (agentId: string) =>
      (await call("GET", `/agents/${agentId}`)).json();
    expect(await shown(organize)).toMatchObject({
      templateId: null,
      name: "Kurs organisieren · Analysis I",
      description: agentTemplates.organizeCourse.description,
      instructions: agentTemplates.organizeCourse.instructions,
      courses: [{ id: analysis, title: "Analysis I", archived: false }],
      capabilities: [
        { id: "createStudyBlocks", mode: "automatic" },
        { id: "moveOwnStudyBlocks", mode: "automatic" },
      ],
      grants: expect.arrayContaining(["studyBlock.create", "studyBlock.move"]),
      budget: { limitMicroUsd: 5_000_000, usedMicroUsd: 0 },
      trigger: { rhythm: "daily", minute: 360 },
      modelKey: "sonnet-5.5-reasoning-high",
      running: false,
      approvalRunId: null,
    });
    expect(await shown(examAgent)).toMatchObject({
      description: agentTemplates.prepareExam.description,
      instructions: agentTemplates.prepareExam.instructions,
      courses: [{ id: analysis }],
      capabilities: [
        { id: "createStudyBlocks", mode: "automatic" },
        { id: "moveOwnStudyBlocks", mode: "ask" },
      ],
      grants: ["studyBlock.create"],
    });
    expect(await shown(restricted)).toMatchObject({
      courses: [{ id: statistics }],
      capabilities: [{ id: "createStudyBlocks", mode: "automatic" }],
      grants: ["studyBlock.create"],
    });
    expect(await shown(ended)).toMatchObject({
      name: "Kurs organisieren · Statistics II",
      courses: [{ id: statistics }],
      grants: [],
    });
    expect(await shown(courseless)).toMatchObject({
      name: "Kurs organisieren · Verworfen",
      courses: [],
      grants: [],
    });
    expect(
      (await admin.agent.findMany({ where: { studentId: id } })).map(
        (r) => r.templateId,
      ),
    ).toEqual([null, null, null, null, null]);

    // Its Run under way stopped, its pending Approval expired, and its Verlauf shows the Actions it took.
    expect(await (await call("GET", "/approvals")).json()).toEqual([]);
    expect(
      await (await call("GET", `/agents/${organize}/runs?limit=10`)).json(),
    ).toEqual({
      runs: [
        expect.objectContaining({
          id: runId,
          status: "stopped",
          trigger: "schedule",
          stopReason: "conversion",
          openApprovals: 0,
        }),
      ],
      nextCursor: null,
    });
    const detail = (await (
      await call("GET", `/agents/${organize}/runs/${runId}`)
    ).json()) as { verlauf: { type: string }[]; approvals: unknown[] };
    expect(detail.approvals).toEqual([]);
    expect(detail.verlauf).toEqual([
      expect.objectContaining({ type: "start", trigger: "schedule" }),
      expect.objectContaining({
        type: "action",
        step: 1,
        capability: "createStudyBlocks",
        action: expect.objectContaining({
          kind: "studyBlock.create",
          work: { title: "Klausur Analysis", course: "Analysis I" },
          start: "2099-01-01T09:00:00.000Z",
        }),
        outcome: "done",
      }),
      expect.objectContaining({
        type: "action",
        capability: "moveOwnStudyBlocks",
        outcome: "awaiting_approval",
      }),
      expect.objectContaining({
        type: "end",
        status: "stopped",
        reason: "conversion",
      }),
      expect.objectContaining({ type: "approval", decision: "expired" }),
    ]);

    // Only the student resumes it, and then it acts again.
    expect((await call("POST", `/agents/${organize}/resume`)).status).toBe(200);
    expect(await shown(organize)).toMatchObject({
      state: "active",
      pausedBy: null,
    });
  });

  it("follows a merged Course, names an exam without a title the student gave it by its Course, and starts the Budget in the Plan's month", async () => {
    const { id, call } = await cutoverStudent("agent-cutover-scope");
    const timeZone = "Pacific/Kiritimati";
    await admin.planPreference.upsert({
      where: { studentId: id },
      create: { studentId: id, timeZone },
      update: { timeZone },
    });
    const algebra = await course(id, "Lineare Algebra");
    const merged = await course(id, "LinAlg", {
      status: "merged",
      mergedIntoId: algebra,
    });
    const statistics = await course(id, "Statistik");
    const examId = randomUUID();
    await admin.obligation.create({
      data: {
        id: examId,
        studentId: id,
        courseId: statistics,
        matchKey: "klausur",
        kind: "exam",
        enteredAt: new Date(),
      },
    });
    const organize = await preset(id, "keep_course_organized", {
      courseId: merged,
    });
    const examAgent = await preset(id, "prepare_for_exam", {
      courseId: statistics,
      obligationId: examId,
    });

    await admin.$executeRawUnsafe(migration);

    const shown = async (agentId: string) =>
      (await call("GET", `/agents/${agentId}`)).json();
    // The name keeps the title the Course had; it now acts for the Course it was merged into.
    expect(await shown(organize)).toMatchObject({
      name: "Kurs organisieren · LinAlg",
      state: "paused",
      pausedBy: "conversion",
      courses: [{ id: algebra, title: "Lineare Algebra" }],
    });
    expect(await shown(examAgent)).toMatchObject({
      name: "Klausur vorbereiten · Statistik",
      state: "paused",
      courses: [{ id: statistics }],
    });
    const month = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
      })
        .formatToParts(new Date())
        .map((part) => [part.type, part.value]),
    );
    expect(
      await admin.agent.findMany({
        where: { id: { in: [organize, examAgent] } },
        select: { budgetMonth: true, usedMicroUsd: true },
      }),
    ).toEqual([
      { budgetMonth: `${month.year}-${month.month}`, usedMicroUsd: 0n },
      { budgetMonth: `${month.year}-${month.month}`, usedMicroUsd: 0n },
    ]);
  });

  it("gives each old Run the status its Actions show", async () => {
    const { id, call } = await cutoverStudent("agent-cutover-runs");
    const analysis = await course(id, "Analysis I");
    const workId = randomUUID();
    await admin.obligation.create({
      data: {
        id: workId,
        studentId: id,
        courseId: analysis,
        matchKey: "blatt-1",
        kind: "assignment",
        enteredAt: new Date(),
      },
    });
    const agentId = await preset(id, "keep_course_organized", {
      courseId: analysis,
    });
    /** An old Run, which recorded no status, started at `day` 05:00 with one Action per entry, a second apart. */
    const run = async (
      day: number,
      actions: {
        status: "done" | "unconfirmed" | "refused" | "dispatching";
        refusal?: string;
      }[],
    ) => {
      const runId = randomUUID();
      const startedAt = new Date(Date.UTC(2026, 10, day, 5));
      await admin.run.create({
        data: {
          id: runId,
          studentId: id,
          agentId,
          workflowId: `run/${agentId}-${startedAt.toISOString()}`,
          startedAt,
        },
      });
      for (const [i, { status, refusal }] of actions.entries()) {
        const at = new Date(startedAt.getTime() + (i + 1) * 1000);
        const actionId = randomUUID();
        await admin.action.create({
          data: {
            id: actionId,
            studentId: id,
            runId,
            key: `${runId}:${i + 1}`,
            kind: "studyBlock.create",
            args: {
              workId,
              start: "2099-01-01T09:00:00.000Z",
              end: "2099-01-01T10:00:00.000Z",
            },
            status,
            refusal: refusal ?? null,
            createdAt: at,
          },
        });
        if (status !== "dispatching")
          await admin.actionEvent.create({
            data: {
              studentId: id,
              actionId,
              at,
              type: status,
              ...(refusal && { detail: { reason: refusal } }),
            },
          });
      }
      return runId;
    };
    const done = await run(10, [{ status: "done" }, { status: "done" }]);
    const empty = await run(11, []);
    const unconfirmed = await run(12, [
      { status: "done" },
      { status: "unconfirmed" },
    ]);
    const paused = await run(13, [{ status: "refused", refusal: "paused" }]);
    const ended = await run(14, [{ status: "refused", refusal: "ended" }]);
    const refused = await run(15, [{ status: "refused", refusal: "past" }]);
    const dispatching = await run(16, [{ status: "dispatching" }]);

    await admin.$executeRawUnsafe(migration);

    const { runs } = (await (
      await call("GET", `/agents/${agentId}/runs?limit=10`)
    ).json()) as {
      runs: {
        id: string;
        status: string;
        stopReason: string | null;
        endedAt: string;
      }[];
    };
    const statusOf = Object.fromEntries(
      runs.map((r) => [
        r.id,
        { status: r.status, stopReason: r.stopReason, endedAt: r.endedAt },
      ]),
    );
    // Each ends when its last Action did, or when it started if it took none.
    expect(statusOf).toEqual({
      [done]: {
        status: "done",
        stopReason: null,
        endedAt: "2026-11-10T05:00:02.000Z",
      },
      [empty]: {
        status: "done",
        stopReason: null,
        endedAt: "2026-11-11T05:00:00.000Z",
      },
      [unconfirmed]: {
        status: "stopped",
        stopReason: "unconfirmed",
        endedAt: "2026-11-12T05:00:02.000Z",
      },
      [paused]: {
        status: "stopped",
        stopReason: "paused",
        endedAt: "2026-11-13T05:00:01.000Z",
      },
      [ended]: {
        status: "stopped",
        stopReason: "ended",
        endedAt: "2026-11-14T05:00:01.000Z",
      },
      [refused]: {
        status: "done",
        stopReason: null,
        endedAt: "2026-11-15T05:00:01.000Z",
      },
      [dispatching]: {
        status: "done",
        stopReason: null,
        endedAt: "2026-11-16T05:00:00.000Z",
      },
    });
    // A `dispatching` Action reads unconfirmed under a Run that reads done. Left so: the gate's stale-attempt recovery
    // still settles that Action, possibly as done, so neither reading was known wrong when the migration ran.
    const verlauf = async (runId: string) =>
      (
        (await (
          await call("GET", `/agents/${agentId}/runs/${runId}`)
        ).json()) as { verlauf: { type: string }[] }
      ).verlauf.filter((entry) => entry.type === "action");
    expect(await verlauf(dispatching)).toEqual([
      expect.objectContaining({ outcome: "unconfirmed" }),
    ]);
    expect(await verlauf(refused)).toEqual([
      expect.objectContaining({ outcome: "refused", refusal: "past" }),
    ]);
  });
});

describe("the Integration catalog", () => {
  /** Adds an Integration as a catalog migration would, in `status`. */
  async function addIntegration(status: string) {
    const key = `${status}-${run}`;
    await admin.integration.create({
      data: {
        key,
        name: `Dienst ${status}`,
        logo: `/integrations/${key}.svg`,
        description: "Seiten lesen und anlegen",
        dataNote: "Daten werden in den USA verarbeitet",
        status,
        kind: "mcp",
        mcpUrl: `https://${key}.example/mcp`,
        transport: "http",
        scopes: ["default"],
        issuers: [`https://${key}.example`],
        registration: "cimd",
      },
    });
    return key;
  }

  it("lists only offered Integrations, each with the student's Connection", async () => {
    const offered = await addIntegration("offered");
    const hidden = await addIntegration("hidden");
    const withdrawn = await addIntegration("withdrawn");
    const cookie = await signUp("integration-catalog");

    const response = await app.request(`${apiOrigin}/api/me/integrations`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    const { integrations } = (await response.json()) as {
      integrations: { key: string }[];
    };
    expect(integrations).toContainEqual({
      key: offered,
      name: "Dienst offered",
      logo: `/integrations/${offered}.svg`,
      description: "Seiten lesen und anlegen",
      dataNote: "Daten werden in den USA verarbeitet",
      kind: "mcp",
      connection: null,
    });
    const keys = integrations.map((integration) => integration.key);
    // Email is seeded hidden until the Integration injection eval passes.
    expect(keys).not.toContain("email");
    expect(keys).not.toContain(hidden);
    expect(keys).not.toContain(withdrawn);
  });

  it("needs a signed-in student", async () => {
    const response = await app.request(`${apiOrigin}/api/me/integrations`);
    expect(response.status).toBe(401);
  });
});

describe("connecting Email", () => {
  let mail: FakeMailServer;
  let lea: MailAccount;
  const password = "Pruefung-2026!";
  const defaultCAs = getCACertificates("default");

  beforeAll(async () => {
    mail = await startFakeMailServer();
    // nunio verifies mail servers' certificates; this one is signed by the fake's own CA.
    setDefaultCACertificates([...defaultCAs, mail.ca]);
    lea = await mail.createAccount("lea@uni.test", password);
    await mail.createFolder(lea, "Lehrstuhl");
    await mail.createFolder(lea, "Sent");
    // Email is seeded hidden until the Integration injection eval passes; connecting needs it offered.
    await admin.integration.update({
      where: { key: "email" },
      data: { status: "offered" },
    });
  }, 180_000);

  afterAll(async () => {
    await admin?.integration.update({
      where: { key: "email" },
      data: { status: "hidden" },
    });
    setDefaultCACertificates(defaultCAs);
    await mail?.stop();
  });

  /** The fake mail server's implicit TLS endpoints, as the manual form or "Server ändern" enters them. */
  const servers = () => ({
    imap: mail.imap.implicitTls,
    smtp: mail.smtp.implicitTls,
  });

  function post(
    path: string,
    cookie: string,
    body: unknown,
    on: ReturnType<typeof createApp> = app,
  ) {
    return on.request(`${apiOrigin}${path}`, {
      method: "POST",
      headers: {
        cookie,
        origin: appOrigin,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  async function storedFor(cookie: string) {
    const id = await studentId(cookie);
    return {
      connections: await admin.connection.findMany({
        where: { studentId: id },
      }),
      credentials: await admin.connectionCredential.findMany({
        where: { studentId: id },
      }),
    };
  }

  it("recognises a university's mail servers from the address", async () => {
    const cookie = await signUp("email-discover");

    const recognised = await post(
      "/api/me/connections/email/discover",
      cookie,
      { address: "j.schuhmacher@stud.uni-heidelberg.de" },
    );
    expect(recognised.status).toBe(200);
    expect(await recognised.json()).toEqual({
      status: "recognised",
      university: "Universität Heidelberg",
      imap: { host: "imap.urz.uni-heidelberg.de", port: 993 },
      smtp: { host: "mail.urz.uni-heidelberg.de", port: 587 },
    });

    const unknown = await post("/api/me/connections/email/discover", cookie, {
      address: "lea@cs.example",
    });
    expect(await unknown.json()).toEqual({ status: "unknown" });

    const unsupported = await post(
      "/api/me/connections/email/discover",
      cookie,
      { address: "lea@hsbi.de" },
    );
    expect(await unsupported.json()).toEqual({
      status: "unsupported",
      university: "Exchange Online",
    });
  });

  it("tests reading and sending, lists the folders, and stores nothing", async () => {
    const cookie = await signUp("email-test");

    const response = await post("/api/me/connections/email/test", cookie, {
      address: lea.address,
      password,
      servers: servers(),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      folders: [
        {
          path: "INBOX",
          name: "INBOX",
          specialUse: "\\Inbox",
          preselected: true,
        },
        {
          path: "Lehrstuhl",
          name: "Lehrstuhl",
          specialUse: null,
          preselected: false,
        },
        {
          path: "Sent",
          name: "Sent",
          specialUse: "\\Sent",
          preselected: false,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(password);
    expect(await storedFor(cookie)).toEqual({
      connections: [],
      credentials: [],
    });
  });

  it("saves the Connection with the chosen folders, its servers and sealed credentials, sending no mail", async () => {
    const cookie = await signUp("email-connect");

    const response = await post("/api/me/connections/email", cookie, {
      address: lea.address,
      password,
      servers: servers(),
      folders: ["INBOX", "Lehrstuhl"],
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      connection: {
        state: "connected",
        accountLabel: lea.address,
        folders: ["INBOX", "Lehrstuhl"],
        agentCount: 0,
      },
    });
    expect(JSON.stringify(body)).not.toContain(password);

    const listed = await app.request(`${apiOrigin}/api/me/integrations`, {
      headers: { cookie },
    });
    const listedBody = (await listed.json()) as {
      integrations: { key: string; kind: string; connection: unknown }[];
    };
    expect(
      listedBody.integrations.find((i) => i.key === "email"),
    ).toMatchObject({
      kind: "email",
      connection: {
        state: "connected",
        accountLabel: lea.address,
        folders: ["INBOX", "Lehrstuhl"],
        agentCount: 0,
      },
    });
    expect(JSON.stringify(listedBody)).not.toContain(password);

    const { connections, credentials } = await storedFor(cookie);
    expect(connections).toEqual([
      expect.objectContaining({
        integrationKey: "email",
        state: "connected",
        stateCause: null,
        accountLabel: lea.address,
        folders: ["INBOX", "Lehrstuhl"],
        servers: servers(),
        keyVersion: "test",
        lastUsedAt: null,
      }),
    ]);
    expect(connections[0]!.keyCiphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(credentials).toHaveLength(1);
    const [credential] = credentials;
    expect(credential!.connectionId).toBe(connections[0]!.id);
    expect(credential!.ciphertext).not.toContain(password);
    expect(
      JSON.parse(
        connectionCredentials.open(connections[0]!.id, {
          version: credential!.keyVersion,
          ciphertext: credential!.ciphertext,
        }),
      ),
    ).toEqual({ username: lea.address, password });

    // Testing SMTP authenticates without sending: no mail reached the mailbox or its Sent folder.
    expect(await mail.messages(lea, "INBOX")).toEqual([]);
    expect(await mail.messages(lea, "Sent")).toEqual([]);
  });

  it("keeps one Email Connection per student", async () => {
    const cookie = await signUp("email-twice");
    const connect = () =>
      post("/api/me/connections/email", cookie, {
        address: lea.address,
        password,
        servers: servers(),
        folders: ["INBOX"],
      });
    expect((await connect()).status).toBe(201);

    const again = await connect();

    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "already_connected" });
    expect((await storedFor(cookie)).connections).toHaveLength(1);
  });

  it("names Lesen (IMAP) when the login fails, and stores nothing", async () => {
    const cookie = await signUp("email-imap-fails");

    for (const path of [
      "/api/me/connections/email/test",
      "/api/me/connections/email",
    ]) {
      const response = await post(path, cookie, {
        address: lea.address,
        password: "falsch",
        servers: servers(),
        folders: ["INBOX"],
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: "login_failed",
        step: "imap",
      });
    }
    expect(await storedFor(cookie)).toEqual({
      connections: [],
      credentials: [],
    });
  });

  it("names Senden (SMTP) when sending fails, and stores nothing", async () => {
    const cookie = await signUp("email-smtp-fails");
    const closed = await startSmtpFaultServer("refuse-connection");

    const response = await post("/api/me/connections/email", cookie, {
      address: lea.address,
      password,
      servers: { imap: mail.imap.implicitTls, smtp: closed },
      folders: ["INBOX"],
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "login_failed",
      step: "smtp",
    });
    expect(await storedFor(cookie)).toEqual({
      connections: [],
      credentials: [],
    });
  });

  it("refuses a host on a private address outside INTEGRATION_FAKES", async () => {
    const strict = createApp({
      ...appDeps,
      connections: createConnections({
        db: prisma,
        keys: createSourceKeys({
          activeVersion: "test",
          masters: { test: randomBytes(32) },
        }),
        credentials: connectionCredentials,
        fakes: false,
      }),
    });
    const cookie = await signUp("email-private-host");

    for (const path of [
      "/api/me/connections/email/test",
      "/api/me/connections/email",
    ]) {
      const privateHost = await post(
        path,
        cookie,
        {
          address: lea.address,
          password,
          servers: {
            imap: { host: "127.0.0.1", port: 993 },
            smtp: { host: "localhost", port: 465 },
          },
          folders: ["INBOX"],
        },
        strict,
      );
      expect(privateHost.status).toBe(422);
      expect(await privateHost.json()).toEqual({ error: "server_refused" });
    }

    // The fake's own port is refused too: TLS only on 993 and 143, 465 and 587.
    const otherPort = await post(
      "/api/me/connections/email/test",
      cookie,
      { address: lea.address, password, servers: servers() },
      strict,
    );
    expect(otherPort.status).toBe(422);
    expect(await otherPort.json()).toEqual({ error: "port_refused" });
    expect(await storedFor(cookie)).toEqual({
      connections: [],
      credentials: [],
    });
  });

  it("needs servers for an unknown domain and refuses one nunio can't connect yet", async () => {
    const cookie = await signUp("email-unknown");

    const unknown = await post("/api/me/connections/email/test", cookie, {
      address: "lea@cs.example",
      password,
    });
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toEqual({ error: "servers_required" });

    const unsupported = await post("/api/me/connections/email", cookie, {
      address: "lea@hsbi.de",
      password,
      folders: ["INBOX"],
    });
    expect(unsupported.status).toBe(422);
    expect(await unsupported.json()).toEqual({ error: "unsupported" });
  });

  it("refuses a folder the mailbox doesn't have", async () => {
    const cookie = await signUp("email-unknown-folder");

    const response = await post("/api/me/connections/email", cookie, {
      address: lea.address,
      password,
      servers: servers(),
      folders: ["INBOX", "Privat"],
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "unknown_folder" });
    expect(await storedFor(cookie)).toEqual({
      connections: [],
      credentials: [],
    });
  });

  it("refuses connecting while Email isn't offered", async () => {
    const cookie = await signUp("email-hidden");
    await admin.integration.update({
      where: { key: "email" },
      data: { status: "hidden" },
    });
    try {
      const response = await post("/api/me/connections/email", cookie, {
        address: lea.address,
        password,
        servers: servers(),
        folders: ["INBOX"],
      });
      expect(response.status).toBe(404);
      expect(await storedFor(cookie)).toEqual({
        connections: [],
        credentials: [],
      });
    } finally {
      await admin.integration.update({
        where: { key: "email" },
        data: { status: "offered" },
      });
    }
  });

  it("needs a signed-in student", async () => {
    const response = await app.request(
      `${apiOrigin}/api/me/connections/email/discover`,
      {
        method: "POST",
        headers: { origin: appOrigin, "content-type": "application/json" },
        body: JSON.stringify({ address: lea.address }),
      },
    );
    expect(response.status).toBe(401);
  });
});
