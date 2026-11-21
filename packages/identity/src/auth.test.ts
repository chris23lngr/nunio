import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Auth } from "./auth.js";
import { createAuth } from "./auth.js";

const origin = "http://localhost:3000";
// Unique per run, so reruns against a persistent database (a Neon branch) don't collide.
const run = Date.now().toString(36);
const email = (name: string) => `${name}+${run}@example.com`;

let db: TestDatabase;
/** The restricted runtime role the deployed API uses. */
let prisma: PrismaClient;
/** The migration role, for fixtures outside RLS. */
let admin: PrismaClient;
let auth: Auth;
const messages: {
  url: string;
  headers: Headers;
  body: { to: { email: string }[]; text: string; project_id: string };
}[] = [];
const mailStatus = 201;

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
        messages.push({
          url: request.url,
          headers: request.headers,
          body: (await request.json()) as (typeof messages)[number]["body"],
        });
        return Response.json(
          { emails: [{ id: "test-email" }] },
          { status: mailStatus },
        );
      },
    },
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

function call(
  path: string,
  init: { body?: unknown; cookie?: string; invitation?: string } = {},
) {
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

async function invite(
  email: string,
  expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  acceptedAt: Date | null = null,
) {
  const token = randomBytes(32).toString("base64url");
  await admin.invitation.create({
    data: {
      tokenHash: createHash("sha256").update(token).digest("hex"),
      email: email.toLowerCase(),
      issuedBy: "test-operator",
      expiresAt,
      acceptedAt,
    },
  });
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

afterEach(() => {
  vi.useRealTimers();
});

/** Moves the clock past the 60-second wait before another code to the same address. */
function skipResendWait() {
  if (!vi.isFakeTimers())
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(Date.now() + 61_000);
}

/** The code in the latest sign-in email to `address`. */
function lastCode(address: string): string {
  const message = messages.findLast(
    (message) => message.body.to[0]?.email === address,
  );
  const code = message?.body.text.match(/\b\d{6}\b/)?.[0];
  if (!code) throw new Error(`No sign-in code was sent to ${address}`);
  return code;
}

function sendCode(address: string) {
  return call("/email-otp/send-verification-otp", {
    body: { email: address, type: "sign-in" },
  });
}

function enterCode(
  address: string,
  otp: string,
  init: { invitation?: string; name?: string } = {},
) {
  return call("/sign-in/email-otp", {
    invitation: init.invitation,
    body: { email: address, otp, ...(init.name && { name: init.name }) },
  });
}

/** Sends a code to `address` and enters it, as the sign-in screen does. */
async function signInWithCode(
  address: string,
  init: { invitation?: string; name?: string } = {},
) {
  skipResendWait();
  expect((await sendCode(address)).status).toBe(200);
  return enterCode(address, lastCode(address), init);
}

/** Creates an invited student's account and returns its first session cookie. */
async function signUp(address: string) {
  const response = await signInWithCode(address, {
    invitation: await invite(address),
    name: "Student",
  });
  expect(response.status).toBe(200);
  return sessionCookie(response);
}

describe("sign-up with an emailed code", () => {
  it("creates an invited student's account with a verified address and a session", async () => {
    const address = email("ada");
    const invitation = await invite(address);
    const response = await signInWithCode(address, {
      invitation,
      name: "Ada",
    });

    expect(response.status).toBe(200);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: sessionCookie(response) }),
      query: { disableRefresh: true },
    });
    expect(session?.user).toMatchObject({
      email: address,
      name: "Ada",
      emailVerified: true,
    });
    const accepted = await admin.invitation.findFirst({
      where: { email: address },
    });
    expect(accepted?.acceptedAt).toBeInstanceOf(Date);
  });

  it("sends the code through Scaleway in France, without a link", async () => {
    const address = email("delivery");
    await invite(address);
    expect((await sendCode(address)).status).toBe(200);

    const message = messages.findLast(
      (message) => message.body.to[0]?.email === address,
    );
    expect(message?.url).toBe(
      "https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails",
    );
    expect(message?.headers.get("x-auth-token")).toBe("test-scaleway-key");
    expect(message?.body.project_id).toBe("test-project");
    expect(message?.body.text).toMatch(/\b\d{6}\b/);
    expect(message?.body.text).not.toMatch(/https?:\/\//);
  });
});

describe("who receives a code", () => {
  it("answers an address without an Invitation or account the same way, sending nothing", async () => {
    const invited = email("code-invited");
    const unknown = email("code-unknown");
    await invite(invited);
    const invitedResponse = await sendCode(invited);
    const unknownResponse = await sendCode(unknown);

    expect(unknownResponse.status).toBe(invitedResponse.status);
    expect(await unknownResponse.json()).toEqual(await invitedResponse.json());
    expect(
      messages.some((message) => message.body.to[0]?.email === unknown),
    ).toBe(false);
  });

  it("sends nothing for an expired or accepted Invitation", async () => {
    const expired = email("code-expired");
    const accepted = email("code-accepted");
    await invite(expired, new Date(Date.now() - 1000));
    await invite(accepted, undefined, new Date());
    await sendCode(expired);
    await sendCode(accepted);

    expect(
      messages.some((message) =>
        [expired, accepted].includes(message.body.to[0]?.email ?? ""),
      ),
    ).toBe(false);
  });

  it("signs an existing student in without an Invitation", async () => {
    const address = email("returning");
    await signUp(address);
    const response = await signInWithCode(address);

    expect(response.status).toBe(200);
    expect(await sessionEmail(sessionCookie(response))).toBe(address);
  });
});

