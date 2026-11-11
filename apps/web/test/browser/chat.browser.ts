import { expect, test } from "@playwright/test";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "chat-browser-test",
      domain: "localhost",
      path: "/",
    },
  ]);
});

test("saving an answer keeps the reader where they scrolled", async ({
  page,
  request,
}) => {
  await page.goto("/chat?id=00000000-0000-4000-8000-000000000001");
  await expect(page.getByText("Frage 6")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Nachricht" })
    .fill("Noch eine Frage");
  await page.getByRole("button", { name: "Nachricht senden" }).click();
  await expect(page.getByText("Die gestreamte Antwort.").first()).toBeVisible();
  const viewport = page.getByLabel("Nachrichten");
  await viewport.hover();
  await page.mouse.wheel(0, -100_000);
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeLessThan(10);
  await request.get("http://localhost:3101/release-stream");
  await expect(
    page.getByRole("article", { name: "Antwort von nunio" }).last(),
  ).toContainText("Die gestreamte Antwort.");
  await page.waitForTimeout(500);
  expect(await viewport.evaluate((element) => element.scrollTop)).toBeLessThan(
    10,
  );
});
