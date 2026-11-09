import { expect, test } from "@playwright/test";
import { origins } from "../origins.js";

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
  await expect(
    page.getByRole("link", { name: "Passwort vergessen?" }),
  ).toHaveAttribute("href", "/forgot-password");
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
  const submit = page.getByRole("button", { name: "Mit E-Mail registrieren" });
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

test("registration is accessible without an invitation and shows the API's rejection", async ({
  page,
}) => {
  await page.goto(`${origins.app}/sign-up`);
  await page.getByLabel("Name", { exact: true }).fill("Nicht eingeladen");
  await page.getByLabel("E-Mail").fill("uninvited@example.com");
  await page.getByLabel("Passwort", { exact: true }).fill("password123");
  await page.getByLabel("Passwort bestätigen").fill("password123");
  await page.getByRole("checkbox").check();
  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/sign-up/email"),
  );
  await page.getByRole("button", { name: "Mit E-Mail registrieren" }).click();
  expect((await responsePromise).status()).toBe(403);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "A valid invitation is required",
  );
  await expect(page).toHaveURL(`${origins.app}/sign-up`);
});
