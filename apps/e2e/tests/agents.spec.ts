import { randomUUID } from "node:crypto";
import type { Route } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { origins } from "../origins.js";
import { createStudent, signInAs } from "../students.js";

// The Agents main flow end to end against a stubbed API (#193): Template, then form, then save, then "Jetzt starten",
// then Aktivität with the Run's Approval card. The Run itself is the stub's; the worker tests cover what it does.
test("a student starts an Agent from a Template, runs it and finds its Approval in Aktivität", async ({
  page,
  context,
}) => {
  const cors = {
    "access-control-allow-origin": origins.app,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
  const agentId = randomUUID();
  const runId = randomUUID();
  const course = {
    id: randomUUID(),
    title: "Statistik II",
    color: "violet",
    archived: false,
    topics: 6,
    sources: 2,
  };
  const instructions = [
    "Halte meine Kurse organisiert.",
    "Achte auf neue Termine, Abgaben und Themen. Lege Aufgaben für Abgaben und Termine an, die Vorbereitung brauchen, und plane genug Lernzeit vor ihren Fristen ein.",
    "Wenn etwas nicht mehr in meine Woche passt, sag mir Bescheid.",
  ].join("\n\n");
  const template = {
    id: "organizeCourse",
    name: "Kurs organisieren",
    description: "Behält Termine, Themen und deinen Lernplan im Blick.",
    emoji: "📚",
    instructions,
    trigger: { rhythm: "daily", minute: 360 },
    courses: "none",
    capabilities: [
      { id: "createStudyBlocks", mode: "automatic" },
      { id: "createTasks", mode: "ask" },
    ],
    createdOn: "2026-11-19",
    othersCount: 0,
  };
  const capabilitySet = [
    {
      id: "createStudyBlocks",
      section: "Lernblöcke",
      title: "Lernblöcke erstellen",
      description: "Neue Lernzeit in freie Zeitfenster eintragen.",
      modes: ["automatic", "always", "ask"],
    },
    {
      id: "createTasks",
      section: "Aufgaben",
      title: "Aufgaben erstellen",
      description: "Neue Aufgaben in deinen Kursen anlegen.",
      modes: ["ask", "automatic", "always"],
    },
  ];
  const sonnet = "sonnet-5.5-reasoning-high";
  const models = {
    models: [
      {
        key: sonnet,
        name: "Sonnet 5.5",
        provider: "Anthropic",
        description: "Ausgewogen für Erklärungen und alltägliches Lernen.",
        dataHandling: {
          provider: "OpenRouter",
          upstream: ["Amazon Bedrock"],
          routing: "international",
          zeroRetention: true,
        },
        cost: { relativeToDefault: 1, tier: "medium" },
      },
    ],
    default: sonnet,
    selected: sonnet,
  };
  const saved: unknown[] = [];
  let running = false;
  let ran = false;
  const startedAt = new Date().toISOString();
  const agent = () => ({
    id: agentId,
    name: template.name,
    description: template.description,
    emoji: template.emoji,
    instructions,
    courses: [course],
    capabilities: template.capabilities,
    connections: [],
    state: "active",
    pausedBy: null,
    running,
    grants: ["studyBlock.create"],
    budget: { limitMicroUsd: 5_000_000, usedMicroUsd: 0, heldMicroUsd: 0 },
    trigger: template.trigger,
    modelKey: sonnet,
    next: { runAt: null },
    approvalRunId: ran && !running ? runId : null,
  });
  const run = () => ({
    id: runId,
    status: running ? "running" : "done",
    trigger: "manual",
    startedAt,
    endedAt: running ? null : startedAt,
    stopReason: null,
    openApprovals: running ? 0 : 1,
  });
  const askedTask = {
    kind: "task.create",
    work: {
      title: "Übungsblatt 4 vorbereiten",
      course: course.title,
      obligation: "Übungsblatt 4",
    },
  };
  const detail = () => ({
    ...run(),
    costMicroUsd: 42_000,
    budgetMicroUsd: 5_000_000,
    summary: running
      ? null
      : "Ich habe dich gefragt, ob ich eine Aufgabe für Übungsblatt 4 anlegen darf.",
    summaryGone: false,
    verlauf: [
      { type: "start", at: startedAt, trigger: "manual" },
      ...(running
        ? []
        : [
            {
              type: "action",
              at: startedAt,
              step: 2,
              capability: "createTasks",
              action: { ...askedTask, start: null, end: null },
              outcome: "awaiting_approval",
              refusal: null,
              brokenPreferences: [],
            },
            { type: "end", at: startedAt, status: "done", reason: null },
          ]),
    ],
    approvals: running
      ? []
      : [
          {
            actionId: randomUUID(),
            action: {
              ...askedTask,
              from: null,
              to: null,
              task: {
                role: null,
                minutes: 60,
                event: null,
                obligation: "Übungsblatt 4",
              },
            },
            fingerprint: "fp-task",
            expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
            agent: { id: agentId, name: template.name },
          },
        ],
  });
  /** The stub API: each route as method and path, answered with JSON. */
  const routes: Record<string, (route: Route) => unknown> = {
    "GET /api/me/agents/templates": () => [template],
    "GET /api/me/agents/capabilities": () => capabilitySet,
    "GET /api/me/agents/courses": () => [course],
    "GET /api/me/agents/connections": () => [],
    "GET /api/me/models": () => models,
    "GET /api/me/allowance": () => ({
      limitMicroUsd: 5_000_000,
      usedMicroUsd: 0,
      heldMicroUsd: 0,
    }),
    "POST /api/me/agents": (route) => {
      saved.push(route.request().postDataJSON());
      return { id: agentId };
    },
    [`GET /api/me/agents/${agentId}`]: agent,
    [`GET /api/me/agents/${agentId}/runs`]: () => ({
      runs: ran ? [run()] : [],
      nextCursor: null,
    }),
    [`POST /api/me/agents/${agentId}/runs`]: () => {
      running = true;
      ran = true;
      return { id: runId };
    },
    [`GET /api/me/agents/${agentId}/runs/${runId}`]: detail,
  };
  await context.route(
    (url) =>
      url.origin === origins.api &&
      /^\/api\/me\/(agents|models|allowance)\b/.test(url.pathname),
    (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS")
        return route.fulfill({ status: 204, headers: cors });
      const answer =
        routes[`${request.method()} ${new URL(request.url()).pathname}`];
      if (!answer) return route.fulfill({ status: 404, headers: cors });
      return route.fulfill({
        status: request.method() === "POST" ? 201 : 200,
        headers: cors,
        json: answer(route),
      });
    },
  );

  await signInAs(page, await createStudent("agents"));
  await page.goto(`${origins.app}/agents/templates`);

  // Template: its details, then "Template verwenden".
  await page.getByRole("button", { name: /Kurs organisieren/ }).click();
  const details = page.getByRole("dialog", { name: /Kurs organisieren/ });
  await expect(details).toContainText(template.description);
  await expect(details).toContainText("Erstellt am 19.11.2026");
  await details.getByRole("link", { name: "Template verwenden" }).click();
  await expect(page).toHaveURL(
    `${origins.app}/agents/new?template=organizeCourse`,
  );

  // Form: prefilled from the Template; the student adds a Course.
  await expect(page.getByLabel("Name")).toHaveValue("Kurs organisieren");
  await expect(page.getByRole("textbox", { name: "Auftrag" })).toHaveValue(
    instructions,
  );
  await page.getByRole("button", { name: "Kurse bearbeiten" }).click();
  const courses = page.getByRole("dialog", { name: "Kurse verwalten" });
  await courses.getByRole("checkbox", { name: /Statistik II/ }).click();
  await courses.getByRole("button", { name: "Speichern" }).click();
  await expect(courses).toBeHidden();
  expect(saved).toEqual([]);

  // Save: the Template's configuration with the Course, then the saved Agent's page.
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page).toHaveURL(`${origins.app}/agents/${agentId}`);
  expect(saved).toEqual([
    {
      name: "Kurs organisieren",
      description: template.description,
      emoji: template.emoji,
      instructions,
      courseIds: [course.id],
      capabilities: template.capabilities,
      connections: [],
      budgetMicroUsd: 5_000_000,
      trigger: { rhythm: "daily", minute: 360 },
      modelKey: sonnet,
      templateId: "organizeCourse",
    },
  ]);

  // "Jetzt starten": the Run is under way until the stub ends it.
  await page.getByRole("button", { name: "Jetzt starten" }).click();
  await expect(
    page.getByRole("button", { name: "Läuft gerade…" }),
  ).toBeDisabled();
  running = false;
  await expect(page.getByRole("button", { name: "Jetzt starten" })).toBeEnabled(
    { timeout: 10_000 },
  );

  // Aktivität: the Run, its Verlauf, and its Approval card as nunio renders it.
  await page.getByRole("tab", { name: "Aktivität" }).click();
  await expect(
    page.getByRole("navigation", { name: "Läufe" }).getByRole("button"),
  ).toHaveCount(1);
  const freigaben = page.getByRole("region", { name: "Freigaben" });
  const card = freigaben.getByRole("group");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Aufgabe anlegen");
  await expect(card).toContainText(
    "„Übungsblatt 4 vorbereiten“ · Statistik II",
  );
  await expect(card).toContainText("Zählt für „Übungsblatt 4“");
  await expect(card.getByRole("button", { name: "Akzeptieren" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Ablehnen" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Verlauf" })).toContainText(
    "Freigabe angefragt: Aufgabe anlegen",
  );
});
