import type { BrowserContext } from "@playwright/test";
import { expect, test } from "@playwright/test";

const chatId = "00000000-0000-4000-8000-000000000001";

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: "chat-history-browser-test",
      domain: "localhost",
      path: "/",
    },
  ]);
});

/** Remembers `chat` as open on this device for `student`, as the Chat screen does. */
const remember = (context: BrowserContext, student: string, chat: string) =>
  context.addCookies([
    {
      name: "nunio_open_chat",
      value: encodeURIComponent(`${student}:${chat}`),
      domain: "localhost",
      path: "/",
    },
  ]);

test("returning to the Chat page reopens the Chat remembered on this device", async ({
  page,
  context,
}) => {
  await remember(context, "student", chatId);

  await page.goto("/chat");

  await expect(page).toHaveURL(`/chat?id=${chatId}`);
  await expect(page.getByText("Frage 6")).toBeVisible();
});

test("a Chat another student left open on this device is not reopened", async ({
  page,
  context,
}) => {
  await remember(context, "someone-else", chatId);

  await page.goto("/chat");

  await expect(page.getByRole("heading", { name: /Justus/ })).toBeVisible();
  await expect(page).toHaveURL("/chat");
});

test("after Neuer Chat, returning to the Chat page stays on an empty Chat", async ({
  page,
  context,
}) => {
  await remember(context, "student", chatId);
  await page.goto("/chat");
  await expect(page.getByText("Frage 6")).toBeVisible();

  await page.getByRole("button", { name: "Neuer Chat" }).click();
  await expect(page).toHaveURL("/chat");
  await page.reload();

  await expect(page.getByRole("heading", { name: /Justus/ })).toBeVisible();
  await expect(page).toHaveURL("/chat");
});

test("a remembered Chat that is gone quietly opens an empty Chat instead", async ({
  page,
  context,
}) => {
  await remember(context, "student", "00000000-0000-4000-8000-000000000404");

  await page.goto("/chat");

  await expect(page.getByRole("heading", { name: /Justus/ })).toBeVisible();
  await expect(page).toHaveURL("/chat");
  await expect(
    page.getByText("Dieser Chat ist nicht mehr verfügbar."),
  ).toHaveCount(0);
  expect(
    (await context.cookies()).some(({ name }) => name === "nunio_open_chat"),
  ).toBe(false);
});

test("all Chats load page by page while scrolling down", async ({ page }) => {
  await page.goto("/chat/history");
  const chats = page
    .getByRole("list", { name: "Deine letzten Chats" })
    .getByRole("link");
  await expect(chats).toHaveCount(30);
  await expect(chats.first()).toContainText("Frage 1");
  await expect(chats.first()).toContainText("Vor 4 Tagen");

  await chats.last().scrollIntoViewIfNeeded();

  await expect(chats).toHaveCount(35);
  await expect(chats.last()).toContainText("Älterer Chat 34");
});

test("Zurück from all Chats returns to the Chat the student came from", async ({
  page,
}) => {
  await page.goto(`/chat?id=${chatId}`);
  await expect(page.getByText("Frage 6")).toBeVisible();
  await page.getByRole("button", { name: "Letzte Chats" }).click();
  await page.getByRole("menuitem", { name: "Alle anzeigen" }).click();
  await expect(page).toHaveURL(`/chat/history?from=${chatId}`);

  await page.getByRole("link", { name: "Zurück" }).click();

  await expect(page).toHaveURL(`/chat?id=${chatId}`);
  await expect(page.getByText("Frage 6")).toBeVisible();
});