describe("Invitations gate new accounts", () => {
  async function codeFor(address: string) {
    // A code reaches the address through its own Invitation; the account still needs a valid token.
    await invite(address);
    await sendCode(address);
    return lastCode(address);
  }

  it("rejects a new account without an Invitation token", async () => {
    const address = email("uninvited");
    const response = await enterCode(address, await codeFor(address));

    expect(response.status).toBe(403);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("rejects an Invitation issued for a different address", async () => {
    const address = email("other");
    const response = await enterCode(address, await codeFor(address), {
      invitation: await invite(email("intended")),
    });

    expect(response.status).toBe(403);
  });

  it("rejects an expired Invitation", async () => {
    const address = email("expired");
    const code = await codeFor(address);
    const response = await enterCode(address, code, {
      invitation: await invite(address, new Date(Date.now() - 1000)),
    });

    expect(response.status).toBe(403);
  });

  it("rejects a previously accepted Invitation", async () => {
    const address = email("used");
    const code = await codeFor(address);
    const response = await enterCode(address, code, {
      invitation: await invite(address, undefined, new Date()),
    });

    expect(response.status).toBe(403);
  });

  it("rejects a modified Invitation token", async () => {
    const address = email("tampered");
    const invitation = await invite(address);
    await sendCode(address);
    const response = await enterCode(address, lastCode(address), {
      invitation: `${invitation}x`,
    });

    expect(response.status).toBe(403);
  });

  it("leaves the Invitation unclaimed when creating the account fails", async () => {
    const address = email("insert-fails");
    const invitation = await invite(address);
    await sendCode(address);
    const code = lastCode(address);
    await admin.$executeRawUnsafe(`
      CREATE FUNCTION reject_insert_fails() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'insert failed'; END $$;
      CREATE TRIGGER reject_insert_fails BEFORE INSERT ON "user"
      FOR EACH ROW WHEN (NEW.email = '${address}') EXECUTE FUNCTION reject_insert_fails();
    `);
    try {
      const response = await enterCode(address, code, { invitation });
      expect(response.status).toBeGreaterThanOrEqual(400);
    } finally {
      await admin.$executeRawUnsafe(`
        DROP TRIGGER reject_insert_fails ON "user";
        DROP FUNCTION reject_insert_fails();
      `);
    }

    const unclaimed = await admin.invitation.findFirst({
      where: { email: address },
    });
    expect(unclaimed?.acceptedAt).toBeNull();
    expect((await signInWithCode(address, { invitation })).status).toBe(200);
  });
});

describe("guessing codes", () => {
  it("refuses a wrong code and accepts the right one", async () => {
    const address = email("grace");
    await signUp(address);
    skipResendWait();
    await sendCode(address);
    const code = lastCode(address);
    const wrong = code === "000000" ? "111111" : "000000";

    const refused = await enterCode(address, wrong);
    expect(refused.status).toBe(400);
    expect(refused.headers.getSetCookie()).toEqual([]);
    expect((await enterCode(address, code)).status).toBe(200);
  });

  it("invalidates a code after three wrong guesses", async () => {
    const address = email("three-guesses");
    await signUp(address);
    skipResendWait();
    await sendCode(address);
    const code = lastCode(address);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let guess = 0; guess < 3; guess++)
      expect((await enterCode(address, wrong)).status).toBe(400);

    expect((await enterCode(address, code)).status).not.toBe(200);
  });

  it("keeps a code valid for ten minutes", async () => {
    const address = email("code-expiry");
    await signUp(address);
    skipResendWait();
    await sendCode(address);
    vi.setSystemTime(Date.now() + 9 * 60_000);
    expect((await enterCode(address, lastCode(address))).status).toBe(200);

    skipResendWait();
    await sendCode(address);
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
    expect((await enterCode(address, lastCode(address))).status).toBe(400);
  });

  it("invalidates the previous code when a new one is sent", async () => {
    const address = email("new-code");
    await signUp(address);
    skipResendWait();
    await sendCode(address);
    const first = lastCode(address);
    skipResendWait();
    await sendCode(address);
    const second = lastCode(address);
    if (first === second) return;

    expect((await enterCode(address, first)).status).toBe(400);
    expect((await enterCode(address, second)).status).toBe(200);
  });
});

describe("limits per address", () => {
  /** Distinct client IPs, so only the per-address limits apply. */
  let ip = 0;
  function from(path: string, body: unknown) {
    ip += 1;
    return auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          "x-forwarded-for": `203.0.113.${ip % 250}`,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  it("waits 60 seconds before sending another code", async () => {
    const address = email("resend-wait");
    await invite(address);
    const send = () =>
      from("/email-otp/send-verification-otp", {
        email: address,
        type: "sign-in",
      });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 61_000);
      expect((await send()).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends at most five codes an hour", async () => {
    const address = email("five-codes");
    await invite(address);
    const statuses: number[] = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let request = 0; request < 6; request++) {
        vi.setSystemTime(Date.now() + 61_000);
        const response = await from("/email-otp/send-verification-otp", {
          email: address,
          type: "sign-in",
        });
        statuses.push(response.status);
      }
    } finally {
      vi.useRealTimers();
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("refuses even the right code after ten wrong guesses in an hour", async () => {
    const address = email("ten-guesses");
    await signUp(address);
    const statuses: number[] = [];
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (let code = 0; code < 4; code++) {
        vi.setSystemTime(Date.now() + 61_000);
        await from("/email-otp/send-verification-otp", {
          email: address,
          type: "sign-in",
        });
        const wrong = lastCode(address) === "000000" ? "111111" : "000000";
        for (let guess = 0; guess < 3 && statuses.length < 10; guess++)
          statuses.push(
            (await from("/sign-in/email-otp", { email: address, otp: wrong }))
              .status,
          );
      }
      expect(statuses).toEqual(Array(10).fill(400));
      vi.setSystemTime(Date.now() + 61_000);
      await from("/email-otp/send-verification-otp", {
        email: address,
        type: "sign-in",
      });
      const right = await from("/sign-in/email-otp", {
        email: address,
        otp: lastCode(address),
      });
      expect(right.status).toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("no passwords", () => {
  it.each([
    "/sign-up/email",
    "/sign-in/email",
    "/verify-password",
    "/change-password",
    "/request-password-reset",
    "/reset-password",
    "/email-otp/request-password-reset",
    "/email-otp/reset-password",
    "/forget-password/email-otp",
    "/send-verification-email",
    "/email-otp/verify-email",
    "/email-otp/check-verification-otp",
    "/email-otp/request-email-change",
    "/email-otp/change-email",
  ])("does not serve %s", async (path) => {
    const cookie = await signUp(
      email(`no-password-${path.replaceAll("/", "-")}`),
    );
    const response = await call(path, {
      cookie,
      body: {
        email: email("anyone"),
        password: "correct horse battery staple",
        newPassword: "another correct horse battery staple",
        currentPassword: "correct horse battery staple",
        otp: "000000",
        token: "token",
        type: "email-verification",
      },
    });

    expect(response.status).toBe(404);
  });

  it("sends no code for email verification or password reset", async () => {
    const address = email("other-code-types");
    await signUp(address);
    const before = messages.length;
    for (const type of ["email-verification", "forget-password"])
      await call("/email-otp/send-verification-otp", {
        body: { email: address, type },
      });

    expect(messages).toHaveLength(before);
  });
});

describe("sessions", () => {
  it("lasts 30 days with a persistent cookie", async () => {
    const before = Date.now();
    const cookie = await signUp(email("thirty-days"));
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
      query: { disableRefresh: true },
    });
    const duration = 30 * 24 * 60 * 60 * 1000;

    expect(session!.session.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + duration - 1000,
    );
    expect(session!.session.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + duration,
    );
  });

  it("revokes the session on sign-out, even for a replayed cookie", async () => {
    const cookie = await signUp(email("alan"));

    const signOut = await call("/sign-out", { body: {}, cookie });
    expect(signOut.status).toBe(200);

    expect(await sessionEmail(cookie)).toBeNull();
  });

  it("revokes one session by token and leaves the student's others working", async () => {
    const address = email("edsger");
    const laptop = await signUp(address);
    const phone = sessionCookie(await signInWithCode(address));

    const phoneHeaders = new Headers({ cookie: phone });
    const laptopSession = await auth.api.getSession({
      headers: new Headers({ cookie: laptop }),
    });
    await auth.api.revokeSession({
      headers: phoneHeaders,
      body: { token: laptopSession!.session.token },
    });

    expect(
      await auth.api.getSession({ headers: new Headers({ cookie: laptop }) }),
    ).toBeNull();
    expect(
      (await auth.api.getSession({ headers: phoneHeaders }))?.user.email,
    ).toBe(address);
  });
});

describe("sensitive actions need a recent sign-in", () => {
  it("signs out everywhere from a session created within ten minutes", async () => {
    const address = email("everywhere-recent");
    const laptop = await signUp(address);
    const phone = sessionCookie(await signInWithCode(address));
    vi.setSystemTime(Date.now() + 9 * 60_000);

    expect(
      (await call("/revoke-sessions", { body: {}, cookie: phone })).status,
    ).toBe(200);
    expect(await sessionEmail(laptop)).toBeNull();
  });

  it("refuses to sign out everywhere from an older session, keeping every session", async () => {
    const address = email("everywhere-old");
    const laptop = await signUp(address);
    skipResendWait();
    vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);

    const refused = await call("/revoke-sessions", {
      body: {},
      cookie: laptop,
    });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
    expect(await sessionEmail(laptop)).toBe(address);
  });
});
