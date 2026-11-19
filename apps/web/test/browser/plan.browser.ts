import type { Page } from "@playwright/test";
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
  await page.goto("/plan");
  await expect(page.getByRole("group", { name: /^Montag/ })).toBeVisible();
});

/** The grid's scroll area and its Monday column, measured in the page. */
function measure(page: Page) {
  return page.getByRole("group", { name: /^Montag/ }).evaluate((monday) => {
    let grid = monday.parentElement!;
    while (getComputedStyle(grid).overflowY !== "auto")
      grid = grid.parentElement!;
    const box = grid.getBoundingClientRect();
    return {
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      clientWidth: grid.clientWidth,
      clientHeight: grid.clientHeight,
      scrollWidth: grid.scrollWidth,
      scrollHeight: grid.scrollHeight,
      dayWidth: monday.getBoundingClientRect().width,
      hourHeight: monday.firstElementChild!.getBoundingClientRect().height,
    };
  });
}

function scrollGrid(page: Page, left: number, top: number) {
  return page.getByRole("group", { name: /^Montag/ }).evaluate(
    (monday, [x, y]) => {
      let grid = monday.parentElement!;
      while (getComputedStyle(grid).overflowY !== "auto")
        grid = grid.parentElement!;
      grid.scrollTo({ left: x, top: y, behavior: "instant" });
    },
    [left, top],
  );
}

test("the week's controls sit in the navbar above the grid", async ({
  page,
}) => {
  const navbar = page.locator("header").filter({ hasText: "Heute" });
  for (const name of ["Vorherige Woche", "Nächste Woche", "Anzeige"])
    await expect(
      navbar.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  await expect(
    navbar.getByRole("button", { name: /^Vorschläge anzeigen/ }),
  ).toBeVisible();
  expect((await navbar.boundingBox())!.height).toBe(64);
  expect((await measure(page)).top).toBeGreaterThanOrEqual(64);
});

test("on a desktop the grid fills the rest of the screen without scrolling", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Mobile shows two days at a time instead.");
  const viewport = page.viewportSize()!;
  const grid = await measure(page);

  expect(grid.right).toBe(viewport.width);
  expect(grid.bottom).toBe(viewport.height);
  expect(grid.scrollWidth).toBe(grid.clientWidth);
  expect(grid.scrollHeight).toBe(grid.clientHeight);
  expect(grid.dayWidth).toBeGreaterThan(128);
  expect(grid.hourHeight).toBeGreaterThan(32);
});

test("below the minimum cell size the grid scrolls under the navbar and day headers", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Covered by the two-day view.");
  await page.setViewportSize({ width: 900, height: 420 });
  const before = await measure(page);
  expect(before.dayWidth).toBe(128);
  expect(before.hourHeight).toBe(32);
  expect(before.scrollWidth).toBeGreaterThan(before.clientWidth);
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

  const dayHeader = page.getByText(/^Montag, /);
  const headerTop = (await dayHeader.boundingBox())!.y;
  const gutter = page.getByText("12:00");
  const gutterLeft = (await gutter.boundingBox())!.x;
  await scrollGrid(page, 200, 120);

  expect((await dayHeader.boundingBox())!.y).toBe(headerTop);
  expect((await gutter.boundingBox())!.x).toBe(gutterLeft);
  await expect(
    page.locator("header").getByRole("button", { name: "Heute" }),
  ).toBeInViewport();
});

test("on mobile two days share the width and the grid snaps to whole days", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Desktop shows the whole week.");
  const grid = await measure(page);
  expect(grid.dayWidth).toBeCloseTo((grid.clientWidth - 48) / 2, 0);

  // A little past one day settles on the next day's edge.
  await scrollGrid(page, grid.dayWidth + 20, 0);
  const tuesday = page.getByRole("group", { name: /^Dienstag/ });
  await expect
    .poll(async () => (await tuesday.boundingBox())!.x)
    .toBeCloseTo(48, 0);
});
