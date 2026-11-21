import { expect, test } from "@playwright/test";
import { origins, target } from "../origins.js";
import { createStudent, enterSignIn } from "../students.js";

test.beforeEach(async ({ page }) => {
  test.skip(target !== "local", "Needs a disposable database for fixtures");
  // A platform authenticator that verifies the student, as Face ID or a device PIN would.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
});

test("a student adds a passkey after a code sign-in, signs in with it, and deletes it", async ({
  page,
}) => {
  const email = await createStudent("passkey", { offerPasskey: true });
  await page.goto(`${origins.app}/sign-in`);
  await enterSignIn(page, email);
  await expect(
    page.getByRole("heading", { name: "Passkey einrichten?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Passkey einrichten" }).click();
  await expect(page).toHaveURL(`${origins.app}/`);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${origins.app}/sign-in`);
  await page.getByRole("button", { name: "Mit Passkey anmelden" }).click();
  await expect(page).toHaveURL(`${origins.app}/`);

  await page.getByRole("link", { name: "Einstellungen", exact: true }).click();
  const passkeys = page.getByRole("region", { name: "Passkeys" });
  const row = passkeys.getByRole("listitem");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Zuletzt verwendet am");
  await row.getByRole("button", { name: /löschen$/ }).click();
  await expect(row).toHaveCount(0);
  await expect(passkeys).toContainText("noch keinen Passkey");
});

test("a student adds a passkey from account settings", async ({ page }) => {
  const email = await createStudent("passkey-settings");
  await page.goto(`${origins.app}/sign-in`);
  await enterSignIn(page, email);
  await expect(page).toHaveURL(`${origins.app}/`);

  await page.getByRole("link", { name: "Einstellungen", exact: true }).click();
  const passkeys = page.getByRole("region", { name: "Passkeys" });
  await passkeys.getByRole("button", { name: "Passkey hinzufügen" }).click();
  await expect(passkeys.getByRole("listitem")).toHaveCount(1);
  await expect(passkeys.getByRole("listitem")).toContainText(
    "Noch nie verwendet",
  );
});
