import { randomUUID } from "node:crypto";
import { createPool, createPrismaClient } from "@nunio/db";
import { expect, test } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { origins } from "../origins.js";

test("the student asks for a practice set from the Artifacts page and sees it being made", async ({
  page,
  context,
}, testInfo) => {
  const cors = {
    "access-control-allow-origin": origins.app,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
  const email = `artifacts-${randomUUID()}@example.com`;
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
  const course = {
    id: randomUUID(),
    code: null,
    title: "Statistics II",
    status: "accepted",
    semester: "2026-ws",
    color: "violet",
    entered: false,
    archived: false,
    next: null,
    lastActivityAt: new Date().toISOString(),
  };
  const topicId = randomUUID();
  const artifactId = randomUUID();
  const asked: unknown[] = [];
  await context.route(`${origins.api}/api/me/courses`, (route) =>
    route.fulfill({
      headers: cors,
      json: { current: "2026-ws", choices: ["2026-ws"], courses: [course] },
    }),
  );
  await context.route(
    `${origins.api}/api/me/courses/${course.id}/artifact-options`,
    (route) =>
      route.fulfill({
        headers: cors,
        json: {
          topics: [{ id: topicId, title: "Hypothesentests", level: "shaky" }],
          obligations: [],
        },
      }),
  );
  await context.route(`${origins.api}/api/me/artifacts`, (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    if (request.method() === "POST") {
      asked.push(request.postDataJSON());
      return route.fulfill({
        headers: cors,
        status: 202,
        json: { artifactId, runId: randomUUID() },
      });
    }
    const now = new Date().toISOString();
    return route.fulfill({
      headers: cors,
      json: asked.length
        ? [
            {
              id: artifactId,
              kind: "practice_set",
              status: "making",
              failure: null,
              topicIds: [topicId],
              obligationId: null,
              createdAt: now,
              openedAt: null,
              withdrawn: false,
              title: "Hypothesentests",
              courseId: course.id,
              count: null,
              version: null,
              updatedAt: null,
              lastPractisedAt: null,
              shaky: true,
            },
          ]
        : [],
    });
  });
  await context.route(`${origins.api}/**`, (route) =>
    route.request().method() === "OPTIONS"
      ? route.fulfill({ status: 204, headers: cors })
      : route.fallback(),
  );

  await page.setViewportSize({ width: 1470, height: 900 });
  await page.goto(`${origins.app}/sign-in`);
  await page.getByLabel("E-Mail").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Mit E-Mail anmelden", exact: true })
    .click();
  await expect(page).toHaveURL(`${origins.app}/`);
  await page.goto(`${origins.app}/artifacts`);
  await expect(
    page.getByRole("heading", { name: "Noch keine Artefakte" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Erstellen" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Artefakt erstellen" });
  await expect(
    sheet.getByRole("checkbox", { name: /Hypothesentests/ }),
  ).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("artifacts-create.png") });
  await sheet.getByRole("button", { name: "Übungsset erstellen" }).click();

  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(`${origins.app}/artifacts`);
  const card = page
    .getByRole("list", { name: "Artefakte" })
    .getByRole("listitem");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Wird erstellt");
  await expect(card).toContainText("Übungsset in Statistics II");
  expect(asked).toEqual([
    {
      kind: "practice_set",
      topicIds: [topicId],
      from: { selection: { courseIds: [course.id], sourceIds: [] } },
    },
  ]);
  await page.screenshot({ path: testInfo.outputPath("artifacts-making.png") });
});
