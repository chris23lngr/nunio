import { randomUUID } from "node:crypto";
import { createPool, createPrismaClient } from "@nunio/db";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { cookieDomain, origins } from "../origins.js";

const password = "correct horse battery staple";
const run = Date.now().toString(36);

async function signIn(page: Page, name: string): Promise<string> {
  const email = await createStudent(name);
  await signInAs(page, email);
  return email;
}

async function createStudent(name: string): Promise<string> {
  const email = `${name}+${run}@example.com`;
  const databaseURL = process.env.INVITATION_DATABASE_URL;
  if (!databaseURL) throw new Error("INVITATION_DATABASE_URL is required to provision verified account fixtures");
  const prisma = createPrismaClient(createPool(databaseURL));
  const userId = randomUUID();
  try {
    // Auth HTTP tests exercise signup and verification against the Scaleway stub.
    // Browser session tests use verified fixtures and never send mail to generated addresses.
    await prisma.user.create({ data: {
      id: userId, name, email, emailVerified: true,
      accounts: { create: {
        id: randomUUID(), accountId: userId, providerId: "credential", password: await hashPassword(password),
      } },
    } });
  } finally {
    await prisma.$disconnect();
  }
  return email;
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto(`${origins.app}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await submit.click();
  // Better Auth allows 3 sign-ins per 10 s per client IP; wait out the window once.
  const limited = page.getByText("Too many requests");
  await Promise.race([page.waitForURL(`${origins.app}/`), limited.waitFor()]);
  if (await limited.isVisible()) {
    await page.waitForTimeout(10_000);
    await submit.click();
  }
  await expect(page).toHaveURL(`${origins.app}/`);
}

test("a visitor without a session is sent to sign-in", async ({ page }) => {
  await page.goto(`${origins.app}/`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
});

test("signing in on app. sets a parent-domain cookie the app's server can use", async ({
  page,
  context,
}) => {
  const email = await signIn(page, "ada");

  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();

  const [cookie] = (await context.cookies(origins.app)).filter((c) =>
    c.name.endsWith("session_token"),
  );
  expect(cookie).toMatchObject({
    domain: `.${cookieDomain}`,
    secure: true,
    httpOnly: true,
    sameSite: "Lax",
  });
});

test("signing out ends the session for the app's server too", async ({ page }) => {
  await signIn(page, "grace");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${origins.app}/sign-in`);

  await page.goto(`${origins.app}/`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
});

test("a page on an untrusted origin cannot sign the user out", async ({ page }) => {
  const email = await signIn(page, "alan");

  await page.goto(`${origins.evil}/`);
  const outcome = await page.evaluate(async (api) => {
    try {
      await fetch(`${api}/api/auth/sign-out`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return "completed";
    } catch {
      return "blocked";
    }
  }, origins.api);
  expect(outcome).toBe("blocked");

  await page.goto(`${origins.app}/`);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
});

test("a student signs out another session and requests deletion from account settings", async ({ page, browser }) => {
  const email = await signIn(page, "hedy");
  const phone = await browser.newContext({ ignoreHTTPSErrors: true });
  const phonePage = await phone.newPage();
  await signInAs(phonePage, email);

  await page.getByRole("link", { name: "Account" }).click();
  const sessions = page.getByRole("listitem");
  await expect(sessions).toHaveCount(2);
  await sessions.filter({ hasNotText: "This device" }).getByRole("button", { name: "Sign out" }).click();
  await expect(sessions).toHaveCount(1);
  await phonePage.goto(`${origins.app}/`);
  await expect(phonePage).toHaveURL(`${origins.app}/sign-in`);

  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Request account deletion" }).click();
  await expect(page).toHaveURL(`${origins.app}/sign-in?deletion=requested`);
  await expect(page.getByText("Your account deletion request was received")).toBeVisible();
  await page.goto(`${origins.app}/`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
  await phone.close();
});

test("a student signs out everywhere from account settings", async ({ page, browser }) => {
  const email = await signIn(page, "katherine");
  const phone = await browser.newContext({ ignoreHTTPSErrors: true });
  const phonePage = await phone.newPage();
  await signInAs(phonePage, email);

  await page.getByRole("link", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(`${origins.app}/sign-in`);

  await page.goto(`${origins.app}/`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
  await phonePage.goto(`${origins.app}/`);
  await expect(phonePage).toHaveURL(`${origins.app}/sign-in`);
  await phone.close();
});
