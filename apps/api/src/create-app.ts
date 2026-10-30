import { createPool, createPrismaClient } from "@nunio/db";
import { createAuth, type Auth } from "@nunio/identity";
import { attachDatabasePool } from "@vercel/functions";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { routes } from "./app.js";
import { spikePoolHeader, spikeRoutes, type SpikeDeps } from "./spike.js";

export interface AppDeps {
  auth: Auth;
  /** The only browser origin allowed to call the API with credentials (ADR-0005). */
  appOrigin: string;
  /** Mounts the spike c routes when set. */
  spike?: SpikeDeps;
}

export function createApp({ auth, appOrigin, spike }: AppDeps) {
  const app = new Hono();
  app.use("*", cors({ origin: appOrigin, credentials: true }));
  if (spike) app.use("*", spikePoolHeader(spike.pool));
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
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
  const auth = createAuth({
    prisma: createPrismaClient(pool),
    baseURL: required("BETTER_AUTH_URL"),
    secret: required("BETTER_AUTH_SECRET"),
    trustedOrigins: [appOrigin],
    cookieDomain: env.COOKIE_DOMAIN,
  });
  const spike =
    env.SPIKE_ROUTES === "true" ? { webhookSecret: required("SPIKE_WEBHOOK_SECRET"), pool } : undefined;
  return createApp({ auth, appOrigin, spike });
}
