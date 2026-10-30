import { execFile } from "node:child_process";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPool, createPrismaClient, type Pool, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { createAuth } from "@nunio/identity";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./create-app.js";

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
let admin: PrismaClient;
let app: ReturnType<typeof createApp>;
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
      projectId: "test-project", secretKey: "test-key", from: "accounts@nunio.test",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const body = await request.json() as { to: { email: string }[]; text: string };
        verificationLinks.set(body.to[0]!.email, body.text.match(/https?:\/\/\S+/)![0]);
        return Response.json({ emails: [{ id: "test-email" }] }, { status: 201 });
      },
    },
  });
  app = createApp({ auth, prisma, appOrigin, spike: { webhookSecret, pool } });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

function call(path: string, init: { origin: string; body?: unknown; cookie?: string; invitation?: string }) {
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
  await admin.invitation.create({ data: {
    tokenHash: createHash("sha256").update(invitation).digest("hex"),
    email: `${name}+${run}@example.com`,
    issuedBy: "api-test-operator",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  } });
  const res = await call("/sign-up/email", {
    origin: appOrigin,
    invitation,
    body: { name, email: `${name}+${run}@example.com`, password },
  });
  expect(res.status).toBe(200);
  const verified = await app.request(verificationLinks.get(`${name}+${run}@example.com`)!);
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
  return execute(process.execPath, [fileURLToPath(import.meta.resolve("@nunio/billing/revoke-pilot")), studentId], {
    env: { PATH: process.env.PATH, OPERATOR_DATABASE_URL: db.connectionString, OPERATOR_ID: operator },
  });
}

async function studentId(cookie: string): Promise<string> {
  const response = await call("/get-session", { origin: appOrigin, cookie });
  const session = await response.json() as { user: { id: string } };
  return session.user.id;
}

