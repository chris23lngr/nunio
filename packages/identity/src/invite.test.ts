import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth, type Auth } from "./auth.js";

const execute = promisify(execFile);
const origin = "https://app.nunio.test";
const run = Date.now().toString(36);
let db: TestDatabase;
let prisma: PrismaClient;
let auth: Auth;

beforeAll(async () => {
  db = await startTestDatabase();
  prisma = createPrismaClient(createPool(db.connectionString));
  auth = createAuth({
    prisma, baseURL: origin, trustedOrigins: [origin], secret: "invite-test-secret-that-is-long-enough",
    email: {
      projectId: "test-project", secretKey: "test-key", from: "accounts@nunio.test",
      fetch: async () => Response.json({ emails: [{ id: "test-email" }] }, { status: 201 }),
    },
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

function issue(email: string, operator = "pilot-founder") {
  return execute(process.execPath, [fileURLToPath(new URL("./invite.ts", import.meta.url)), email], {
    env: {
      PATH: process.env.PATH,
      INVITATION_DATABASE_URL: db.connectionString,
      APP_ORIGIN: origin,
      OPERATOR_ID: operator,
    },
  });
}

async function register(email: string, url: string) {
  return auth.handler(new Request(`${origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-invitation-token": new URL(url).searchParams.get("invitation")!,
    },
    body: JSON.stringify({ name: "Ada", email, password: "correct horse battery staple" }),
  }));
}

describe("the founder's invitation command", () => {
  it("issues a link that lets the invited student register", async () => {
    const email = `ada+${run}@example.com`;
    const { stdout } = await issue(email);
    const invitation = JSON.parse(stdout) as { url: string };
    const url = new URL(invitation.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${origin}/sign-in`);

    const response = await register(email, invitation.url);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { email } });
  });

  it("records the issuing operator and issuance time", async () => {
    const before = Date.now();
    const { stdout } = await issue(`audit+${run}@example.com`, "founder-audit-test");
    const invitation = JSON.parse(stdout) as { id: string; issuedBy: string; createdAt: string };

    expect(invitation.issuedBy).toBe("founder-audit-test");
    expect(invitation.id).toEqual(expect.any(String));
    expect(Date.parse(invitation.createdAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(invitation.createdAt)).toBeLessThanOrEqual(Date.now());
  });

  it("expires the invitation seven days after issuance", async () => {
    const { stdout } = await issue(`expiry+${run}@example.com`);
    const invitation = JSON.parse(stdout) as { createdAt: string; expiresAt: string };

    expect(Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt)).toBe(604_800_000);
  });

  it("binds a mixed-case email invitation to the normalized student address", async () => {
    const { stdout } = await issue(`Case+${run}@Example.COM`);
    const invitation = JSON.parse(stdout) as { email: string; url: string };

    expect(invitation.email).toBe(`case+${run}@example.com`);
    expect((await register(`other+${run}@example.com`, invitation.url)).status).toBe(403);
    expect((await register(`case+${run}@example.com`, invitation.url)).status).toBe(200);
  });

  it("refuses to issue an invitation without operator attribution", async () => {
    await expect(issue(`unaudited+${run}@example.com`, "")).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("OPERATOR_ID"),
    });
  });
});
