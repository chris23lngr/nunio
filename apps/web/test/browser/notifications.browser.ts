import { expect, test } from "@playwright/test";

test("notification cards fit the viewport and protect drafts during navigation", async ({
  context,
  page,
  isMobile,
}) => {
  if (!isMobile) await page.setViewportSize({ width: 1728, height: 1117 });
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "notifications-browser-test",
      domain: "localhost",
      path: "/",
    },
  ]);
  let settings = {
    email: true,
    briefingEmail: true,
    briefingAtMinute: 420,
    quietHours: { fromMinute: 1320, toMinute: 420 },
    dailyLimit: 3,
  };
  await page.route("**/api/me/outreach-settings", async (route) => {
    if (route.request().method() === "PATCH")
      settings = { ...settings, ...route.request().postDataJSON() };
    await route.fulfill({ json: settings });
  });
  await page.goto("/settings/security");
  await page
    .getByRole("navigation", { name: "Einstellungen" })
    .getByRole("link", { name: "Benachrichtigungen" })
    .click();
  await expect(page).toHaveURL(/\/settings\/notifications$/);
  const channels = page.getByRole("region", { name: "Benachrichtigungen" });
  const quiet = page.getByRole("region", { name: "Ruhezeiten" });
  await expect(
    channels.getByRole("checkbox", { name: "E-Mail", exact: true }),
  ).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await quiet.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("notifications.png"),
    fullPage: true,
  });
  await channels.getByRole("checkbox", { name: "E-Mail", exact: true }).click();
  const dismissed = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.message()).toContain("ungespeicherte Änderungen");
    await dialog.dismiss();
  });
  await page.getByRole("link", { name: "Sicherheit", exact: true }).click();
  await dismissed;
  await expect(page).toHaveURL(/\/settings\/notifications$/);
  const backDismissed = page.waitForEvent("dialog").then(async (dialog) => {
    expect(dialog.message()).toContain("ungespeicherte Änderungen");
    await dialog.dismiss();
  });
  await page.evaluate(() => history.back());
  await backDismissed;
  await expect(page).toHaveURL(/\/settings\/notifications$/);
  await channels.getByRole("button", { name: "Speichern" }).click();
  await expect(
    channels.getByRole("button", { name: "Speichern" }),
  ).toBeDisabled();
  await quiet.getByRole("spinbutton").fill("51");
  await quiet.getByRole("button", { name: "Speichern" }).click();
  expect(settings.dailyLimit).toBe(3);
  await quiet.getByRole("button", { name: "Abbrechen" }).click();
  await page.getByRole("link", { name: "Sicherheit", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/security$/);
});
