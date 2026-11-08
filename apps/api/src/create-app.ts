import type { Answerer } from "@nunio/ai";
import { createAnswerer, createEmbedder, createModels } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { Delegation } from "@nunio/delegation";
import { createDelegation } from "@nunio/delegation";
import type { Auth } from "@nunio/identity";
import { createAuth } from "@nunio/identity";
import { sourceKeysFromEnv } from "@nunio/keys";
import type { Chats, Facts, Sources } from "@nunio/knowledge";
import {
  createChats,
  createFacts,
  createKnowledgeReader,
  createSources,
  sourceStorageFromEnv,
} from "@nunio/knowledge";
import { attachDatabasePool } from "@vercel/functions";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppBindings } from "./app.js";
import { routes } from "./app.js";
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
  sourceWorkflows: SourceWorkflows;
  chats: Chats;
  answerer: Answerer;
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
  sourceWorkflows,
  chats,
  answerer,
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
    c.set("sourceWorkflows", sourceWorkflows);
    c.set("chats", chats);
    c.set("answerer", answerer);
    await next();
  });
  app.route("/", routes);
  if (spike) app.route("/", spikeRoutes(spike));
  return app;
}

/** Builds the app from its deployment environment; throws on the first missing variable. */
export function appFromEnv(env: NodeJS.ProcessEnv) {
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
    secret: required("BETTER_AUTH_SECRET"),
    trustedOrigins: [appOrigin],
    cookieDomain: env.COOKIE_DOMAIN,
    email: {
      projectId: required("SCW_PROJECT_ID"),
      secretKey: required("SCW_SECRET_KEY"),
      from: required("AUTH_EMAIL_FROM"),
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
  const reader = createKnowledgeReader({
    db: prisma,
    keys,
    embedder: createEmbedder(provider),
    delegation,
    clock,
  });
  return createApp({
    auth,
    prisma,
    delegation,
    appOrigin,
    spike,
    sources,
    facts,
    sourceWorkflows: sourceWorkflowsFromEnv(env),
    chats: createChats({ db: prisma, keys, reader, delegation }),
    answerer: createAnswerer(createModels(provider)),
  });
}
