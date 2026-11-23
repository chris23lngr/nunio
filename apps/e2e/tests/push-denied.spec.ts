import { randomUUID } from "node:crypto";
import { createPool, createPrismaClient } from "@nunio/db";
import { expect, test } from "@playwright/test";
import { origins, target } from "../origins.js";
import { enterSignIn } from "../students.js";

/** A verified student with one open Intervention, made through the operator connection. */
async function createStudent(): Promise<string> {
  const email = `push-denied+${randomUUID()}@example.com`;
  const prisma = createPrismaClient(
    createPool(process.env.INVITATION_DATABASE_URL!),
  );
  const userId = randomUUID();
  try {
    // Only a disposable local database may lose its limiter state; staging is shared.
    if (target === "local") await prisma.rateLimit.deleteMany();
    await prisma.user.create({
      data: {
        id: userId,
        name: "push-denied",
        email,
        emailVerified: true,
        passkeyPromptDismissed: true,
      },
    });
    // Its work does not exist, so the Inbox shows it as gone; closing it still works. As its owner,
    // so the insert passes forced RLS whether or not the fixture connection bypasses it.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.owner_id', ${userId}, true)`;
      await tx.intervention.create({
        data: {
          id: randomUUID(),
          studentId: userId,
          kind: "shortfall",
          dedupeKey: `shortfall:${randomUUID()}`,
        },
      });
    });
  } finally {
    await prisma.$disconnect();
  }
  return email;
}

test("denying notifications leaves every page usable", async ({ page }) => {
  // Headless Chromium cannot prompt and reports "denied" before any tap; act as a student who is asked and says no.
  await page.addInitScript(() => {
    let permission: NotificationPermission = "default";
    Object.defineProperty(Notification, "permission", {
      get: () => permission,
    });
    Notification.requestPermission = async () => (permission = "denied");
  });
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  const email = await createStudent();
  await page.goto(`${origins.app}/sign-in`);
  await enterSignIn(page, email);
  await expect(page).toHaveURL(`${origins.app}/`);

  const nav = page.getByRole("navigation", { name: "App navigation" });
  await nav.getByRole("link", { name: "Eingang" }).click();
  await page
    .getByRole("link", { name: "Benachrichtigungen einstellen" })
    .click();
  await expect(page).toHaveURL(`${origins.app}/settings/notifications`);
  const channels = page.getByRole("region", { name: "Benachrichtigungen" });
  await channels
    .getByRole("checkbox", { name: "Browser-Push-Benachrichtigungen" })
    .check();
  await channels.getByRole("button", { name: "Speichern" }).click();
  await expect(
    channels.getByText(/Benachrichtigungen sind in diesem Browser blockiert/),
  ).toBeVisible();
  await channels.getByRole("button", { name: "Abbrechen" }).click();
  await nav.getByRole("link", { name: "Eingang" }).click();

  const open = page.getByRole("region", { name: "Needs attention" });
  await open.getByRole("button", { name: "Got it" }).click();
  await expect(
    page.getByRole("region", { name: "Closed" }).getByText("Acknowledged"),
  ).toBeVisible();
  await expect(open).toHaveCount(0);

  for (const [name, path] of [
    ["Heute", "/"],
    ["Prüfen", "/review"],
    ["Chat", "/chat"],
    ["Plan", "/plan"],
    ["Projekte", "/projects"],
    ["Agenten", "/agents"],
    ["Eingang", "/inbox"],
  ] as const) {
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(`${origins.app}${path}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  }
  await page
    .getByRole("link", { name: "Benachrichtigungen einstellen" })
    .click();
  await expect(
    channels.getByText(/Benachrichtigungen sind in diesem Browser blockiert/),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
