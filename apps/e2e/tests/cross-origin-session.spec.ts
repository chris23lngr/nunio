import { randomUUID } from "node:crypto";
import { createPool, createPrismaClient } from "@nunio/db";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { cookieDomain, origins, target } from "../origins.js";

const password = "correct horse battery staple";

test.beforeEach(async () => {
  if (target !== "local") return;
  // Local suites share an IP, but each test gets fresh limiter state in its disposable database.
  const prisma = createPrismaClient(
    createPool(process.env.INVITATION_DATABASE_URL!),
  );
  try {
    await prisma.rateLimit.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
});

async function signIn(page: Page, name: string): Promise<string> {
  const email = await createStudent(name);
  await signInAs(page, email);
  return email;
}

async function createStudent(name: string): Promise<string> {
  const email = `${name}+${randomUUID()}@example.com`;
  const databaseURL = process.env.INVITATION_DATABASE_URL;
  if (!databaseURL)
    throw new Error(
      "INVITATION_DATABASE_URL is required to provision verified account fixtures",
    );
  const prisma = createPrismaClient(createPool(databaseURL));
  const userId = randomUUID();
  try {
    // Auth HTTP tests exercise signup and verification against the Scaleway stub.
    // Browser session tests use verified fixtures and never send mail to generated addresses.
    await prisma.user.create({
      data: {
        id: userId,
        name,
        email,
        emailVerified: true,
        accounts: {
          create: {
            id: randomUUID(),
            accountId: userId,
            providerId: "credential",
            password: await hashPassword(password),
          },
        },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
  return email;
}

async function signInAs(page: Page, email: string): Promise<void> {
  await page.goto(`${origins.app}/sign-in`);
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(password);
  const submit = page.getByRole("button", {
    name: "Mit E-Mail anmelden",
    exact: true,
  });
  await submit.click();
  await expect(page).toHaveURL(`${origins.app}/`);
}

test("a visitor without a session is sent to sign-in", {
  tag: "@staging",
}, async ({ page }) => {
  await page.goto(`${origins.app}/`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
});

test("security settings require a verified session", async ({ page }) => {
  await page.goto(`${origins.app}/settings/security`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
});

test("security settings reject an invalid session cookie", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "__Secure-better-auth.session_token",
      value: "expired-session.invalid-signature",
      domain: `.${cookieDomain}`,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto(`${origins.app}/settings/security`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
});

test("a signed-in student can manage their account in security settings", async ({
  page,
}) => {
  await signIn(page, "settings");
  await page.goto(`${origins.app}/settings/security`);
  await expect(
    page.getByRole("heading", { name: "Einstellungen", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Dieses Gerät")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Konto löschen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Account", exact: true }),
  ).toHaveCount(0);
});

test("settings open from the sidebar footer and stack below navigation on mobile", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1728, height: 1117 });
  await signIn(page, "settings-layout");
  const settingsLink = page.getByRole("link", {
    name: "Einstellungen",
    exact: true,
  });
  await settingsLink.click();
  await expect(page).toHaveURL(`${origins.app}/settings/security`);
  await expect(settingsLink).toHaveAttribute("aria-current", "page");
  const navigation = page.getByRole("navigation", {
    name: "Einstellungen",
    exact: true,
  });
  await expect(navigation.getByRole("link")).toHaveCount(1);
  const sessions = page.getByRole("region", { name: "Aktive Sitzungen" });
  await expect(sessions.getByText("Dieses Gerät")).toBeVisible();
  const desktopNav = (await navigation.boundingBox())!;
  const desktopSessions = (await sessions.boundingBox())!;
  expect(desktopNav.x + desktopNav.width).toBeLessThan(desktopSessions.x);
  expect(Math.abs(desktopNav.y - desktopSessions.y)).toBeLessThan(2);
  const footer = (await settingsLink.boundingBox())!;
  expect(footer.y).toBeGreaterThan(900);
  await page.screenshot({
    path: testInfo.outputPath("settings-desktop.png"),
    fullPage: true,
  });

  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const tabletNav = (await navigation.boundingBox())!;
    const tabletSessions = (await sessions.boundingBox())!;
    expect(tabletNav.y + tabletNav.height).toBeLessThan(tabletSessions.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(settingsLink).toBeHidden();
  const mobileNav = (await navigation.boundingBox())!;
  const mobileSessions = (await sessions.boundingBox())!;
  expect(mobileNav.y + mobileNav.height).toBeLessThan(mobileSessions.y);
  const mobileDetails = (await sessions
    .getByText(/Angemeldet am/)
    .boundingBox())!;
  const mobileSignOut = (await sessions
    .getByRole("button", { name: "Abmelden", exact: true })
    .boundingBox())!;
  expect(mobileDetails.width).toBeGreaterThan(200);
  expect(mobileSignOut.y).toBeGreaterThanOrEqual(
    mobileDetails.y + mobileDetails.height,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  await page.getByRole("button", { name: "Sidebar öffnen" }).click();
  await expect(settingsLink).toBeVisible();
  await settingsLink.click();
  await expect(settingsLink).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Einstellungen", level: 1 }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("settings-mobile.png"),
    fullPage: true,
  });

  await page
    .getByRole("button", { name: "Konto löschen", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Konto löschen?" });
  await expect(dialog.getByLabel("Passwort")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Löschung anfordern" }),
  ).toBeVisible();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(375);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("signing in on app. sets a parent-domain cookie the app's server can use", {
  tag: "@staging",
}, async ({ page, context }) => {
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

test("signing out ends the session for the app's server too", async ({
  page,
}) => {
  await signIn(page, "grace");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(`${origins.app}/sign-in`);

  await page.goto(`${origins.app}/`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
});

test("a page on an untrusted origin cannot sign the user out", {
  tag: "@staging",
}, async ({ page }) => {
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

test("a student signs out another session and requests deletion from account settings", async ({
  page,
  browser,
}) => {
  const email = await signIn(page, "hedy");
  const phone = await browser.newContext({ ignoreHTTPSErrors: true });
  const phonePage = await phone.newPage();
  await signInAs(phonePage, email);

  await page.getByRole("link", { name: "Einstellungen", exact: true }).click();
  const sessions = page.getByRole("main").getByRole("listitem");
  await expect(sessions).toHaveCount(2);
  await sessions
    .filter({ hasNotText: "Dieses Gerät" })
    .getByRole("button", { name: "Abmelden", exact: true })
    .click();
  await expect(sessions).toHaveCount(1);
  await phonePage.goto(`${origins.app}/`);
  await expect(phonePage).toHaveURL(`${origins.app}/sign-in`);

  await page
    .getByRole("button", { name: "Konto löschen", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Konto löschen?" });
  await dialog.getByLabel("Passwort").fill(password);
  await dialog.getByRole("button", { name: "Löschung anfordern" }).click();
  await expect(page).toHaveURL(`${origins.app}/sign-in?deletion=requested`);
  await expect(
    page.getByText("Deine Anfrage zur Kontolöschung ist eingegangen."),
  ).toBeVisible();
  await page.goto(`${origins.app}/`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
  await phone.close();
});

test("a student signs out everywhere from account settings", async ({
  page,
  browser,
}) => {
  const email = await signIn(page, "katherine");
  const phone = await browser.newContext({ ignoreHTTPSErrors: true });
  const phonePage = await phone.newPage();
  await signInAs(phonePage, email);

  await page.getByRole("link", { name: "Einstellungen", exact: true }).click();
  await page.getByRole("button", { name: "Überall abmelden" }).click();
  await expect(page).toHaveURL(`${origins.app}/sign-in`);

  await page.goto(`${origins.app}/`);
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
  await phonePage.goto(`${origins.app}/`);
  await expect(phonePage).toHaveURL(`${origins.app}/sign-in`);
  await phone.close();
});

test("an expired session removes cached Sources from an open page", async ({
  page,
  context,
}) => {
  let expired = false;
  await page.route(`${origins.api}/api/me/sources`, async (route) => {
    if (expired) return route.continue();
    return route.fulfill({
      json: [
        {
          id: "cached-source",
          title: "Private biology syllabus",
          status: "ready",
          extraction: "done",
          failure: null,
        },
      ],
    });
  });
  await signIn(page, "cache-expiry");
  await expect(page.getByText(/Private biology syllabus/)).toBeVisible();
  await page.evaluate(() => Reflect.set(window, "foundationDocument", "kept"));
  await page.clock.install();
  const signedOut = await context.request.post(
    `${origins.api}/api/auth/sign-out`,
    {
      headers: { origin: origins.app },
      data: {},
    },
  );
  expect(signedOut.ok()).toBe(true);
  expired = true;
  await page.clock.runFor(31_000);
  // Trigger Query's focus refresh independently of Better Auth's document listener.
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
  await expect(page.getByText(/Private biology syllabus/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mit E-Mail anmelden", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, "foundationDocument")),
  ).toBe("kept");
});

test("signing out and switching students never reuses the previous student's Sources", async ({
  page,
}) => {
  let title = "Ada's private syllabus";
  await page.route(`${origins.api}/api/me/sources`, (route) =>
    route.fulfill({
      json: [
        {
          id: "cached-source",
          title,
          status: "ready",
          extraction: "done",
          failure: null,
        },
      ],
    }),
  );
  await signIn(page, "cache-first");
  await expect(page.getByText(title, { exact: false })).toBeVisible();
  const second = await createStudent("cache-second");
  await page.evaluate(() => Reflect.set(window, "foundationDocument", "kept"));
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
  title = "Grace's private syllabus";
  // Stay in the same document: a page.goto would hide an in-memory cache leak.
  await page.getByLabel("E-Mail").fill(second);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Mit E-Mail anmelden", exact: true })
    .click();
  await expect(page.getByText(/Grace's private syllabus/)).toBeVisible();
  await expect(page.getByText(/Ada's private syllabus/)).toHaveCount(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "foundationDocument")),
  ).toBe("kept");
});

test("an account changed outside the page replaces the old student's cached view on focus", async ({
  page,
  context,
}) => {
  let title = "First student's syllabus";
  await page.route(`${origins.api}/api/me/sources`, (route) =>
    route.fulfill({
      json: [
        {
          id: "cached-source",
          title,
          status: "ready",
          extraction: "done",
          failure: null,
        },
      ],
    }),
  );
  await signIn(page, "cache-original");
  await expect(page.getByText(/First student's syllabus/)).toBeVisible();
  const second = await createStudent("cache-external");
  await page.evaluate(() => Reflect.set(window, "foundationDocument", "kept"));
  await context.request.post(`${origins.api}/api/auth/sign-out`, {
    headers: { origin: origins.app },
    data: {},
  });
  const signedIn = await context.request.post(
    `${origins.api}/api/auth/sign-in/email`,
    {
      headers: { origin: origins.app },
      data: { email: second, password },
    },
  );
  expect(signedIn.ok()).toBe(true);
  title = "Second student's syllabus";
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  });
  await expect(page.getByText(/Second student's syllabus/)).toBeVisible();
  await expect(page.getByText(/First student's syllabus/)).toHaveCount(0);
  expect(
    await page.evaluate(() => Reflect.get(window, "foundationDocument")),
  ).toBe("kept");
});

test("account deletion cannot restore cached Sources through browser Back", async ({
  page,
}) => {
  await page.route(`${origins.api}/api/me/sources`, (route) =>
    route.fulfill({
      json: [
        {
          id: "cached-source",
          title: "Deleted student's syllabus",
          status: "ready",
          extraction: "done",
          failure: null,
        },
      ],
    }),
  );
  await signIn(page, "cache-delete");
  await expect(page.getByText(/Deleted student's syllabus/)).toBeVisible();
  await page.getByRole("link", { name: "Einstellungen", exact: true }).click();
  await page
    .getByRole("button", { name: "Konto löschen", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Konto löschen?" });
  await dialog.getByLabel("Passwort").fill(password);
  await dialog.getByRole("button", { name: "Löschung anfordern" }).click();
  await expect(page).toHaveURL(`${origins.app}/sign-in?deletion=requested`);
  await page.goBack();
  await expect(page.getByText(/Deleted student's syllabus/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mit E-Mail anmelden", exact: true }),
  ).toBeVisible();
});

test("signing out everywhere cannot restore cached Sources through browser Back", async ({
  page,
}) => {
  await page.route(`${origins.api}/api/me/sources`, (route) =>
    route.fulfill({
      json: [
        {
          id: "cached-source",
          title: "Signed-out student's syllabus",
          status: "ready",
          extraction: "done",
          failure: null,
        },
      ],
    }),
  );
  await signIn(page, "cache-revoke");
  await expect(page.getByText(/Signed-out student's syllabus/)).toBeVisible();
  await page.getByRole("link", { name: "Einstellungen", exact: true }).click();
  await page.getByRole("button", { name: "Überall abmelden" }).click();
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
  await page.goBack();
  await expect(page.getByText(/Signed-out student's syllabus/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Mit E-Mail anmelden", exact: true }),
  ).toBeVisible();
});

test("navigation from Review back to Sources reuses the recently loaded collection", async ({
  page,
}) => {
  let reads = 0;
  await page.route(`${origins.api}/api/me/sources`, (route) => {
    reads++;
    return route.fulfill({
      json: [
        {
          id: "cached-source",
          title: "Navigation syllabus",
          status: "ready",
          extraction: "done",
          failure: null,
        },
      ],
    });
  });
  await page.route(`${origins.api}/api/me/review`, (route) =>
    route.fulfill({ json: { courses: [] } }),
  );
  await signIn(page, "cache-navigation");
  await expect(page.getByText(/Navigation syllabus/)).toBeVisible();
  await page
    .getByRole("navigation", { name: "App navigation" })
    .getByRole("link", { name: "Review", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await page.getByRole("link", { name: "Back to Sources" }).click();
  await expect(page.getByText(/Navigation syllabus/)).toBeVisible();
  expect(reads).toBe(1);
});
