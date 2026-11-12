import { execFile } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type {
  Answerer,
  AnswerInput,
  Embedder,
  Estimator,
  Grader,
  Maker,
} from "@nunio/ai";
import type { Artifacts } from "@nunio/artifacts";
import { createArtifacts } from "@nunio/artifacts";
import { createChats } from "@nunio/chat";
import type { Pool, PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type {
  CatalogModel,
  Delegation,
  Executor,
  Responsibilities,
  Schedules,
} from "@nunio/delegation";
import {
  createDelegation,
  createModelCatalog,
  createResponsibilities,
  principal,
} from "@nunio/delegation";
import { createAuth } from "@nunio/identity";
import { createSourceKeys } from "@nunio/keys";
import type { Facts, Sources } from "@nunio/knowledge";
import {
  createCourses,
  createFacts,
  createKnowledgeReader,
  createProjects,
  createSources,
} from "@nunio/knowledge";
import { createOutreach } from "@nunio/outreach";
import { createPlan } from "@nunio/planning";
import { createUnderstanding } from "@nunio/understanding";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ArtifactWorkflows } from "./artifact-workflows.js";
import { createChatModels } from "./chat-models.js";
import { createApp } from "./create-app.js";
import type { RunWorkflows } from "./run-workflows.js";

const appOrigin = "https://app.nunio.test";
const apiOrigin = "https://api.nunio.test";
const evilOrigin = "https://evil.test";
const password = "correct horse battery staple";
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
let sources: Sources;
let facts: Facts;
let delegation: Delegation;
let responsibilities: Responsibilities;
let artifacts: Artifacts;
/** The Artifact Runs the API asked to start, by run ID; the worker would then make each. */
const artifactRuns: string[] = [];
const artifactWorkflows: ArtifactWorkflows = {
  start: async (runId) => void artifactRuns.push(runId),
};
const maker: Maker = {
  estimateMicroUsd: () => 1,
  practiceSet: async (input) => ({
    value: {
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
/** What the API asked of Responsibility Schedules, and which Runs it woke, in order. */
const scheduled: string[] = [];
const signalled: { workflowId: string; runId: string; actionId: string }[] = [];
const runWorkflows: RunWorkflows = {
  signalDecided: async (run, actionId) =>
    void signalled.push({ ...run, actionId }),
};
const schedules: Schedules = {
  create: async ({ responsibilityId }) =>
    void scheduled.push(`create ${responsibilityId}`),
  pause: async (id) => void scheduled.push(`pause ${id}`),
  unpause: async (id) => void scheduled.push(`unpause ${id}`),
  delete: async (id) => void scheduled.push(`delete ${id}`),
};
/** What the answer model was asked, and what it replies next. */
const prompts: AnswerInput[] = [];
let reply = "";
let reasoningText: string | undefined;
let finishAnswer: Promise<void> | undefined;
/** The Models Chat answers were asked of, in order. */
const answeredWith: CatalogModel[] = [];
const answerer: Answerer = {
  modelKey: "sonnet-5.5-reasoning-high",
  estimateMicroUsd: () => 1,
  async answer(input, { signal, onText, onReasoning }) {
    prompts.push(input);
    await onReasoning?.("Ich prüfe deine Materialien.", true);
    await onReasoning?.("", false);
    await onText?.(reply);
    await finishAnswer;
    signal.throwIfAborted();
    return {
      value: {
        text: reply,
        ...(reasoningText ? { reasoning: reasoningText } : {}),
        cited: [...reply.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]!),
      },
      usage: { microUsd: 1 },
    };
  },
};
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
const verificationLinks = new Map<string, string>();

beforeAll(async () => {
  db = await startTestDatabase();
  pool = createPool(db.runtimeConnectionString);
  prisma = createPrismaClient(pool);
  admin = createPrismaClient(createPool(db.connectionString));
  const auth = createAuth({
    prisma,
    baseURL: apiOrigin,
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
        verificationLinks.set(
          body.to[0]!.email,
          body.text.match(/https?:\/\/\S+/)![0],
        );
        return Response.json(
          { emails: [{ id: "test-email" }] },
          { status: 201 },
        );
      },
    },
  });
  delegation = createDelegation({ db: prisma, aiEnabled: () => true });
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
  const reader = createKnowledgeReader({
    db: prisma,
    keys,
    embedder: chatEmbedder,
    delegation,
    clock: { now: () => new Date() },
  });
  const chats = createChats({ db: prisma, keys, reader, delegation });
  const plan = createPlan({
    db: prisma,
    facts,
    clock: { now: () => new Date() },
  });
  responsibilities = createResponsibilities({
    db: prisma,
    schedules,
    clock: { now: () => new Date() },
  });
  artifacts = createArtifacts({
    db: prisma,
    keys,
    reader,
    facts,
    responsibilities,
    delegation,
    maker,
    clock: { now: () => new Date() },
  });
  app = createApp({
    artifacts,
    artifactWorkflows,
    understanding: createUnderstanding({
      db: prisma,
      keys,
      artifacts,
      reader,
      facts,
      delegation,
      grader,
      clock: { now: () => new Date() },
    }),
    responsibilities,
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
        return { ...answerer, modelKey: model.key };
      },
    }),
    plan,
    estimator,
    projects: createProjects({ db: prisma }),
    courses: createCourses({
      db: prisma,
      clock: { now: () => new Date() },
      facts,
      responsibilities,
    }),
    outreach: createOutreach({
      db: prisma,
      clock: { now: () => new Date() },
      vapidPublicKey: "test-vapid-key",
      unsubscribeSecret: "test-unsubscribe-secret",
    }),
    sourceWorkflows: {
      start: async (...args) => {
        if (workflowsDown) throw new Error("Temporal unavailable");
        started.push(args);
      },
    },
    spike: { webhookSecret, pool },
  });
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

