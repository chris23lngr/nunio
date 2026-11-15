import { expect, test } from "@playwright/test";

const practiceSetId = "00000000-0000-4000-8000-000000000700";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "artifact-browser-test",
      domain: "localhost",
      path: "/",
    },
  ]);
});

test("the list of questions jumps to a question and marks the one in view", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The list of questions shows on wide screens only.");
  await page.goto(`/artifacts/${practiceSetId}`);
  const questions = page.getByRole("navigation", { name: "Fragen" });
  const link = (n: number) =>
    questions.getByRole("link", { name: new RegExp(`^${n}\\. `) });
  await expect(link(1)).toHaveAttribute("aria-current", "location");
  await page.screenshot({
    path: test.info().outputPath("practice-set.png"),
    fullPage: true,
  });

  await link(5).click();

  await expect(page).toHaveURL(/#frage-5$/);
  await expect(page.locator("#frage-5")).toBeInViewport();
  await expect(link(5)).toHaveAttribute("aria-current", "location");

  await page
    .locator("#frage-2")
    .evaluate((question) => question.scrollIntoView({ block: "start" }));

  await expect(link(2)).toHaveAttribute("aria-current", "location");
});
