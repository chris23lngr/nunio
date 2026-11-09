import { createHash, randomBytes } from "node:crypto";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAuth, type Auth } from "./auth.js";

const origin = "http://localhost:3000";
const password = "correct horse battery staple";
// Unique per run, so reruns against a persistent database (a Neon branch) don't collide.
const run = Date.now().toString(36);
const email = (name: string) => `${name}+${run}@example.com`;

let db: TestDatabase;
/** The restricted runtime role the deployed API uses. */
let prisma: PrismaClient;
/** The migration role, for fixtures outside RLS. */
let admin: PrismaClient;
let auth: Auth;
const messages: { url: string; headers: Headers; body: { to: { email: string }[]; text: string; project_id: string } }[] = [];
let mailStatus = 201;

beforeAll(async () => {
  db = await startTestDatabase();
  prisma = createPrismaClient(createPool(db.runtimeConnectionString));
  admin = createPrismaClient(createPool(db.connectionString));
  auth = createAuth({
    prisma,
    baseURL: origin,
    trustedOrigins: [origin],
    secret: "spike-a-test-secret-that-is-long-enough",
    email: {
      projectId: "test-project",
      secretKey: "test-scaleway-key",
      from: "accounts@nunio.test",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        messages.push({ url: request.url, headers: request.headers, body: await request.json() as (typeof messages)[number]["body"] });
        return Response.json({ emails: [{ id: "test-email" }] }, { status: mailStatus });
      },
    },
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

function call(path: string, init: { body?: unknown; cookie?: string; invitation?: string } = {}) {
  const headers = new Headers({ origin });
  if (init.invitation) headers.set("x-invitation-token", init.invitation);
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

async function invite(email: string, expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), acceptedAt: Date | null = null) {
  const token = randomBytes(32).toString("base64url");
  await admin.invitation.create({ data: {
    tokenHash: createHash("sha256").update(token).digest("hex"),
    email: email.toLowerCase(),
    issuedBy: "test-operator",
    expiresAt,
    acceptedAt,
  } });
  return token;
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

async function verifyEmail(address: string) {
  const message = messages.findLast(message => message.body.to[0]?.email === address
    && message.body.text.includes("/api/auth/verify-email?"));
  const link = message?.body.text.match(/https?:\/\/\S+/)?.[0];
  if (!link) throw new Error("Verification email was not sent");
  const response = await auth.handler(new Request(link));
  expect(response.status).toBe(302);
  expect(response.headers.getSetCookie()).toEqual([]);
}

async function requestPasswordReset(address: string) {
  const response = await call("/request-password-reset", {
    body: { email: address, redirectTo: `${origin}/reset-password` },
  });
  expect(response.status).toBe(200);
  const message = messages.findLast(message => message.body.to[0]?.email === address)!;
  const link = message.body.text.match(/https?:\/\/\S+/)![0];
  const landing = await auth.handler(new Request(link));
  expect(landing.status).toBe(302);
  return new URL(landing.headers.get("location")!).searchParams.get("token")!;
}

describe("email and password sessions", () => {
  it("remembers sessions for 30 days and uses a session cookie when unchecked", async () => {
    const address = email("remember-me");
    await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Remember me", email: address, password },
    });
    await verifyEmail(address);

    for (const rememberMe of [true, false]) {
      const before = Date.now();
      const response = await call("/sign-in/email", { body: { email: address, password, rememberMe } });
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie().find(value => value.startsWith("better-auth.session_token="))!;
      if (rememberMe) expect(cookie).toContain("Max-Age=2592000");
      else expect(cookie).not.toMatch(/Max-Age=|Expires=/i);
      const session = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie(response) }), query: { disableRefresh: true } });
      const duration = (rememberMe ? 30 : 1) * 24 * 60 * 60 * 1000;
      expect(session!.session.expiresAt.getTime()).toBeGreaterThanOrEqual(before + duration - 1000);
      expect(session!.session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + duration);
    }
  });

  it("changes the password and revokes all sessions after an emailed reset", async () => {
    const address = email("password-reset");
    await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Password reset", email: address, password },
    });
    await verifyEmail(address);
    const signIn = () => call("/sign-in/email", { body: { email: address, password } });
    const laptop = sessionCookie(await signIn());
    const phone = sessionCookie(await signIn());
    const requested = await call("/request-password-reset", {
      body: { email: address, redirectTo: `${origin}/reset-password` },
    });
    expect(requested.status).toBe(200);
    const message = messages.findLast(message => message.body.to[0]?.email === address)!;
    const link = message.body.text.match(/https?:\/\/\S+/)![0];
    const landing = await auth.handler(new Request(link));
    expect(landing.status).toBe(302);
    const target = new URL(landing.headers.get("location")!);
    expect(`${target.origin}${target.pathname}`).toBe(`${origin}/reset-password`);
    const newPassword = "a different correct horse battery staple";
    const reset = await call("/reset-password", {
      body: { token: target.searchParams.get("token"), newPassword },
    });

    expect(reset.status).toBe(200);
    expect(reset.headers.getSetCookie()).toEqual([]);
    expect(await sessionEmail(laptop)).toBeNull();
    expect(await sessionEmail(phone)).toBeNull();
    expect((await signIn()).status).toBe(401);
    const recovered = await call("/sign-in/email", { body: { email: address, password: newPassword } });
    expect(await sessionEmail(sessionCookie(recovered))).toBe(address);
  });

  it("does not allow an emailed reset token to be reused", async () => {
    const address = email("reset-once");
    await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Reset once", email: address, password },
    });
    await verifyEmail(address);
    const token = await requestPasswordReset(address);
    const newPassword = "the first replacement password";

    expect((await call("/reset-password", { body: { token, newPassword } })).status).toBe(200);
    expect((await call("/reset-password", {
      body: { token, newPassword: "an unauthorized replacement password" },
    })).status).toBe(400);
    expect((await call("/sign-in/email", { body: { email: address, password: newPassword } })).status).toBe(200);
  });

  it("rejects an expired reset token without changing the password", async () => {
    const address = email("reset-expired");
    await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Reset expired", email: address, password },
    });
    await verifyEmail(address);
    const token = await requestPasswordReset(address);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 3_601_000);
      const reset = await call("/reset-password", {
        body: { token, newPassword: "an expired replacement password" },
      });
      expect(reset.status).toBe(400);
    } finally {
      vi.useRealTimers();
    }
    expect((await call("/sign-in/email", { body: { email: address, password } })).status).toBe(200);
  });

  it("does not bypass email verification when a pending account resets its password", async () => {
    const address = email("reset-pending");
    await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Reset pending", email: address, password },
    });
    const token = await requestPasswordReset(address);
    const newPassword = "a pending replacement password";
    expect((await call("/reset-password", { body: { token, newPassword } })).status).toBe(200);
    expect((await call("/sign-in/email", { body: { email: address, password: newPassword } })).status).toBe(403);

    await verifyEmail(address);
    expect((await call("/sign-in/email", { body: { email: address, password: newPassword } })).status).toBe(200);
  });

  it("returns the same recovery response for known and unknown email addresses", async () => {
    const address = email("reset-known");
    const unknown = email("reset-unknown");
    await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Reset known", email: address, password },
    });
    const knownResponse = await call("/request-password-reset", {
      body: { email: address, redirectTo: `${origin}/reset-password` },
    });
    const unknownResponse = await call("/request-password-reset", {
      body: { email: unknown, redirectTo: `${origin}/reset-password` },
    });

    expect(knownResponse.status).toBe(200);
    expect(unknownResponse.status).toBe(200);
    expect(await unknownResponse.json()).toEqual(await knownResponse.json());
    expect(messages.some(message => message.body.to[0]?.email === unknown)).toBe(false);
  });

  it("refuses to send recovery links that redirect to an untrusted origin", async () => {
    const address = email("reset-redirect");
    await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Reset redirect", email: address, password },
    });
    const before = messages.length;
    const response = await call("/request-password-reset", {
      body: { email: address, redirectTo: "https://evil.test/reset-password" },
    });

    expect(response.status).toBe(403);
    expect(messages).toHaveLength(before);
  });

  it("sends the invited student a verification link through Scaleway in France", async () => {
    const address = email("delivery");
    const signUp = await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Delivery", email: address, password },
    });

    expect(signUp.status).toBe(200);
    expect(signUp.headers.getSetCookie()).toEqual([]);
    const message = messages.find(message => message.body.to[0]?.email === address);
    expect(message?.url).toBe("https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails");
    expect(message?.headers.get("x-auth-token")).toBe("test-scaleway-key");
    expect(message?.body.project_id).toBe("test-project");
    expect(message?.body.text).toContain(`${origin}/api/auth/verify-email?token=`);
  });

  it("does not let an invited student sign in before verifying their email", async () => {
    const address = email("pending");
    await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Pending", email: address, password },
    });
    const signIn = await call("/sign-in/email", { body: { email: address, password } });

    expect(signIn.status).toBe(403);
    expect(signIn.headers.getSetCookie()).toEqual([]);
  });

  it("resends verification for a pending account without requiring another invitation", async () => {
    const address = email("resend");
    await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Resend", email: address, password },
    });
    const before = messages.filter(message => message.body.to[0]?.email === address).length;
    const resend = await call("/send-verification-email", { body: { email: address, callbackURL: origin } });

    expect(resend.status).toBe(200);
    expect(messages.filter(message => message.body.to[0]?.email === address)).toHaveLength(before + 1);
    await verifyEmail(address);
    expect((await call("/sign-in/email", { body: { email: address, password } })).status).toBe(200);
  });

  it("keeps signup pending and allows resend after Scaleway rejects delivery", async () => {
    const address = email("delivery-retry");
    const invitation = await invite(address);
    const signup = () => call("/sign-up/email", {
      invitation,
      body: { name: "Delivery retry", email: address, password },
    });
    mailStatus = 503;
    try {
      const failed = await signup();
      expect(failed.status).toBe(200);
      expect(failed.headers.getSetCookie()).toEqual([]);
      expect((await call("/sign-in/email", { body: { email: address, password } })).status).toBe(403);
    } finally {
      mailStatus = 201;
    }
    const resend = await call("/send-verification-email", { body: { email: address, callbackURL: origin } });
    expect(resend.status).toBe(200);
    await verifyEmail(address);
    expect((await call("/sign-in/email", { body: { email: address, password } })).status).toBe(200);
  });

  it("keeps an account pending when its verification link has expired", async () => {
    const address = email("expired-verification");
    await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Expired verification", email: address, password },
    });
    const message = messages.find(message => message.body.to[0]?.email === address)!;
    const link = message.body.text.match(/https?:\/\/\S+/)![0];
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 3_601_000);
      const response = await auth.handler(new Request(link));
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location")!, origin);
      expect(location.searchParams.get("error")).toBe("TOKEN_EXPIRED");
    } finally {
      vi.useRealTimers();
    }
    expect((await call("/sign-in/email", { body: { email: address, password } })).status).toBe(403);
  });

  it("keeps an account pending when its verification token is modified", async () => {
    const address = email("tampered-verification");
    await call("/sign-up/email", {
      invitation: await invite(address),
      body: { name: "Tampered verification", email: address, password },
    });
    const message = messages.find(message => message.body.to[0]?.email === address)!;
    const link = new URL(message.body.text.match(/https?:\/\/\S+/)![0]);
    link.searchParams.set("token", `${link.searchParams.get("token")}x`);
    const response = await auth.handler(new Request(link));

    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!, origin).searchParams.get("error")).toBe("INVALID_TOKEN");
    expect((await call("/sign-in/email", { body: { email: address, password } })).status).toBe(403);
  });

  it("rejects registration without an invitation", async () => {
    const res = await call("/sign-up/email", {
      body: { name: "Uninvited", email: email("uninvited"), password },
    });

    expect(res.status).toBe(403);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("accepts an invitation and creates a session only after email verification", async () => {
    const res = await call("/sign-up/email", {
      invitation: await invite(email("ada")),
      body: { name: "Ada", email: email("ada"), password },
    });

    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([]);
    await verifyEmail(email("ada"));
    const signIn = await call("/sign-in/email", { body: { email: email("ada"), password } });
    expect(await sessionEmail(sessionCookie(signIn))).toBe(email("ada"));
  });

  it("rejects an invitation used for a different email", async () => {
    const invitation = await invite(email("intended"));
    const res = await call("/sign-up/email", {
      invitation,
      body: { name: "Other", email: email("other"), password },
    });

    expect(res.status).toBe(403);
  });

  it("rejects an expired invitation", async () => {
    const res = await call("/sign-up/email", {
      invitation: await invite(email("expired"), new Date(Date.now() - 1000)),
      body: { name: "Expired", email: email("expired"), password },
    });

    expect(res.status).toBe(403);
  });

  it("rejects a previously accepted invitation", async () => {
    const res = await call("/sign-up/email", {
      invitation: await invite(email("used"), undefined, new Date()),
      body: { name: "Used", email: email("used"), password },
    });

    expect(res.status).toBe(403);
  });

  it("rejects a modified invitation token", async () => {
    const invitation = await invite(email("tampered"));
    const res = await call("/sign-up/email", {
      invitation: `${invitation}x`,
      body: { name: "Tampered", email: email("tampered"), password },
    });

    expect(res.status).toBe(403);
  });

  it("signs in with the right password and refuses the wrong one", async () => {
    await call("/sign-up/email", {
      invitation: await invite(email("grace")),
      body: { name: "Grace", email: email("grace"), password },
    });
    await verifyEmail(email("grace"));

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
    await call("/sign-up/email", {
      invitation: await invite(email("alan")),
      body: { name: "Alan", email: email("alan"), password },
    });
    await verifyEmail(email("alan"));
    const signIn = await call("/sign-in/email", { body: { email: email("alan"), password } });
    const cookie = sessionCookie(signIn);

    const signOut = await call("/sign-out", { body: {}, cookie });
    expect(signOut.status).toBe(200);

    expect(await sessionEmail(cookie)).toBeNull();
  });

  it("revokes one session by token and leaves the user's others working", async () => {
    await call("/sign-up/email", {
      invitation: await invite(email("edsger")),
      body: { name: "Edsger", email: email("edsger"), password },
    });
    await verifyEmail(email("edsger"));
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
