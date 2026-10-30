import { expect, test, type Page } from "@playwright/test";
import { cookieDomain, origins } from "../origins.js";

const password = "correct horse battery staple";
const run = Date.now().toString(36);

async function signUp(page: Page, name: string): Promise<string> {
  const email = `${name}+${run}@example.com`;
  await page.goto(`${origins.app}/sign-in`);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  const submit = page.getByRole("button", { name: "Sign up" });
  await submit.click();
  // Better Auth allows 3 sign-ups per 10 s per client IP on deployed origins; wait out the window once.
  const limited = page.getByText("Too many requests");
  await Promise.race([page.waitForURL(`${origins.app}/`), limited.waitFor()]);
  if (await limited.isVisible()) {
    await page.waitForTimeout(10_000);
    await submit.click();
  }
  await expect(page).toHaveURL(`${origins.app}/`);
  return email;
}

test("a visitor without a session is sent to sign-in", async ({ page }) => {
  await page.goto(`${origins.app}/`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
});

test("signing up on app. sets a parent-domain cookie the app's server can use", async ({
  page,
  context,
}) => {
  const email = await signUp(page, "ada");

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
  await signUp(page, "grace");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${origins.app}/sign-in`);

  await page.goto(`${origins.app}/`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
});

test("a page on an untrusted origin cannot sign the user out", async ({ page }) => {
  const email = await signUp(page, "alan");

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
