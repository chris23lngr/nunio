import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth, type Auth } from "./auth.js";

const origin = "http://localhost:3000";
const password = "correct horse battery staple";
// Unique per run, so reruns against a persistent database (a Neon branch) don't collide.
const run = Date.now().toString(36);
const email = (name: string) => `${name}+${run}@example.com`;

let db: TestDatabase;
let prisma: PrismaClient;
let auth: Auth;

beforeAll(async () => {
  db = await startTestDatabase();
  prisma = createPrismaClient(createPool(db.connectionString));
  auth = createAuth({
    prisma,
    baseURL: origin,
    trustedOrigins: [origin],
    secret: "spike-a-test-secret-that-is-long-enough",
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

function call(path: string, init: { body?: unknown; cookie?: string } = {}) {
  const headers = new Headers({ origin });
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return auth.handler(
    new Request(`${origin}/api/auth${path}`, {
      method: init.body === undefined ? "GET" : "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

/** Every cookie the response sets, as a browser would send them back. */
function sessionCookie(res: Response): string {
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]!);
  if (!cookies.some((c) => c.startsWith("better-auth.session_token="))) {
    throw new Error(`no session cookie (status ${res.status})`);
  }
  return cookies.join("; ");
}

async function sessionEmail(cookie: string): Promise<string | null> {
  const res = await call("/get-session", { cookie });
  const body = (await res.json()) as { user: { email: string } } | null;
  return body?.user.email ?? null;
}

describe("email and password sessions", () => {
  it("signs up a new user and finds their session", async () => {
    const res = await call("/sign-up/email", {
      body: { name: "Ada", email: email("ada"), password },
    });

    expect(res.status).toBe(200);
    expect(await sessionEmail(sessionCookie(res))).toBe(email("ada"));
  });

  it("signs in with the right password and refuses the wrong one", async () => {
    await call("/sign-up/email", {
      body: { name: "Grace", email: email("grace"), password },
    });

    const wrong = await call("/sign-in/email", {
      body: { email: email("grace"), password: "not the password" },
    });
    expect(wrong.status).toBe(401);
    expect(wrong.headers.getSetCookie()).toEqual([]);

    const right = await call("/sign-in/email", {
      body: { email: email("grace"), password },
    });
    expect(right.status).toBe(200);
    expect(await sessionEmail(sessionCookie(right))).toBe(email("grace"));
  });

  it("revokes the session on sign-out, even for a replayed cookie", async () => {
    const signUp = await call("/sign-up/email", {
      body: { name: "Alan", email: email("alan"), password },
    });
    const cookie = sessionCookie(signUp);

    const signOut = await call("/sign-out", { body: {}, cookie });
    expect(signOut.status).toBe(200);

    expect(await sessionEmail(cookie)).toBeNull();
  });

  it("revokes one session by token and leaves the user's others working", async () => {
    await call("/sign-up/email", {
      body: { name: "Edsger", email: email("edsger"), password },
    });
    const signIn = () =>
      call("/sign-in/email", { body: { email: email("edsger"), password } });
    const laptop = sessionCookie(await signIn());
    const phone = sessionCookie(await signIn());

    const phoneHeaders = new Headers({ cookie: phone });
    const laptopSession = await auth.api.getSession({
      headers: new Headers({ cookie: laptop }),
    });
    await auth.api.revokeSession({
      headers: phoneHeaders,
      body: { token: laptopSession!.session.token },
    });

    expect(await auth.api.getSession({ headers: new Headers({ cookie: laptop }) })).toBeNull();
    expect((await auth.api.getSession({ headers: phoneHeaders }))?.user.email).toBe(
      email("edsger"),
    );
  });
});