async function signUp(name: string): Promise<string> {
  const invitation = randomBytes(32).toString("base64url");
  await admin.invitation.create({
    data: {
      tokenHash: createHash("sha256").update(invitation).digest("hex"),
      email: `${name}+${run}@example.com`,
      issuedBy: "api-test-operator",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  const res = await call("/sign-up/email", {
    origin: appOrigin,
    invitation,
    body: { name, email: `${name}+${run}@example.com`, password },
  });
  expect(res.status).toBe(200);
  const verified = await app.request(
    verificationLinks.get(`${name}+${run}@example.com`)!,
  );
  expect(verified.status).toBe(302);
  const signIn = await call("/sign-in/email", {
    origin: appOrigin,
    body: { email: `${name}+${run}@example.com`, password },
  });
  expect(signIn.status).toBe(200);
  return signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");
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
  it("does not activate pilot access while email verification is still pending", async () => {
    const address = `pilot-pending+${run}@example.com`;
    const invitation = randomBytes(32).toString("base64url");
    await admin.invitation.create({
      data: {
        tokenHash: createHash("sha256").update(invitation).digest("hex"),
        email: address,
        issuedBy: "api-test-operator",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const signup = await call("/sign-up/email", {
      origin: appOrigin,
      invitation,
      body: { name: "Pending pilot", email: address, password },
    });
    expect(signup.status).toBe(200);
    const pending = (await signup.json()) as { user: { id: string } };

    await expect(revokePilot(pending.user.id)).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("Pilot entitlement not found"),
    });
  });

  it("activates pilot access for an invited student after email verification", async () => {
    const cookie = await signUp("pilot-active");
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "active" });
  });

  it("recovers pilot activation on sign-in after verification's activation failed", async () => {
    const address = `pilot-activation-retry+${run}@example.com`;
    const invitation = randomBytes(32).toString("base64url");
    await admin.invitation.create({
      data: {
        tokenHash: createHash("sha256").update(invitation).digest("hex"),
        email: address,
        issuedBy: "api-test-operator",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const signup = await call("/sign-up/email", {
      origin: appOrigin,
      invitation,
      body: { name: "Activation retry", email: address, password },
    });
    expect(signup.status).toBe(200);
    const pending = (await signup.json()) as { user: { id: string } };
    const verification = verificationLinks.get(address)!;
    await admin.$executeRaw`CREATE FUNCTION reject_pilot_activation_test() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'temporary pilot activation failure'; END; $$`;
    try {
      // Scope the injected database fault to this student, including on a shared test branch.
      const id = pending.user.id.replaceAll("'", "''");
      await admin.$executeRawUnsafe(`CREATE TRIGGER reject_pilot_activation_test
        BEFORE INSERT ON "pilot_entitlement" FOR EACH ROW
        WHEN (NEW."studentId" = '${id}') EXECUTE FUNCTION reject_pilot_activation_test()`);
      expect((await app.request(verification)).status).toBe(500);
    } finally {
      await admin.$executeRaw`DROP TRIGGER IF EXISTS reject_pilot_activation_test ON "pilot_entitlement"`;
      await admin.$executeRaw`DROP FUNCTION reject_pilot_activation_test()`;
    }
    expect((await app.request(verification)).status).toBe(302);
    const signIn = await call("/sign-in/email", {
      origin: appOrigin,
      body: { email: address, password },
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0]!)
      .join("; ");
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie },
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
      const signIn = await call("/sign-in/email", {
        origin: appOrigin,
        body: { email: `pilot-indefinite+${run}@example.com`, password },
      });
      expect(signIn.status).toBe(200);
      const cookie = signIn.headers
        .getSetCookie()
        .map((value) => value.split(";")[0]!)
        .join("; ");
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
        accounts: {
          create: {
            id: randomUUID(),
            accountId: studentId,
            providerId: "credential",
            password: await hashPassword(password),
          },
        },
      },
    });
    const signIn = await call("/sign-in/email", {
      origin: appOrigin,
      body: { email: address, password },
    });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0]!)
      .join("; ");
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
    const signIn = await call("/sign-in/email", {
      origin: appOrigin,
      body: { email: `pilot-revoked-login+${run}@example.com`, password },
    });
    expect(signIn.status).toBe(200);
    const newCookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0]!)
      .join("; ");
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

  it("does not reactivate revoked pilot access when the verification link is revisited", async () => {
    const cookie = await signUp("pilot-verify-again");
    await revokePilot(await studentId(cookie));
    const verified = await app.request(
      verificationLinks.get(`pilot-verify-again+${run}@example.com`)!,
    );
    expect(verified.status).toBe(302);

    const response = await app.request(`${apiOrigin}/api/me/entitlement`, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "revoked" });
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
  const response = await call("/sign-in/email", {
    origin: appOrigin,
    body: { email: `${name}+${run}@example.com`, password },
  });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0]!)
    .join("; ");
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
        accounts: {
          create: {
            id: randomUUID(),
            accountId: id,
            providerId: "credential",
            password: await hashPassword(password),
          },
        },
      },
    });
    const signIn = await call("/sign-in/email", {
      origin: appOrigin,
      body: { email: address, password },
    });
    const cookie = signIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0]!)
      .join("; ");

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

  it("signs the student out everywhere", async () => {
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
});