describe("the student's pilot entitlement", () => {
  it("does not activate pilot access while email verification is still pending", async () => {
    const address = `pilot-pending+${run}@example.com`;
    const invitation = randomBytes(32).toString("base64url");
    await admin.invitation.create({ data: {
      tokenHash: createHash("sha256").update(invitation).digest("hex"),
      email: address,
      issuedBy: "api-test-operator",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    } });
    const signup = await call("/sign-up/email", {
      origin: appOrigin, invitation,
      body: { name: "Pending pilot", email: address, password },
    });
    expect(signup.status).toBe(200);
    const pending = await signup.json() as { user: { id: string } };

    await expect(revokePilot(pending.user.id)).rejects.toMatchObject({
      code: 1, stdout: "", stderr: expect.stringContaining("Pilot entitlement not found"),
    });
  });

  it("activates pilot access for an invited student after email verification", async () => {
    const cookie = await signUp("pilot-active");
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "active" });
  });

  it("recovers pilot activation on sign-in after verification's activation failed", async () => {
    const address = `pilot-activation-retry+${run}@example.com`;
    const invitation = randomBytes(32).toString("base64url");
    await admin.invitation.create({ data: {
      tokenHash: createHash("sha256").update(invitation).digest("hex"),
      email: address,
      issuedBy: "api-test-operator",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    } });
    const signup = await call("/sign-up/email", {
      origin: appOrigin, invitation,
      body: { name: "Activation retry", email: address, password },
    });
    expect(signup.status).toBe(200);
    const pending = await signup.json() as { user: { id: string } };
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
    const signIn = await call("/sign-in/email", { origin: appOrigin, body: { email: address, password } });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.getSetCookie().map(value => value.split(";")[0]!).join("; ");
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "active" });
  });

  it("requires a current session even when the caller supplies a student ID", async () => {
    const response = await app.request(`${apiOrigin}/api/me/entitlement?studentId=someone-else`, {
      headers: { "x-student-id": "someone-else" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects a previously valid cookie after sign-out", async () => {
    const cookie = await signUp("pilot-signed-out");
    const signOut = await call("/sign-out", { origin: appOrigin, cookie, body: {} });
    expect(signOut.status).toBe(200);

    const response = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie } });
    expect(response.status).toBe(401);
  });

  it("refuses an existing session when its account is no longer verified", async () => {
    const cookie = await signUp("pilot-unverified");
    // A legacy session must not authorize access using an obsolete verified flag.
    await admin.user.update({
      where: { email: `pilot-unverified+${run}@example.com` },
      data: { emailVerified: false },
    });

    const response = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie } });
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
      const cookie = signIn.headers.getSetCookie().map(value => value.split(";")[0]!).join("; ");
      const response = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie } });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "active" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not grant pilot access to a verified account that never accepted an invitation", async () => {
    const address = `pilot-legacy+${run}@example.com`;
    const studentId = randomUUID();
    await admin.user.create({ data: {
      id: studentId, name: "Legacy", email: address, emailVerified: true,
      accounts: { create: {
        id: randomUUID(), accountId: studentId, providerId: "credential", password: await hashPassword(password),
      } },
    } });
    const signIn = await call("/sign-in/email", { origin: appOrigin, body: { email: address, password } });
    expect(signIn.status).toBe(200);
    const cookie = signIn.headers.getSetCookie().map(value => value.split(";")[0]!).join("; ");
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "none" });
  });

  it("lets the founder revoke access immediately while preserving the student's session", async () => {
    const cookie = await signUp("pilot-revoked");
    const id = await studentId(cookie);
    const active = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie } });
    expect(await active.json()).toEqual({ status: "active" });
    const before = Date.now();
    const { stdout } = await revokePilot(id, "founder-revocation-test");
    const record = JSON.parse(stdout) as { studentId: string; revokedAt: string; revokedBy: string };

    expect(record.studentId).toBe(id);
    expect(record.revokedBy).toBe("founder-revocation-test");
    expect(Date.parse(record.revokedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(record.revokedAt)).toBeLessThanOrEqual(Date.now());
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie } });
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
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie } });
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
    const newCookie = signIn.headers.getSetCookie().map(value => value.split(";")[0]!).join("; ");
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie: newCookie } });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "revoked" });
    const repeated = await revokePilot(id, "another-operator");
    expect(JSON.parse(repeated.stdout)).toEqual(JSON.parse(original.stdout));
  });

  it("refuses an unaudited revocation and leaves pilot access active", async () => {
    const cookie = await signUp("pilot-no-operator");
    const id = await studentId(cookie);

    await expect(revokePilot(id, "")).rejects.toMatchObject({
      code: 1, stdout: "", stderr: expect.stringContaining("OPERATOR_ID"),
    });
    const response = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie } });
    expect(await response.json()).toEqual({ status: "active" });
  });

  it("does not reactivate revoked pilot access when the verification link is revisited", async () => {
    const cookie = await signUp("pilot-verify-again");
    await revokePilot(await studentId(cookie));
    const verified = await app.request(verificationLinks.get(`pilot-verify-again+${run}@example.com`)!);
    expect(verified.status).toBe(302);

    const response = await app.request(`${apiOrigin}/api/me/entitlement`, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "revoked" });
  });

  it("refuses to revoke a pilot entitlement that does not exist", async () => {
    await expect(revokePilot("missing-student")).rejects.toMatchObject({
      code: 1, stdout: "", stderr: expect.stringContaining("Pilot entitlement not found"),
    });
  });
});

async function signIn(name: string): Promise<string> {
  const response = await call("/sign-in/email", {
    origin: appOrigin, body: { email: `${name}+${run}@example.com`, password },
  });
  expect(response.status).toBe(200);
  return response.headers.getSetCookie().map(value => value.split(";")[0]!).join("; ");
}

