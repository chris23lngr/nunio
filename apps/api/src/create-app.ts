import type { Answerer, Estimator, SeriesAssigner } from "@nunio/ai";
import {
  createAnswerer,
  createBuilderModel,
  createEmbedder,
  createEstimator,
  createGrader,
  createMaker,
  createModels,
  createSeriesAssigner,
} from "@nunio/ai";
import type { Artifacts } from "@nunio/artifacts";
import { createArtifacts } from "@nunio/artifacts";
import type { Activity, Builder, Chats } from "@nunio/chat";
import { createActivity, createBuilder, createChats } from "@nunio/chat";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { Agents, Delegation } from "@nunio/delegation";
import {
  createAgents,
  createDelegation,
  createModelCatalog,
  principal,
} from "@nunio/delegation";
import type { Auth } from "@nunio/identity";
import { createAuth } from "@nunio/identity";
import type { Catalog, Connections } from "@nunio/integrations";
import {
  createCatalog,
  createConnections,
  integrationFakes,
} from "@nunio/integrations";
import {
  connectionCredentialKeysFromEnv,
  sourceKeysFromEnv,
} from "@nunio/keys";
import type {
  Courses,
  Facts,
  Projects,
  Sources,
  TopicAreas,
} from "@nunio/knowledge";
import {
  createCourses,
  createFacts,
  createKnowledgeReader,
  createProjects,
  createSources,
  createTopicAreas,
  sourceStorageFromEnv,
} from "@nunio/knowledge";
import type { Outreach } from "@nunio/outreach";
import { createOutreach } from "@nunio/outreach";
import type { Plan } from "@nunio/planning";
import { createPlan, createPlanExecutor, planRules } from "@nunio/planning";
import type { Understanding } from "@nunio/understanding";
import { createUnderstanding } from "@nunio/understanding";
import { attachDatabasePool } from "@vercel/functions";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppBindings } from "./app.js";
import { routes } from "./app.js";
import type { ArtifactWorkflows } from "./artifact-workflows.js";
import { artifactWorkflowsFromEnv } from "./artifact-workflows.js";
import type { ChatModels } from "./chat-models.js";
import { createChatModels } from "./chat-models.js";
import type { RunWorkflows } from "./run-workflows.js";
import { runWorkflowsFromEnv } from "./run-workflows.js";
import type { SourceWorkflows } from "./source-workflows.js";
import { sourceWorkflowsFromEnv } from "./source-workflows.js";
import type { SpikeDeps } from "./spike.js";
import { spikePoolHeader, spikeRoutes } from "./spike.js";

export interface AppDeps {
  auth: Auth;
  prisma: PrismaClient;
  delegation: Delegation;
  sources: Sources;
  facts: Facts;
  topicAreas: TopicAreas;
  sourceWorkflows: SourceWorkflows;
  chats: Chats;
  chatModels: ChatModels;
  /** The AI builder panel, and its task Model (`taskModels.builder`). */
  builder: Builder;
  builderModel: Answerer;
  plan: Plan;
  estimator: Estimator;
  seriesAssigner: SeriesAssigner;
  projects: Projects;
  courses: Courses;
  agents: Agents;
  /** An Agent's Runs as the student reads them. */
  activity: Activity;
  runWorkflows: RunWorkflows;
  outreach: Outreach;
  artifacts: Artifacts;
  artifactWorkflows: ArtifactWorkflows;
  understanding: Understanding;
  integrationCatalog: Catalog;
  connections: Connections;
  /** The only browser origin allowed to call the API with credentials (ADR-0005). */
  appOrigin: string;
  /** Mounts the spike c routes when set. */
  spike?: SpikeDeps;
}

export function createApp({
  auth,
  prisma,
  delegation,
  appOrigin,
  spike,
  sources,
  facts,
  topicAreas,
  sourceWorkflows,
  chats,
  chatModels,
  builder,
  builderModel,
  plan,
  estimator,
  seriesAssigner,
  projects,
  courses,
  agents,
  activity,
  runWorkflows,
  outreach,
  artifacts,
  artifactWorkflows,
  understanding,
  integrationCatalog,
  connections,
}: AppDeps) {
  const app = new Hono<AppBindings>();
  app.use("*", cors({ origin: appOrigin, credentials: true }));
  if (spike) app.use("*", spikePoolHeader(spike.pool));
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.use("/api/me/*", async (c, next) => {
    // CORS alone does not stop a forged request from reaching the handler.
    if (
      !["GET", "HEAD"].includes(c.req.method) &&
      c.req.header("origin") !== appOrigin
    ) {
      return c.json({ error: "forbidden_origin" }, 403);
    }
    await next();
  });
  app.use("/api/me/*", async (c, next) => {
    c.set("auth", auth);
    c.set("prisma", prisma);
    c.set("delegation", delegation);
    c.set("sources", sources);
    c.set("facts", facts);
    c.set("topicAreas", topicAreas);
    c.set("sourceWorkflows", sourceWorkflows);
    c.set("chats", chats);
    c.set("chatModels", chatModels);
    c.set("builder", builder);
    c.set("builderModel", builderModel);
    c.set("plan", plan);
    c.set("estimator", estimator);
    c.set("seriesAssigner", seriesAssigner);
    c.set("projects", projects);
    c.set("courses", courses);
    c.set("agents", agents);
    c.set("activity", activity);
    c.set("runWorkflows", runWorkflows);
    c.set("outreach", outreach);
    c.set("artifacts", artifacts);
    c.set("artifactWorkflows", artifactWorkflows);
    c.set("understanding", understanding);
    c.set("integrationCatalog", integrationCatalog);
    c.set("connections", connections);
    c.set("appOrigin", appOrigin);
    await next();
  });
  // nunio's Client ID Metadata Document is public: vendors fetch it without a session.
  app.use("/oauth/*", async (c, next) => {
    c.set("connections", connections);
    await next();
  });
  app.route("/", routes);
  if (spike) app.route("/", spikeRoutes(spike));
  return app;
}

