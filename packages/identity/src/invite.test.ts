import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Auth } from "./auth.js";
import { createAuth } from "./auth.js";

const execute = promisify(execFile);
const origin = "https://app.nunio.test";
const run = Date.now().toString(36);
let db: TestDatabase;
let prisma: PrismaClient;
let auth: Auth;
/** The latest sign-in code emailed to each address. */
const codes = new Map<string, string>();

beforeAll(async () => {
  db = await startTestDatabase();
  prisma = createPrismaClient(createPool(db.runtimeConnectionString));
  auth = createAuth({
    prisma,
    baseURL: origin,
    trustedOrigins: [origin],
    secret: "invite-test-secret-that-is-long-enough",
    email: {
      projectId: "test-project",
      secretKey: "test-key",
      from: "accounts@nunio.test",
      fetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          to: { email: string }[];
          text: string;
        };
        codes.set(body.to[0]!.email, body.text.match(/\b\d{6}\b/)![0]);
        return Response.json(
          { emails: [{ id: "test-email" }] },
          { status: 201 },
        );
      },
    },
  });
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await db?.stop();
});

function issue(email: string, operator = "pilot-founder") {
  return execute(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./invite.ts", import.meta.url)),
      email,
    ],
    {
      env: {
        PATH: process.env.PATH,
        INVITATION_DATABASE_URL: db.connectionString,
        APP_ORIGIN: origin,
        OPERATOR_ID: operator,
      },
    },
  );
}

function post(path: string, body: unknown, invitation?: string) {
  return auth.handler(
    new Request(`${origin}/api/auth${path}`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        ...(invitation && { "x-invitation-token": invitation }),
      },
      body: JSON.stringify(body),
    }),
  );
}

/** Registers as the sign-up screen does: the link's Invitation, then the emailed code. */
async function register(email: string, url: string) {
  await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
  return post(
    "/sign-in/email-otp",
    { email, otp: codes.get(email) ?? "000000", name: "Ada" },
    new URL(url).searchParams.get("invitation")!,
  );
}

describe("the founder's invitation command", () => {
  it("issues a link that lets the invited student register", async () => {
    const email = `ada+${run}@example.com`;
    const { stdout } = await issue(email);
    const invitation = JSON.parse(stdout) as { url: string };
    const url = new URL(invitation.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${origin}/sign-up`);
    expect(url.searchParams.get("email")).toBe(email);

    const response = await register(email, invitation.url);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ user: { email } });
  });

  it("records the issuing operator and issuance time", async () => {
    const before = Date.now();
    const { stdout } = await issue(
      `audit+${run}@example.com`,
      "founder-audit-test",
    );
    const invitation = JSON.parse(stdout) as {
      id: string;
      issuedBy: string;
      createdAt: string;
    };

    expect(invitation.issuedBy).toBe("founder-audit-test");
    expect(invitation.id).toEqual(expect.any(String));
    expect(Date.parse(invitation.createdAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(invitation.createdAt)).toBeLessThanOrEqual(Date.now());
  });

  it("expires the invitation seven days after issuance", async () => {
    const { stdout } = await issue(`expiry+${run}@example.com`);
    const invitation = JSON.parse(stdout) as {
      createdAt: string;
      expiresAt: string;
    };

    expect(
      Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt),
    ).toBe(604_800_000);
  });

  it("binds a mixed-case email invitation to the normalized student address", async () => {
    const { stdout } = await issue(`Case+${run}@Example.COM`);
    const invitation = JSON.parse(stdout) as { email: string; url: string };

    expect(invitation.email).toBe(`case+${run}@example.com`);
    // The other address gets no code, so the attempt fails before the Invitation is checked.
    expect(
      (await register(`other+${run}@example.com`, invitation.url)).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (await register(`case+${run}@example.com`, invitation.url)).status,
    ).toBe(200);
  });

  it("refuses to issue an invitation without operator attribution", async () => {
    await expect(
      issue(`unaudited+${run}@example.com`, ""),
    ).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: expect.stringContaining("OPERATOR_ID"),
    });
  });
});
