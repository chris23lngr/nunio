import { createHash, randomUUID } from "node:crypto";
import { createPool, createPrismaClient } from "@nunio/db";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { origins } from "./origins.js";

/** Every fixture student's sign-in code; fixtures store it instead of emailing one. */
export const signInCode = "246810";

async function withDatabase<T>(
  fn: (prisma: ReturnType<typeof createPrismaClient>) => Promise<T>,
): Promise<T> {
  const databaseURL = process.env.INVITATION_DATABASE_URL;
  if (!databaseURL)
    throw new Error(
      "INVITATION_DATABASE_URL is required to provision account fixtures",
    );
  const prisma = createPrismaClient(createPool(databaseURL));
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * A verified student with no password, as every account is (ADR-0027). Browser tests never email generated
 * addresses. Unless `offerPasskey`, the student already declined the passkey prompt, so sign-in lands in the app.
 */
export async function createStudent(
  name: string,
  { offerPasskey = false } = {},
): Promise<string> {
  const email = `${name}+${randomUUID()}@example.com`;
  await withDatabase((prisma) =>
    prisma.user.create({
      data: {
        id: randomUUID(),
        name,
        email,
        emailVerified: true,
        passkeyPromptDismissed: !offerPasskey,
      },
    }),
  );
  return email;
}

/** Stores `signInCode` for `email` the way Better Auth's email OTP plugin stores a hashed code. */
export async function storeSignInCode(email: string): Promise<string> {
  const identifier = `sign-in-otp-${email}`;
  await withDatabase(async (prisma) => {
    await prisma.verification.deleteMany({ where: { identifier } });
    await prisma.verification.create({
      data: {
        id: randomUUID(),
        identifier,
        value: `${createHash("sha256").update(signInCode).digest("base64url")}:0`,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
  });
  return signInCode;
}

/** Answers the page's code requests with a stored code instead of an email. */
export async function storeCodesInsteadOfEmail(page: Page): Promise<void> {
  await page.route(
    `${origins.api}/api/auth/email-otp/send-verification-otp`,
    async (route) => {
      const cors = {
        "access-control-allow-origin": origins.app,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      };
      if (route.request().method() === "OPTIONS")
        return route.fulfill({ status: 204, headers: cors });
      const { email } = route.request().postDataJSON() as { email: string };
      await storeSignInCode(email);
      await route.fulfill({ json: { success: true }, headers: cors });
    },
  );
}

/** Enters `email` and its code on the sign-in screen that is already open. */
export async function enterSignIn(page: Page, email: string): Promise<void> {
  await storeCodesInsteadOfEmail(page);
  await page.getByLabel("E-Mail").fill(email);
  await page.getByRole("button", { name: "Code senden", exact: true }).click();
  await page.getByLabel("Anmeldecode").pressSequentially(signInCode);
}

/** Signs `email` in through the sign-in screen with an emailed code. */
export async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto(`${origins.app}/sign-in`);
  await enterSignIn(page, email);
  await expect(page).toHaveURL(`${origins.app}/`);
}
