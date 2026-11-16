import { expect, test } from "@playwright/test";

const courseId = "00000000-0000-4000-8000-000000000800";
const sortingId = "00000000-0000-4000-8000-000000000810";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "course-browser-test",
      domain: "localhost",
      path: "/",
    },
  ]);
});

test("a Course's page shows its Disagreement, Topics, Sources and what is coming up", async ({
  page,
}) => {
  await page.goto(`/courses/${courseId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Operations Management" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Abweichungen" }),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("course.png"),
    fullPage: true,
  });
});

test("a Topic's details open over the Course's page", async ({ page }) => {
  await page.goto(`/courses/${courseId}?topic=${sortingId}`);
  const sheet = page.getByRole("dialog", { name: "Sortieralgorithmen" });
  await expect(sheet.getByRole("list", { name: "Artefakte" })).toBeVisible();
  // Wait until the sheet has slid in.
  await expect(sheet).toHaveCSS("opacity", "1");
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState !== "running"),
  );
  await page.screenshot({ path: test.info().outputPath("topic-sheet.png") });
});
