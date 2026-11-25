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