describe("the student's sessions", () => {
  it("lists the student's sessions and revokes one without ending the others", async () => {
    const laptop = await signUp("sessions-revoke-one");
    const phone = await signIn("sessions-revoke-one");
    const listed = await call("/list-sessions", { origin: appOrigin, cookie: laptop });
    const sessions = await listed.json() as { token: string }[];
    expect(sessions).toHaveLength(2);
    const phoneSession = await (await call("/get-session", { origin: appOrigin, cookie: phone })).json() as {
      session: { token: string };
    };

    const revoked = await call("/revoke-session", {
      origin: appOrigin, cookie: laptop, body: { token: phoneSession.session.token },
    });

    expect(revoked.status).toBe(200);
    expect(await (await call("/get-session", { origin: appOrigin, cookie: phone })).json()).toBeNull();
    expect(await studentId(laptop)).toBeTruthy();
  });

  it("cannot revoke another student's session by its token", async () => {
    const mallory = await signUp("sessions-mallory");
    const victim = await signUp("sessions-victim");
    const victimSession = await (await call("/get-session", { origin: appOrigin, cookie: victim })).json() as {
      session: { token: string };
    };

    await call("/revoke-session", { origin: appOrigin, cookie: mallory, body: { token: victimSession.session.token } });

    expect(await studentId(victim)).toBeTruthy();
  });

  it("signs the student out everywhere", async () => {
    const laptop = await signUp("sessions-everywhere");
    const phone = await signIn("sessions-everywhere");

    const revoked = await call("/revoke-sessions", { origin: appOrigin, cookie: laptop, body: {} });

    expect(revoked.status).toBe(200);
    for (const cookie of [laptop, phone]) {
      expect(await (await call("/get-session", { origin: appOrigin, cookie })).json()).toBeNull();
    }
  });

  it("refuses signing out everywhere from an untrusted origin", async () => {
    const cookie = await signUp("sessions-forged-everywhere");

    const forged = await call("/revoke-sessions", { origin: evilOrigin, cookie, body: {} });

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
      expect(await (await call("/get-session", { origin: appOrigin, cookie })).json()).toBeNull();
    }
  });

  it("refuses the request without the student's password and keeps their sessions", async () => {
    const cookie = await signUp("deletion-wrong-password");

    const response = await requestDeletion(cookie, { password: "not the password" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid_password" });
    expect(await studentId(cookie)).toBeTruthy();
    await signIn("deletion-wrong-password");
  });

  it("refuses signing in again once deletion is requested", async () => {
    const cookie = await signUp("deletion-sign-in");
    expect((await requestDeletion(cookie, { password })).status).toBe(202);

    const response = await call("/sign-in/email", {
      origin: appOrigin, body: { email: `deletion-sign-in+${run}@example.com`, password },
    });

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie().filter(value => value.includes("session_token=") && !value.includes("Max-Age=0")))
      .toEqual([]);
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

describe("the spike pool header", () => {
  it("reports the serving instance's pool on a database request", async () => {
    const cookie = await signUp("pool-reader");
    const res = await call("/get-session", { origin: appOrigin, cookie });
    expect(res.headers.get("x-spike-instance")).toMatch(/^[0-9a-f-]{36}$/);
    // Before the handler: the sign-up's connection is still idle in the pool (5 s timeout).
    expect(res.headers.get("x-spike-pool-before")).toMatch(/^total=([1-9]\d*) idle=\1 waiting=0$/);
    // Every connection is back in the pool by the time the response leaves.
    expect(res.headers.get("x-spike-pool")).toMatch(/^total=([1-9]\d*) idle=\1 waiting=0$/);
  });
});

describe("the spike raw-body route", () => {
  const signedBody = '{"id":"evt_1","type":"invoice.paid","amount":1999}';
  const signature = createHmac("sha256", webhookSecret).update(signedBody).digest("hex");

  const post = (body: string) =>
    app.request(`${apiOrigin}/spike/raw-body`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-spike-signature": signature },
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
    const res = await post('{"type":"invoice.paid","id":"evt_1","amount":1999}');
    expect(res.status).toBe(401);
  });
});
