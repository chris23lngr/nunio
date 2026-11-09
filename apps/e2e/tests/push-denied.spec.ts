import { randomUUID } from "node:crypto";
import { createPool, createPrismaClient } from "@nunio/db";
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { origins } from "../origins.js";

const password = "correct horse battery staple";

/** A verified student with one open Intervention, made through the operator connection. */
async function createStudent(): Promise<string> {
  const email = `push-denied+${randomUUID()}@example.com`;
  const prisma = createPrismaClient(
    createPool(process.env.INVITATION_DATABASE_URL!),
  );
  const userId = randomUUID();
  try {
    await prisma.rateLimit.deleteMany();
    await prisma.user.create({
      data: {
        id: userId,
        name: "push-denied",
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
    // Its work does not exist, so the Inbox shows it as gone; closing it still works.
    await prisma.intervention.create({
      data: {
        id: randomUUID(),
        studentId: userId,
        kind: "shortfall",
        dedupeKey: `shortfall:${randomUUID()}`,
      },
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
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort").fill(password);
  await page
    .getByRole("button", { name: "Mit E-Mail anmelden", exact: true })
    .click();
  await expect(page).toHaveURL(`${origins.app}/`);

  const nav = page.getByRole("navigation", { name: "App navigation" });
  await nav.getByRole("link", { name: "Inbox" }).click();
  await page
    .getByRole("button", { name: "Turn on notifications on this device" })
    .click();
  await expect(
    page.getByText(/Notifications are blocked for nunio/),
  ).toBeVisible();

  const open = page.getByRole("region", { name: "Needs attention" });
  await open.getByRole("button", { name: "Got it" }).click();
  await expect(
    page.getByRole("region", { name: "Closed" }).getByText("Acknowledged"),
  ).toBeVisible();
  await expect(open).toHaveCount(0);

  for (const [name, path] of [
    ["Home", "/"],
    ["Account", "/account"],
    ["Review", "/review"],
    ["Chat", "/chat"],
    ["Plan", "/plan"],
    ["Projects", "/projects"],
    ["Responsibilities", "/responsibilities"],
    ["Inbox", "/inbox"],
  ] as const) {
    await nav.getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(`${origins.app}${path}`);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  }
  await expect(
    page.getByText(/Notifications are blocked for nunio/),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
