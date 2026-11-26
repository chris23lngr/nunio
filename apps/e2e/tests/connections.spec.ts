import { randomUUID } from "node:crypto";
import { createPool, createPrismaClient } from "@nunio/db";
import { expect, test } from "@playwright/test";
import { origins } from "../origins.js";
import { createStudent, signInAs } from "../students.js";

// Against the real API, with the catalog the global setup seeds for the Integration fakes (#286).
test("a student finds Email and Testnotizen under Verfügbar in Einstellungen › Verbindungen", async ({
  page,
}) => {
  const prisma = createPrismaClient(
    createPool(process.env.INVITATION_DATABASE_URL!),
  );
  try {
    await prisma.rateLimit.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
  await signInAs(page, await createStudent("connections"));

  await page.getByRole("link", { name: "Einstellungen", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Einstellungen", exact: true })
    .getByRole("link", { name: "Verbindungen" })
    .click();

  await expect(page).toHaveURL(`${origins.app}/settings/connections`);
  const available = page.getByRole("region", { name: "Verfügbar" });
  await expect(available.getByText("E-Mail", { exact: true })).toBeVisible();
  await expect(
    available.getByText("Testnotizen", { exact: true }),
  ).toBeVisible();
});

// Against the real API and the e2e GreenMail, which the nunio.test provider entry points at under INTEGRATION_FAKES.
test("a student connects Email: nunio recognises the mail server, tests the login, and saves the chosen folders", async ({
  page,
}) => {
  const address = `student-${randomUUID()}@nunio.test`;
  const password = "e2e-mail-password";
  const created = await fetch(`${process.env.FAKE_MAIL_ADMIN_URL}/api/user`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: address, login: address, password }),
  });
  expect(created.ok).toBe(true);
  await signInAs(page, await createStudent("connect-email", { pilot: true }));
  await page.goto(`${origins.app}/settings/connections`);

  await page
    .getByRole("region", { name: "Verfügbar" })
    .getByRole("listitem")
    .filter({ hasText: "E-Mail" })
    .getByRole("button", { name: "Verbinden" })
    .click();
  const dialog = page.getByRole("dialog", { name: "E-Mail verbinden" });
  await dialog.getByLabel("E-Mail-Adresse").fill(address);
  await dialog.getByLabel("Passwort").fill(password);
  await expect(
    dialog.getByText("nunio Test-Uni erkannt · mail.nunio.test"),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Anmeldung prüfen" }).click();

  await expect(
    dialog.getByRole("status", { name: "Anmeldung geprüft" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Posteingang" }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: "Verbinden" }).click();

  const row = page
    .getByRole("region", { name: "Verbunden" })
    .getByRole("listitem")
    .filter({ hasText: `E-Mail · ${address}` });
  await expect(row.getByText("Lesen: Posteingang")).toBeVisible();
  await expect(row.getByText("Verbunden", { exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();

  // "Verwalten" opens the Connection's page: its folders, listed from the mailbox, and sending always asks.
  await row.getByRole("link", { name: "Verwalten" }).click();
  await expect(page).toHaveURL(`${origins.app}/settings/connections/email`);
  await expect(
    page
      .getByRole("region", { name: "Ordner, die nunio lesen darf" })
      .getByRole("button", { name: "Posteingang" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page
      .getByRole("region", { name: "Fragt immer" })
      .getByRole("listitem")
      .filter({ hasText: "Mail senden" })
      .getByText("Fragt immer"),
  ).toBeVisible();
});
