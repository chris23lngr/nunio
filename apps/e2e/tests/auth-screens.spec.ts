import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createPool, createPrismaClient } from "@nunio/db";
import { expect, test } from "@playwright/test";
import { origins } from "../origins.js";
import { signInCode, storeCodesInsteadOfEmail } from "../students.js";

test("auth screens use the Paper layout and remain usable on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1117 });
  await page.goto(`${origins.app}/sign-in?invitation=design-preview`);
  await expect(
    page.getByRole("heading", { name: "Willkommen zurück!" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "nunio" })).toBeVisible();
  const email = page.getByRole("textbox", { name: "E-Mail" });
  await expect(email).toHaveCSS("height", "30px");
  await expect(email).toHaveCSS("font-size", "14px");
  expect((await email.boundingBox())?.width).toBe(384);
  for (const provider of ["Microsoft", "Google"]) {
    const button = page.getByRole("button", {
      name: `Mit ${provider} anmelden`,
    });
    await expect(button).toBeDisabled();
    await expect
      .poll(() =>
        button
          .locator("img")
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
  }
  await page.getByRole("link", { name: "Hier registrieren" }).click();
  await expect(page).toHaveURL(
    `${origins.app}/sign-up?invitation=design-preview`,
  );
  await expect(
    page.getByRole("heading", { name: "Willkommen bei nunio!" }),
  ).toBeVisible();
  for (const provider of ["Microsoft", "Google"]) {
    await expect(
      page.getByRole("button", { name: `Mit ${provider} registrieren` }),
    ).toBeDisabled();
  }
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
  const submit = page.getByRole("button", { name: "Code senden" });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeVisible();
  await page.getByRole("link", { name: "Hier anmelden" }).click();
  await expect(page).toHaveURL(
    `${origins.app}/sign-in?invitation=design-preview`,
  );
  await expect(
    page.getByRole("heading", { name: "Willkommen zurück!" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    375,
  );
});

test("registration without an Invitation explains that one is needed", async ({
  page,
}) => {
  await page.goto(`${origins.app}/sign-up`);
  await expect(page.getByRole("status")).toContainText(
    "Für die Registrierung brauchst du eine Einladung.",
  );
  await expect(page.getByRole("button", { name: "Code senden" })).toHaveCount(
    0,
  );
});

test("an invited student registers with an emailed code and lands in the app", async ({
  page,
}) => {
  const email = `invited+${randomUUID()}@example.com`;
  const invitation = randomBytes(32).toString("base64url");
  const prisma = createPrismaClient(
    createPool(process.env.INVITATION_DATABASE_URL!),
  );
  try {
    await prisma.rateLimit.deleteMany();
    await prisma.invitation.create({
      data: {
        tokenHash: createHash("sha256").update(invitation).digest("hex"),
        email,
        issuedBy: "e2e-operator",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
  await storeCodesInsteadOfEmail(page);

  await page.goto(
    `${origins.app}/sign-up?invitation=${invitation}&email=${encodeURIComponent(email)}`,
  );
  await expect(page.getByLabel("E-Mail")).toHaveValue(email);
  await page.getByLabel("Name", { exact: true }).fill("Eingeladen");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Code senden" }).click();
  await page.getByLabel("Anmeldecode").pressSequentially(signInCode);
  await expect(
    page.getByRole("heading", { name: "Passkey einrichten?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Später" }).click();

  await expect(page).toHaveURL(`${origins.app}/`);
});
