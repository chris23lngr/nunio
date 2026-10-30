import { createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { createAuth } from "@nunio/identity";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./create-app.js";

const appOrigin = "https://app.nunio.test";
const apiOrigin = "https://api.nunio.test";
const evilOrigin = "https://evil.test";
const password = "correct horse battery staple";
const run = Date.now().toString(36);

let db: TestDatabase;
let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await startTestDatabase();
  prisma = createPrismaClient(db.connectionString);
  const auth = createAuth({
    prisma,
    baseURL: apiOrigin,
    trustedOrigins: [appOrigin],
    cookieDomain: "nunio.test",
    secret: "spike-b-test-secret-that-is-long-enough",
  });
  app = createApp({ auth, appOrigin });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

function call(path: string, init: { origin: string; body?: unknown; cookie?: string }) {
  const headers = new Headers({ origin: init.origin });
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return app.request(`${apiOrigin}/api/auth${path}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function signUp(name: string): Promise<string> {
  const res = await call("/sign-up/email", {
    origin: appOrigin,
    body: { name, email: `${name}+${run}@example.com`, password },
  });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");
}

describe("the API's auth routes from other origins", () => {
  it("refuses a cookie-bearing sign-out from an untrusted origin and keeps the session", async () => {
    const cookie = await signUp("mallory-target");

    const forged = await call("/sign-out", { origin: evilOrigin, body: {}, cookie });
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
    expect(fromApp.headers.get("access-control-allow-credentials")).toBe("true");

    const fromEvil = await preflight(evilOrigin);
    expect(fromEvil.headers.get("access-control-allow-origin")).not.toBe(evilOrigin);
    expect(fromEvil.headers.get("access-control-allow-origin")).not.toBe("*");
  });
});