describe("the student's deletion request", () => {
  function requestDeletion(cookie: string, body: unknown, origin = appOrigin) {
    return app.request(`${apiOrigin}/api/me/deletion-request`, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("accepts the request with the student's password and ends every session", async () => {
    const laptop = await signUp("deletion-requested");
    const phone = await signIn("deletion-requested");

    const response = await requestDeletion(laptop, { password });

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

  it("refuses the request without the student's password and keeps their sessions", async () => {
    const cookie = await signUp("deletion-wrong-password");

    const response = await requestDeletion(cookie, {
      password: "not the password",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid_password" });
    expect(await studentId(cookie)).toBeTruthy();
    await signIn("deletion-wrong-password");
  });

  it("limits password attempts per student, refusing even the right password once exceeded", async () => {
    const cookie = await signUp("deletion-guessing");
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(
        (await requestDeletion(cookie, { password: `guess ${attempt}` }))
          .status,
      ).toBe(403);
    }

    const limited = await requestDeletion(cookie, { password: "guess 3" });
    const right = await requestDeletion(cookie, { password });

    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "too_many_requests" });
    expect(right.status).toBe(429);
    expect(await studentId(cookie)).toBeTruthy();
  });

  it("admits only three concurrent password attempts per student", async () => {
    const cookie = await signUp("deletion-concurrent-guessing");

    const statuses = (
      await Promise.all(
        Array.from({ length: 8 }, (_, attempt) =>
          requestDeletion(cookie, { password: `guess ${attempt}` }),
        ),
      )
    ).map((response) => response.status);

    expect(statuses.filter((status) => status === 403)).toHaveLength(3);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  });

  it("refuses signing in again once deletion is requested", async () => {
    const cookie = await signUp("deletion-sign-in");
    expect((await requestDeletion(cookie, { password })).status).toBe(202);

    const response = await call("/sign-in/email", {
      origin: appOrigin,
      body: { email: `deletion-sign-in+${run}@example.com`, password },
    });

    expect(response.status).toBe(403);
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

    const forged = await requestDeletion(cookie, { password }, evilOrigin);

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
      app.request(`${apiOrigin}/api/auth/sign-in/email`, {
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
async function reviewFixture(name: string) {
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
          facts: [],
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
  expect((await review()).courses).toEqual([
    expect.objectContaining({ id: into!.id, status: "accepted" }),
  ]);
  expect((await merge(from!.id, into!.id)).status).toBe(404);
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
async function sseChunks(response: Response) {
  return (await response.text())
    .split("\n\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)));
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

describe("Chat", () => {
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
      "reasoning-start",
      "reasoning-delta",
      "reasoning-end",
      "text-start",
      "text-delta",
      "text-end",
      "data-committed",
      "finish",
    ]);
    expect(chunks.find((chunk) => chunk.type === "reasoning-delta").delta).toBe(
      "Ich prüfe deine Materialien.",
    );
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
    const turn = (await (
      await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "Meine erste Frage" }),
      })
    ).json()) as { id: string; question: { id: string }; createdAt: string };
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
    prompts.length = 0;

    const created = await app.request(`${apiOrigin}/api/me/chats`, {
      method: "POST",
      headers,
      body: JSON.stringify({ courseIds: [], sourceIds: [selected] }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const asked = await app.request(
      `${apiOrigin}/api/me/chats/${id}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "Wann ist die Klausur?" }),
      },
    );

    expect([asked.status, await asked.json()]).toEqual([
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
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({
      question: "Wann ist die Klausur?",
      tags: ["S1"],
    });
    expect(prompts[0]!.data).toContain("Die Klausur ist am 10. Februar.");
    expect(prompts[0]!.data).not.toContain("private Notiz");
    expect(prompts[0]!.data).not.toContain("anderen Studenten");
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
    await app.request(`${apiOrigin}/api/me/chats/${id}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "Wann ist die Klausur?" }),
    });
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
        citations: [],
        model: null,
      },
      {
        id: expect.any(String),
        createdAt: expect.any(String),
        role: "assistant",
        text: "Am 10. Februar [S1].",
        reasoning: "Die Quelle nennt den Prüfungstermin.",
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
          row.reasoningContent &&
          Buffer.from(row.reasoningContent)
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
        citations: [],
        model: null,
      },
      {
        id: expect.any(String),
        createdAt: expect.any(String),
        role: "assistant",
        text: null,
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

    const refused = await app.request(
      `${apiOrigin}/api/me/chats/${id}/messages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ text: "Wann ist die Klausur?" }),
      },
    );

    expect([refused.status, await refused.json()]).toEqual([
      403,
      { error: "allowance_exhausted" },
    ]);
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
    },
  ]);
  expect(await (await call("GET", `/${id}/impact`)).json()).toEqual({
    obligations: 0,
    tasks: 0,
    studyBlocks: 0,
    futureStudyBlocks: 0,
    responsibilities: 0,
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

it("refuses Obligations and Responsibilities on an Archived Course with a conflict", async () => {
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
  const responsibility = await app.request(
    `${apiOrigin}/api/me/responsibilities`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        preset: "keep_course_organized",
        courseId: id,
        budgetMicroUsd: 100_000,
      }),
    },
  );
  expect(responsibility.status).toBe(409);
  expect(await responsibility.json()).toEqual({ error: "course_archived" });
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
 * A student whose "keep this course organized" Run asked to move a block they placed: the Run's workflow is waiting.
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
  await admin.studyBlock.create({
    data: {
      id: blockId,
      studentId: id,
      obligationId,
      placedBy,
      start: new Date("2099-01-01T09:00:00Z"),
      end: new Date("2099-01-01T10:00:00Z"),
    },
  });
  const created = await responsibilities.create(
    principal.fromSession({ studentId: id }),
    {
      preset: "keep_course_organized",
      courseId,
      budgetMicroUsd: 1_000_000,
    },
  );
  if (created.status !== "ok") throw new Error(created.status);
  const runId = randomUUID(),
    workflowId = `run/${created.id}-2099-01-01T06:00:00Z`;
  await responsibilities.startRun({
    studentId: id,
    responsibilityId: created.id,
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
  });
  const outcome = await gate.perform(principal.fromRun(runId), {
    key: `${runId}:1`,
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
    responsibilityId: created.id,
    blockId,
    obligationId,
  };
}

describe("Approvals", () => {
  it.each(["approve", "deny"] as const)(
    "saves %s while Temporal is unavailable and later delivers its wake without another click",
    async (decision) => {
      const asked = await askedForApproval(`approval-unavailable-${decision}`);
      const signal = vi
        .spyOn(runWorkflows, "signalDecided")
        .mockRejectedValueOnce(new Error("Temporal unavailable"));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const response = await app.request(
          `${apiOrigin}/api/me/approvals/${asked.asking.actionId}`,
          {
            method: "POST",
            headers: asked.headers,
            body: JSON.stringify(
              decision === "approve"
                ? { decision, fingerprint: asked.asking.fingerprint }
                : { decision },
            ),
          },
        );
        expect(response.status).toBe(200);
        expect(signal).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalled();
        expect(signalled).not.toContainEqual(
          expect.objectContaining({ actionId: asked.asking.actionId }),
        );
        await delegation.reconcile(({ workflowId, runId, actionId }) =>
          runWorkflows.signalDecided({ workflowId, runId }, actionId),
        );
        expect(signalled).toContainEqual({
          workflowId: asked.workflowId,
          runId: asked.runId,
          actionId: asked.asking.actionId,
        });
        expect(signal).toHaveBeenCalledTimes(2);
        await delegation.reconcile(({ workflowId, runId, actionId }) =>
          runWorkflows.signalDecided({ workflowId, runId }, actionId),
        );
        expect(signal).toHaveBeenCalledTimes(2);
      } finally {
        signal.mockRestore();
        log.mockRestore();
      }
    },
  );

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
        },
        fingerprint: asked.asking.fingerprint,
        expiresAt: asked.asking.expiresAt.toISOString(),
        responsibility: {
          id: asked.responsibilityId,
          preset: "keep_course_organized",
        },
      },
    ]);
  });

  it("records an Approval of the fingerprint the student was shown, then wakes the Run", async () => {
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
    expect(signalled).toContainEqual({
      workflowId: asked.workflowId,
      runId: asked.runId,
      actionId: asked.asking.actionId,
    });
    expect(
      (
        await delegation.history(
          principal.fromSession({ studentId: await studentId(asked.cookie) }),
          {},
        )
      )[0],
    ).toMatchObject({ approval: { decision: "approved" } });
  });

  it("refuses an Approval of any other fingerprint and wakes no Run", async () => {
    const asked = await askedForApproval("approval-stale");
    const before = signalled.length;

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
    expect(signalled).toHaveLength(before);
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

  it("records a denial and wakes the Run, which then takes no Action", async () => {
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
    expect(signalled).toContainEqual({
      workflowId: asked.workflowId,
      runId: asked.runId,
      actionId: asked.asking.actionId,
    });
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

describe("Responsibilities", () => {
  it("keeps an empty Course identifiable in its Responsibility detail, list and Home", async () => {
    const cookie = await signUp("responsibility-empty-course");
    const courseId = randomUUID();
    await admin.course.create({
      data: {
        id: courseId,
        studentId: await studentId(cookie),
        title: "Analysis I",
        matchTitle: "analysis i",
        semester: "2026-ws",
        color: "rose",
        status: "accepted",
      },
    });
    const response = await app.request(`${apiOrigin}/api/me/responsibilities`, {
      method: "POST",
      headers: {
        cookie,
        origin: appOrigin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ preset: "keep_course_organized", courseId }),
    });
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const course = { id: courseId, title: "Analysis I" };
    const detail = await app.request(
      `${apiOrigin}/api/me/responsibilities/${id}`,
      { headers: { cookie } },
    );
    const list = await app.request(`${apiOrigin}/api/me/responsibilities`, {
      headers: { cookie },
    });
    const home = await app.request(`${apiOrigin}/api/me/home`, {
      headers: { cookie },
    });
    expect(await detail.json()).toMatchObject({ id, course });
    expect(await list.json()).toEqual([
      expect.objectContaining({ id, course }),
    ]);
    expect(await home.json()).toMatchObject({
      agentWork: [expect.objectContaining({ id, course: "Analysis I" })],
    });
  });

  it("delegates 'keep this course organized' and shows its scope, Grants, Budget and next planned Action", async () => {
    const s = await withCourse("responsibility-create");

    const created = await app.request(`${apiOrigin}/api/me/responsibilities`, {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({
        preset: "keep_course_organized",
        courseId: s.courseId,
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const shown = await app.request(
      `${apiOrigin}/api/me/responsibilities/${id}`,
      { headers: { cookie: s.cookie } },
    );

    expect(scheduled).toContain(`create ${id}`);
    expect(shown.status).toBe(200);
    const body = (await shown.json()) as { next: { runAt: string } };
    expect(body).toMatchObject({
      id,
      preset: "keep_course_organized",
      course: { id: s.courseId, title: "Analysis I" },
      state: "active",
      pausedBy: null,
      grants: ["studyBlock.create", "studyBlock.move"],
      budget: { limitMicroUsd: 1_000_000, usedMicroUsd: 0, heldMicroUsd: 0 },
      recentActions: [],
      next: {
        action: {
          kind: "studyBlock.create",
          work: { title: "Problem sheet 1", course: "Analysis I" },
        },
      },
    });
    // The next Run starts at 06:00 in the student's time zone, within a day.
    const runAt = new Date(body.next.runAt);
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

  it("pauses, resumes and ends through its Schedule, and lists it with its state", async () => {
    const s = await withCourse("responsibility-control");
    const { id } = (await (
      await app.request(`${apiOrigin}/api/me/responsibilities`, {
        method: "POST",
        headers: s.headers,
        body: JSON.stringify({
          preset: "keep_course_organized",
          courseId: s.courseId,
        }),
      })
    ).json()) as { id: string };
    const control = (action: string) =>
      app.request(`${apiOrigin}/api/me/responsibilities/${id}/${action}`, {
        method: "POST",
        headers: s.headers,
      });
    const shown = async () =>
      (await (
        await app.request(`${apiOrigin}/api/me/responsibilities/${id}`, {
          headers: { cookie: s.cookie },
        })
      ).json()) as object;

    expect((await control("pause")).status).toBe(200);
    expect(await shown()).toMatchObject({
      state: "paused",
      pausedBy: "student",
      next: { runAt: null, action: null },
    });
    expect((await control("resume")).status).toBe(200);
    expect(await shown()).toMatchObject({ state: "active", pausedBy: null });
    expect((await control("end")).status).toBe(200);
    expect(await shown()).toMatchObject({ state: "ended", grants: [] });
    expect((await control("resume")).status).toBe(404);

    expect(scheduled.filter((call) => call.endsWith(id))).toEqual([
      `create ${id}`,
      `pause ${id}`,
      `unpause ${id}`,
      `delete ${id}`,
    ]);
    const listed = await app.request(`${apiOrigin}/api/me/responsibilities`, {
      headers: { cookie: s.cookie },
    });
    expect(await listed.json()).toEqual([
      {
        id,
        preset: "keep_course_organized",
        course: { id: s.courseId, title: "Analysis I" },
        exam: null,
        state: "ended",
        pausedBy: null,
      },
    ]);
  });

  it("show on Home as Agent work: the Approvals waiting first, then each Responsibility", async () => {
    const asked = await askedForApproval("responsibility-home");

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
          kind: "responsibility",
          id: asked.responsibilityId,
          preset: "keep_course_organized",
          course: "Analysis I",
          exam: null,
          state: "active",
        },
      ],
    );
  });

  it("shows its recent Actions on its screen, each as the exact Action", async () => {
    const asked = await askedForApproval("responsibility-recent");

    const shown = await app.request(
      `${apiOrigin}/api/me/responsibilities/${asked.responsibilityId}`,
      { headers: { cookie: asked.cookie } },
    );

    expect(
      ((await shown.json()) as { recentActions: unknown[] }).recentActions,
    ).toEqual([
      {
        id: asked.asking.actionId,
        status: "awaiting_approval",
        refusal: null,
        at: expect.any(String),
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
        },
      },
    ]);
  });
});

describe("'prepare me for this exam'", () => {
  it("is delegated for one exam, which its screen and the list name, and never for other work", async () => {
    const s = await withCourse("responsibility-exam");
    const exam = await facts.enterObligation(
      principal.fromSession({ studentId: await studentId(s.cookie) }),
      {
        course: { id: s.courseId },
        kind: "exam",
        title: "Klausur",
        due: { date: "2099-02-01", time: "10:00", timeZone: null },
        destination: null,
      },
    );
    if (exam.status !== "ok") throw new Error(exam.status);
    const delegate = (obligationId: string) =>
      app.request(`${apiOrigin}/api/me/responsibilities`, {
        method: "POST",
        headers: s.headers,
        body: JSON.stringify({ preset: "prepare_for_exam", obligationId }),
      });

    expect((await delegate(s.obligationId)).status).toBe(404);
    const created = await delegate(exam.id);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const shown = await app.request(
      `${apiOrigin}/api/me/responsibilities/${id}`,
      { headers: { cookie: s.cookie } },
    );
    expect(await shown.json()).toMatchObject({
      preset: "prepare_for_exam",
      course: { id: s.courseId, title: "Analysis I" },
      exam: { id: exam.id, title: "Klausur" },
      grants: ["studyBlock.create", "studyBlock.move"],
    });
    const listed = await app.request(`${apiOrigin}/api/me/responsibilities`, {
      headers: { cookie: s.cookie },
    });
    expect(await listed.json()).toEqual([
      expect.objectContaining({
        id,
        preset: "prepare_for_exam",
        exam: { id: exam.id, title: "Klausur" },
      }),
    ]);
    const home = await app.request(`${apiOrigin}/api/me/home`, {
      headers: { cookie: s.cookie },
    });
    expect(((await home.json()) as { agentWork: unknown[] }).agentWork).toEqual(
      [
        {
          kind: "responsibility",
          id,
          preset: "prepare_for_exam",
          course: "Analysis I",
          exam: "Klausur",
          state: "active",
        },
      ],
    );
  });
});

describe("one-click unsubscribe from Briefing emails", () => {
  /** RFC 8058: a mail provider POSTs this, with no cookie and no Origin of ours. */
  const unsubscribe = (s: string, t: string, method = "POST") =>
    app.request(`${apiOrigin}/unsubscribe/briefing-email?s=${s}&t=${t}`, {
      method,
      headers:
        method === "POST"
          ? { "content-type": "application/x-www-form-urlencoded" }
          : {},
      body: method === "POST" ? "List-Unsubscribe=One-Click" : undefined,
    });
  const tokenFor = (id: string) =>
    createHmac("sha256", "test-unsubscribe-secret").update(id).digest("hex");
  const settingsOf = async (cookie: string) =>
    (await (
      await app.request(`${apiOrigin}/api/me/outreach-settings`, {
        headers: { cookie },
      })
    ).json()) as { briefingEmail: boolean; email: boolean };

  it("stops Briefing emails without a session, answering without a redirect", async () => {
    const cookie = await signUp("unsubscribe-one-click");
    const id = await studentId(cookie);

    const response = await unsubscribe(id, tokenFor(id));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(await settingsOf(cookie)).toEqual(
      expect.objectContaining({ briefingEmail: false, email: true }),
    );
  });

  it("refuses a link that was not signed for the student, and ignores a GET", async () => {
    const cookie = await signUp("unsubscribe-refused");
    const id = await studentId(cookie);

    expect((await unsubscribe(id, "0".repeat(64))).status).toBe(403);
    expect((await unsubscribe(id, tokenFor(id), "GET")).status).not.toBe(200);
    expect(await settingsOf(cookie)).toEqual(
      expect.objectContaining({ briefingEmail: true }),
    );
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
          responsibilities: [],
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
    await app.request(
      `${apiOrigin}/api/me/approvals/${asked.asking.actionId}`,
      {
        method: "POST",
        headers: asked.headers,
        body: JSON.stringify({ decision: "deny" }),
      },
    );
    expect(await stateNow()).toBe("denied");
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

  it("grades the student's Attempts, records Self-assessments, and shows each Topic's Level and Evidence", async () => {
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

    const attempted = await s.send("/api/me/attempts", {
      artifactId,
      itemId: "1",
      text: "Konvergenz.",
    });
    const body = (await attempted.json()) as {
      status: string;
      attempt: { id: string };
    };
    expect([attempted.status, body]).toEqual([
      201,
      {
        status: "graded",
        attempt: expect.objectContaining({
          text: "Konvergenz.",
          verdict: "correct",
          feedback: expect.objectContaining({ text: "Richtig [S1]." }),
        }),
      },
    ]);
    expect(await levels()).toEqual([
      expect.objectContaining({ topicId: s.topicId, level: "shaky" }),
    ]);
    expect(
      (
        await s.send(`/api/me/topics/${s.topicId}/self-assessment`, {
          level: "solid",
        })
      ).status,
    ).toBe(200);
    expect(await levels()).toEqual([
      expect.objectContaining({
        level: "disputed",
        fromAttempts: "shaky",
        selfAssessment: "solid",
      }),
    ]);
    expect(
      await (await s.get(`/api/me/topics/${s.topicId}/evidence`)).json(),
    ).toEqual([
      expect.objectContaining({ kind: "self_assessment", level: "solid" }),
      expect.objectContaining({ kind: "attempt" }),
    ]);
    const regraded = await s.send(
      `/api/me/attempts/${body.attempt.id}/grade`,
      {},
    );
    expect([regraded.status, await regraded.json()]).toEqual([
      200,
      expect.objectContaining({ id: body.attempt.id, verdict: "correct" }),
    ]);

    const other = await studyFixture("study-practice-other");
    expect(
      (
        await other.send("/api/me/attempts", {
          artifactId,
          itemId: "1",
          text: "Fremd.",
        })
      ).status,
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
