import { createPrismaClient } from "@nunio/db";
import { createAuth, type Auth } from "@nunio/identity";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { routes } from "./app.js";

export interface AppDeps {
  auth: Auth;
  /** The only browser origin allowed to call the API with credentials (ADR-0005). */
  appOrigin: string;
}

export function createApp({ auth, appOrigin }: AppDeps) {
  const app = new Hono();
  app.use("*", cors({ origin: appOrigin, credentials: true }));
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.route("/", routes);
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
  const auth = createAuth({
    prisma: createPrismaClient(required("DATABASE_URL")),
    baseURL: required("BETTER_AUTH_URL"),
    secret: required("BETTER_AUTH_SECRET"),
    trustedOrigins: [appOrigin],
    cookieDomain: env.COOKIE_DOMAIN,
  });
  return createApp({ auth, appOrigin });
}
