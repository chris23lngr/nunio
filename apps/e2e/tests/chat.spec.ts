import { randomUUID } from "node:crypto";
import { createPool, createPrismaClient } from "@nunio/db";
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { origins } from "../origins.js";

test("Chat keeps its composer visible on desktop and mobile and opens citations in a new tab", async ({
  page,
  context,
}, testInfo) => {
  const cors = {
    "access-control-allow-origin": origins.app,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
  const email = `chat-${randomUUID()}@example.com`;
  const password = "correct horse battery staple";
  const userId = randomUUID();
  const prisma = createPrismaClient(
    createPool(process.env.INVITATION_DATABASE_URL!),
  );
  try {
    await prisma.rateLimit.deleteMany();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Justus Schuhmacher",
        email,
        emailVerified: true,
        accounts: {
          create: {
            id: randomUUID(),
            accountId: userId,
            providerId: "credential",
            password: await hashPassword(password),
          },
        },
      },
    });
  } finally {
    await prisma.$disconnect();
  }
  const id = randomUUID();
  const sourceId = randomUUID();
  const course = {
    id: randomUUID(),
    title: "Microeconomics",
    code: "MICD",
    status: "accepted",
  };
  const messages: unknown[] = [];
  await context.route(`${origins.api}/api/me/review`, (route) =>
    route.fulfill({ headers: cors, json: { courses: [course] } }),
  );
  await context.route(`${origins.api}/api/me/chats`, (route) => {
    expect(route.request().postDataJSON()).toEqual({
      courseIds: [course.id],
      sourceIds: [],
    });
    return route.fulfill({ headers: cors, status: 201, json: { id } });
  });
  await context.route(`${origins.api}/api/me/chats/${id}`, (route) =>
    route.fulfill({ headers: cors, json: { id, courses: [course], messages } }),
  );
  let answer!: () => void;
  await context.route(
    `${origins.api}/api/me/chats/${id}/messages`,
    async (route) => {
      await new Promise<void>((resolve) => {
        answer = resolve;
      });
      const question = {
        id: randomUUID(),
        role: "student",
        text: route.request().postDataJSON().text,
        createdAt: new Date().toISOString(),
        citations: [],
      };
      const response = {
        id: randomUUID(),
        role: "assistant",
        text: `## Antwort aus Kursmaterial\n\n${"Ein Absatz zum aktiven Lernen.\n\n".repeat(25)}| Methode | Beschreibung | Minuten |\n| --- | --- | ---: |\n| Abrufen | Eine ausführliche Beschreibung der Lernmethode | 15 |\n\nQuelle [S1].`,
        createdAt: new Date().toISOString(),
        citations: [
          {
            tag: "S1",
            provenance: {
              kind: "source",
              sourceId,
              title: "Handbuch.pdf",
              location: { page: 2 },
            },
          },
        ],
      };
      messages.push(question, response);
      await route.fulfill({ headers: cors, json: { ...response, question } });
    },
  );
  await context.route(
    `${origins.api}/api/me/sources/${sourceId}/download`,
    (route) =>
      route.fulfill({
        headers: cors,
        json: {
          title: "Handbuch.pdf",
          url: `${origins.api}/test-pdf`,
          headers: {},
        },
      }),
  );
  await context.route(`${origins.api}/test-pdf`, (route) =>
    route.fulfill({
      headers: cors,
      contentType: "application/pdf",
      body: "%PDF-1.7\n",
    }),
  );
  await context.route(`${origins.api}/**`, (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: cors })
      : route.fallback(),
  );
  await page.setViewportSize({ width: 1728, height: 1117 });
  await page.goto(`${origins.app}/sign-in`);
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Mit E-Mail anmelden", exact: true })
    .click();
  await expect(page).toHaveURL(`${origins.app}/`);
  await page.goto(`${origins.app}/chat`);
  await expect(page.getByRole("heading", { name: /Justus/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Modell auswählen/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Neuer Chat", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Justus/ })).toHaveCSS(
    "font-size",
    "30px",
  );
  await page.screenshot({
    path: testInfo.outputPath("chat-empty-desktop.png"),
  });
  await page.getByRole("button", { name: "Kurs auswählen" }).click();
  await page.getByRole("menuitemcheckbox", { name: /Microeconomics/ }).click();
  await page.keyboard.press("Escape");
  const textarea = page.getByRole("textbox", {
    name: "Nachricht",
    exact: true,
  });
  await page
    .getByRole("button", { name: "Wie sieht mein Lernplan für heute aus?" })
    .click();
  await expect(textarea).toHaveValue("Wie sieht mein Lernplan für heute aus?");
  await textarea.press("Enter");
  await expect(
    page
      .getByRole("status", { name: "" })
      .filter({ hasText: "nunio antwortet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nachricht senden" }),
  ).toBeDisabled();
  await expect(textarea).toHaveValue("");
  await expect.poll(() => typeof answer).toBe("function");
  answer();
  await expect(
    page.getByRole("heading", { name: "Antwort aus Kursmaterial" }),
  ).toBeAttached();
  await expect(textarea).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Kurs auswählen" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Kurs auswählen" })).toHaveCSS(
    "opacity",
    "0.5",
  );
  for (const width of [1728, 768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(textarea).toBeInViewport();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBe(844);
    const group = await page.locator("[data-slot=input-group]").boundingBox();
    expect(844 - (group!.y + group!.height)).toBeCloseTo(
      width < 640 ? 12 : 24,
      0,
    );
    const box = await textarea.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  }
  await page.screenshot({
    path: testInfo.outputPath("chat-mobile.png"),
    fullPage: true,
  });
  const popupPromise = context.waitForEvent("page");
  await page.getByRole("link", { name: "Handbuch.pdf, Seite 2" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(`${origins.app}/sources/${sourceId}?page=2`);
  await expect(
    popup.getByRole("heading", { name: "Handbuch.pdf" }),
  ).toBeVisible();
  await expect(popup.locator("iframe")).toHaveAttribute("src", /#page=2$/);
  await popup.close();
  await page.getByRole("link", { name: "Neuer Chat", exact: true }).click();
  await expect(page.getByRole("heading", { name: /Justus/ })).toBeVisible();
  await expect(textarea).toHaveValue("");
  await expect(page.getByText("Microeconomics", { exact: true })).toHaveCount(
    0,
  );
  await page.goto(`${origins.app}/chat?id=${id}`);
  await expect(page.getByText("Microeconomics", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Handbuch.pdf, Seite 2" }),
  ).toBeAttached();
});
