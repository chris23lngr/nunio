import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context, page }) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "sidebar-browser-test",
      domain: "localhost",
      path: "/",
    },
  ]);
  await page.goto("/account");
});

test("the header menu fits its content and the opener stays outside page layout", async ({
  page,
  isMobile,
}) => {
  const opener = page.getByRole("button", { name: "Sidebar öffnen" });
  const mainTop = (await page.getByRole("main").boundingBox())!.y;
  if (isMobile) await opener.click();
  const trigger = page.getByRole("button", { name: "Justus Schuhmacher" });
  await expect(trigger).toBeVisible();
  const restingColor = await trigger.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  if (!isMobile) {
    await trigger.hover();
    await expect
      .poll(() =>
        trigger.evaluate(
          (element) => getComputedStyle(element).backgroundColor,
        ),
      )
      .not.toBe(restingColor);
  }
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  expect(
    await menu.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await expect(
    menu.getByRole("menuitem", { name: "Upgrade durchführen" }).locator("svg"),
  ).not.toHaveCSS(
    "color",
    await menu
      .getByRole("menuitem", { name: "Einstellungen" })
      .locator("svg")
      .evaluate((element) => getComputedStyle(element).color),
  );
  await page.screenshot({ path: test.info().outputPath("user-menu.png") });
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Sidebar schließen" }).click();
  await expect(opener).toBeVisible();
  await expect(opener).toHaveCSS("position", "absolute");
  await expect(opener).toHaveCSS("width", "30px");
  await expect(opener).toHaveCSS("height", "30px");
  expect((await opener.boundingBox())!.x).toBe(20);
  expect((await opener.boundingBox())!.y).toBe(24);
  expect((await page.getByRole("main").boundingBox())!.y).toBe(mainTop);
  await opener.click();
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page
    .getByRole("menuitem", { name: "Einstellungen", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/security$/);
  if (isMobile)
    await expect(page.getByRole("dialog", { name: "Sidebar" })).toBeHidden();
});

test("long student identity fits the sidebar and the menu stays inside the viewport", async ({
  page,
  isMobile,
}) => {
  const name = "Alexandra Marie Caroline Elizabeth Charlotte Schuhmacher";
  const email = `${"alexandra".repeat(10)}@example.com`;
  await page.route("http://localhost:3101/api/auth/get-session**", (route) =>
    route.fulfill({
      json: {
        session: {
          id: "sidebar-session",
          token: "sidebar-token",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
        user: { id: "student", name, email, emailVerified: true },
      },
    }),
  );
  await page.reload();
  if (isMobile)
    await page.getByRole("button", { name: "Sidebar öffnen" }).click();
  const trigger = page.getByRole("button", { name });
  await expect(trigger).toBeVisible();
  const label = trigger.getByText(name, { exact: true });
  expect(
    await label.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Sidebar schließen" }),
  ).toBeInViewport();
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  expect(
    await menu.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await expect(menu.getByText(email)).toBeVisible();
});