/** Builds the app from its deployment environment; throws on the first missing variable. */
/** Reads the Model Catalog once at start, so a task whose Model is missing stops the API from starting. */
export async function appFromEnv(
  env: NodeJS.ProcessEnv,
  { emailFetch }: { emailFetch?: typeof fetch } = {},
) {
  // Refuses to start a deployment that has the test fakes switched on.
  const fakes = integrationFakes(env);
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const appOrigin = required("APP_ORIGIN");
  const pool = createPool(required("DATABASE_URL"));
  // On Vercel Fluid compute, keeps the instance alive until idle clients are released, so
  // connections are reused across invocations and none leak when it suspends. No-op elsewhere.
  attachDatabasePool(pool);
  const prisma = createPrismaClient(pool);
  const auth = createAuth({
    prisma,
    baseURL: required("BETTER_AUTH_URL"),
    appOrigin,
    secret: required("BETTER_AUTH_SECRET"),
    trustedOrigins: [appOrigin],
    cookieDomain: env.COOKIE_DOMAIN,
    email: {
      projectId: required("SCW_PROJECT_ID"),
      secretKey: required("SCW_SECRET_KEY"),
      from: required("AUTH_EMAIL_FROM"),
      ...(emailFetch && { fetch: emailFetch }),
    },
  });
  const spike =
    env.SPIKE_ROUTES === "true"
      ? { webhookSecret: required("SPIKE_WEBHOOK_SECRET"), pool }
      : undefined;
  // The global AI kill switch; like every variable, a change takes effect on the next deployment.
  const delegation = createDelegation({
    db: prisma,
    aiEnabled: () => env.AI_DISABLED !== "true",
    // A Chat's Action has no Run, so the API performs it once the student approves (ADR-0019).
    executors: { plan: createPlanExecutor({ db: prisma }) },
    // What the Plan's rules refuse for a free-text Agent's Study Block Actions (ADR-0001).
    planRules,
    deadlineOf: async (studentId, obligationId) =>
      (await plan.view(principal.fromSession({ studentId }))).obligations.find(
        (o) => o.id === obligationId,
      )?.due ?? null,
  });
  const keys = sourceKeysFromEnv(env);
  const sources = createSources({
    db: prisma,
    keys,
    storage: sourceStorageFromEnv(env),
  });
  const clock = { now: () => new Date() };
  const facts = createFacts({ db: prisma, keys, clock });
  const provider = {
    apiKey: required("OPENROUTER_API_KEY"),
    baseURL: required("OPENROUTER_BASE_URL"),
  };
  const catalog = createModelCatalog({ db: prisma, clock });
  const models = createModels({
    ...provider,
    catalog: await catalog.taskModels(),
  });
  const reader = createKnowledgeReader({
    db: prisma,
    keys,
    embedder: createEmbedder(provider),
    delegation,
    clock,
  });
  const { runWorkflows, schedules } = runWorkflowsFromEnv(env);

  const plan = createPlan({ db: prisma, facts, clock });
  const agents = createAgents({
    db: prisma,
    schedules,
    clock,
    runAlive: (workflowId) => runWorkflows.agentRunAlive(workflowId),
  });
  const artifactWorkflows = artifactWorkflowsFromEnv(env);
  const artifacts = createArtifacts({
    db: prisma,
    keys,
    reader,
    facts,
    agents,
    delegation,
    maker: createMaker(models),
    clock,
  });
  const understanding = createUnderstanding({
    db: prisma,
    keys,
    artifacts,
    reader,
    facts,
    delegation,
    grader: createGrader(models),
    clock,
  });
  return createApp({
    auth,
    prisma,
    delegation,
    agents,
    activity: createActivity({ db: prisma, keys, facts, clock }),
    runWorkflows,
    appOrigin,
    spike,
    sources,
    facts,
    topicAreas: createTopicAreas({ db: prisma, facts, clock }),
    sourceWorkflows: sourceWorkflowsFromEnv(env),
    chats: createChats({
      db: prisma,
      keys,
      reader,
      delegation,
      plan,
      clock,
      artifacts,
      understanding,
      startArtifactRun: (runId) => artifactWorkflows.start(runId),
    }),
    chatModels: createChatModels({
      catalog,
      answererFor: (model) => createAnswerer(models.fromConfig(model)),
    }),
    builder: createBuilder({ db: prisma, delegation }),
    builderModel: createBuilderModel(models.forTask("builder")),
    plan,
    estimator: createEstimator(models),
    seriesAssigner: createSeriesAssigner(models),
    projects: createProjects({ db: prisma }),
    courses: createCourses({ db: prisma, clock, facts, agents }),
    artifacts,
    artifactWorkflows,
    understanding,
    integrationCatalog: createCatalog({ db: prisma }),
    connections: createConnections({
      db: prisma,
      keys,
      credentials: connectionCredentialKeysFromEnv(env),
      fakes,
      apiOrigin: required("BETTER_AUTH_URL"),
    }),
    // Only the worker sends; the API reads the Inbox and settings, and holds no notification key.
    outreach: createOutreach({
      db: prisma,
      keys,
      clock,
      vapidPublicKey: required("VAPID_PUBLIC_KEY"),
    }),
  });
}
