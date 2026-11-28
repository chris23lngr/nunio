import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { AgentsScreen } from "@/features/agents/agents-screen";
import { NewAgentScreen } from "@/features/agents/new-agent-screen";
import { TemplatesScreen } from "@/features/agents/templates-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/agents/templates",
}));

function Providers({ children }: { children: ReactNode }) {
  return (
    <TestProviders>
      <SidebarProvider>{children}</SidebarProvider>
    </TestProviders>
  );
}

const capabilitySet = [
  {
    id: "createStudyBlocks",
    section: "Lernblöcke",
    title: "Lernblöcke erstellen",
    description: "Neue Lernzeit in freie Zeitfenster eintragen.",
    modes: ["automatic", "always", "ask"],
  },
  {
    id: "moveOwnStudyBlocks",
    section: "Lernblöcke",
    title: "Eigene Lernblöcke verschieben",
    description: "Nur Blöcke, die dieser Agent erstellt hat.",
    modes: ["automatic", "always", "ask"],
  },
  {
    id: "moveStudyBlocks",
    section: "Lernblöcke",
    title: "Lernblöcke verschieben",
    description: "Auch Blöcke, die du oder andere geplant haben.",
    modes: ["ask"],
  },
  {
    id: "removeOwnStudyBlocks",
    section: "Lernblöcke",
    title: "Eigene Lernblöcke entfernen",
    description: "Nur Blöcke, die dieser Agent erstellt hat.",
    modes: ["automatic", "always", "ask"],
  },
  {
    id: "createTasks",
    section: "Aufgaben",
    title: "Aufgaben erstellen",
    description:
      "Neue Aufgaben in deinen Kursen anlegen, auch zu Prüfungen und Abgaben oder zur Vor- und Nachbereitung.",
    modes: ["ask", "automatic", "always"],
  },
  {
    id: "createFlashcards",
    section: "Lernmaterial",
    title: "Karteikarten erstellen",
    description: "Karteikarten zu Themen deiner Kurse erstellen.",
    modes: [],
  },
  {
    id: "createPracticeSets",
    section: "Lernmaterial",
    title: "Übungsaufgaben erstellen",
    description: "Übungsaufgaben zu Themen deiner Kurse erstellen.",
    modes: [],
  },
  {
    id: "notifyStudent",
    section: "Benachrichtigungen",
    title: "Dich benachrichtigen",
    description:
      "Dir eine kurze Nachricht in deine Inbox schreiben, höchstens eine pro Lauf.",
    modes: [],
  },
  {
    id: "createBriefing",
    section: "Briefings",
    title: "Briefing erstellen",
    description:
      "Offene Hinweise, Freigaben, ungelesene Nachrichten und fertiges Lernmaterial zu einem Briefing in deiner Inbox zusammenfassen.",
    modes: [],
  },
];

const templatesFixture = [
  {
    id: "prepareExam",
    name: "Klausur vorbereiten",
    description: "Plant deine Vorbereitung bis zum Prüfungstag.",
    emoji: "🎯",
    instructions: [
      "Bereite mich auf die nächste Klausur in meinen Kursen vor.",
      "Verteile die Themen bis zum Prüfungstag auf realistische Lernblöcke. Priorisiere Themen, bei denen ich noch unsicher bin, und plane Wiederholungen ein.",
      "Prüfe bei jedem Start meinen Fortschritt und passe den Plan an. Lass meine selbst geplanten Lernblöcke unverändert.",
    ].join("\n\n"),
    trigger: { rhythm: "daily", minute: 360 },
    courses: "none",
    capabilities: [
      { id: "createStudyBlocks", mode: "automatic" },
      { id: "moveOwnStudyBlocks", mode: "automatic" },
      { id: "removeOwnStudyBlocks", mode: "automatic" },
      { id: "notifyStudent", mode: null },
    ],
    createdOn: "2026-11-19",
    othersCount: 4,
  },
  {
    id: "organizeCourse",
    name: "Kurs organisieren",
    description: "Behält Termine, Themen und deinen Lernplan im Blick.",
    emoji: "📚",
    instructions: [
      "Halte meine Kurse organisiert.",
      "Achte auf neue Termine, Abgaben und Themen. Lege Aufgaben für Abgaben und Termine an, die Vorbereitung brauchen, und plane genug Lernzeit vor ihren Fristen ein.",
      "Wenn etwas nicht mehr in meine Woche passt, sag mir Bescheid.",
    ].join("\n\n"),
    trigger: { rhythm: "daily", minute: 360 },
    courses: "none",
    capabilities: [
      { id: "createStudyBlocks", mode: "automatic" },
      { id: "moveOwnStudyBlocks", mode: "automatic" },
      { id: "removeOwnStudyBlocks", mode: "automatic" },
      { id: "createTasks", mode: "ask" },
      { id: "notifyStudent", mode: null },
    ],
    createdOn: "2026-11-19",
    othersCount: 0,
  },
  {
    id: "createBriefings",
    name: "Briefings erstellen",
    description: "Gibt dir täglich Updates über deinen Lernfortschritt.",
    emoji: "📧",
    instructions:
      "Fasse jeden Morgen kurz zusammen, was heute für mich ansteht: offene Freigaben, neue Nachrichten, fertiges Lernmaterial und was in meinem Plan als Nächstes kommt.",
    trigger: { rhythm: "daily", minute: 420 },
    courses: "all_active",
    capabilities: [{ id: "createBriefing", mode: null }],
    createdOn: "2026-11-19",
    othersCount: 2,
  },
];

const chatModels = {
  models: [
    {
      key: "sonnet-5.5-reasoning-high",
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
  default: "sonnet-5.5-reasoning-high",
  selected: "sonnet-5.5-reasoning-high",
};

const activeCourses = [
  {
    id: "c0000000-0000-4000-8000-000000000001",
    title: "Statistik I",
    color: "rose",
    archived: false,
    topics: 6,
    sources: 3,
  },
  {
    id: "c0000000-0000-4000-8000-000000000002",
    title: "Algorithmen",
    color: "violet",
    archived: false,
    topics: 4,
    sources: 2,
  },
];

beforeEach(() => {
  replace.mockReset();
  api.route("GET", "/api/me/agents/templates", () =>
    Response.json(templatesFixture),
  );
  api.route("GET", "/api/me/agents/capabilities", () =>
    Response.json(capabilitySet),
  );
  api.route("GET", "/api/me/models", () => Response.json(chatModels));
  api.route("GET", "/api/me/agents/courses", () =>
    Response.json(activeCourses),
  );
  api.route("GET", "/api/me/agents/connections", () => Response.json([]));
  // The form's builder panel reads whether the Allowance is left.
  api.route("GET", "/api/me/allowance", () =>
    Response.json({
      limitMicroUsd: 5_000_000,
      usedMicroUsd: 0,
      heldMicroUsd: 0,
    }),
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

test("AgentsScreen shows the Templates strip with three cards and Alle Templates, and opens the details dialog", async () => {
  api.route("GET", "/api/me/agents", () => Response.json([]));
  api.route("GET", "/api/me/review", () => Response.json({ courses: [] }));

  render(
    <Providers>
      <AgentsScreen apiOrigin={api.origin} />
    </Providers>,
  );

  const strip = await screen.findByRole("region", { name: "Templates" });
  expect(
    within(strip)
      .getByRole("link", { name: "Alle Templates" })
      .getAttribute("href"),
  ).toBe("/agents/templates");

  const cards = await within(strip).findAllByRole("button");
  expect(cards).toHaveLength(3);
  expect(cards.map((c) => c.textContent)).toEqual([
    expect.stringContaining("Klausur vorbereiten"),
    expect.stringContaining("Kurs organisieren"),
    expect.stringContaining("Briefings erstellen"),
  ]);
  // "Von N Anderen genutzt" appears only in the details dialog, never on cards.
  expect(strip.textContent).not.toMatch(/Anderen genutzt/);

  // Clicking a card with N > 0 opens the details dialog with "Erstellt am …", "Von 4 Anderen genutzt", close button and "Template verwenden".
  await userEvent.click(cards[0]!);
  const dialog = await screen.findByRole("dialog", {
    name: /Klausur vorbereiten/,
  });
  expect(dialog.textContent).toContain("Erstellt am 19.11.2026");
  expect(dialog.textContent).toContain("Von 4 Anderen genutzt");
  expect(
    within(dialog)
      .getByRole("link", { name: "Template verwenden" })
      .getAttribute("href"),
  ).toBe("/agents/new?template=prepareExam");

  const close = within(dialog).getByRole("button", { name: "Schließen" });
  await userEvent.click(close);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  // Clicking a card with N = 0 hides the "Von N Anderen genutzt" line.
  await userEvent.click(cards[1]!);
  const zeroDialog = await screen.findByRole("dialog", {
    name: /Kurs organisieren/,
  });
  expect(zeroDialog.textContent).toContain("Erstellt am 19.11.2026");
  expect(zeroDialog.textContent).not.toMatch(/Anderen genutzt/);
  expect(
    within(zeroDialog)
      .getByRole("link", { name: "Template verwenden" })
      .getAttribute("href"),
  ).toBe("/agents/new?template=organizeCourse");
});

test("TemplatesScreen shows Zurück, search and the card grid, and opens details", async () => {
  render(
    <Providers>
      <TemplatesScreen apiOrigin={api.origin} />
    </Providers>,
  );

  expect(
    screen.getByRole("link", { name: /Zurück/ }).getAttribute("href"),
  ).toBe("/agents");
  await screen.findByRole("button", { name: /Klausur vorbereiten/ });
  expect(
    screen.getByRole("button", { name: /Kurs organisieren/ }),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: /Briefings erstellen/ }),
  ).toBeTruthy();

  const search = screen.getByRole("searchbox", {
    name: "Templates durchsuchen",
  });
  await userEvent.type(search, "Updates");
  expect(
    screen.queryByRole("button", { name: /Klausur vorbereiten/ }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: /Briefings erstellen/ }),
  ).toBeTruthy();

  await userEvent.click(
    screen.getByRole("button", { name: /Briefings erstellen/ }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: /Briefings erstellen/,
  });
  expect(dialog.textContent).toContain("Von 2 Anderen genutzt");
  expect(dialog.textContent).toContain("Erstellt am 19.11.2026");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Schließen" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  await userEvent.clear(search);
  await userEvent.type(search, "unbekannt");
  expect(screen.getByText("Kein Template passt zu deiner Suche.")).toBeTruthy();
});

test("Template verwenden for Klausur vorbereiten prefills without Courses, saves nothing until Speichern, and sends templateId", async () => {
  const saved: unknown[] = [];
  api.route("POST", "/api/me/agents", async (request) => {
    saved.push(await request.json());
    return Response.json({ id: "a-exam" }, { status: 201 });
  });

  render(
    <Providers>
      <NewAgentScreen apiOrigin={api.origin} templateId="prepareExam" />
    </Providers>,
  );

  const name = await screen.findByLabelText("Name");
  expect((name as HTMLInputElement).value).toBe("Klausur vorbereiten");
  expect(
    (screen.getByLabelText("Beschreibung") as HTMLTextAreaElement).value,
  ).toBe("Plant deine Vorbereitung bis zum Prüfungstag.");
  expect(
    (screen.getByRole("textbox", { name: "Auftrag" }) as HTMLTextAreaElement)
      .value,
  ).toContain("Bereite mich auf die nächste Klausur in meinen Kursen vor.");
  expect((screen.getByLabelText("Uhrzeit") as HTMLInputElement).value).toBe(
    "06:00",
  );
  expect(
    (screen.getByRole("spinbutton", { name: "Budget" }) as HTMLInputElement)
      .value,
  ).toBe("5");
  expect(await screen.findByText("Sonnet 5.5")).toBeTruthy();
  // No Course preselected for Klausur vorbereiten.
  expect(screen.queryByText("Statistik I")).toBeNull();
  // Nothing saved yet.
  expect(saved).toEqual([]);

  // Pick a Course and press Speichern.
  await userEvent.click(
    screen.getByRole("button", { name: "Kurse bearbeiten" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Kurse verwalten" });
  await userEvent.click(
    await within(sheet).findByRole("checkbox", { name: /Statistik I/ }),
  );
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Speichern" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  await waitFor(() =>
    expect(saved).toEqual([
      {
        name: "Klausur vorbereiten",
        description: "Plant deine Vorbereitung bis zum Prüfungstag.",
        emoji: "🎯",
        instructions: templatesFixture[0]!.instructions,
        courseIds: [activeCourses[0]!.id],
        capabilities: templatesFixture[0]!.capabilities,
        connections: [],
        budgetMicroUsd: 5_000_000,
        trigger: { rhythm: "daily", minute: 360 },
        modelKey: "sonnet-5.5-reasoning-high",
        templateId: "prepareExam",
      },
    ]),
  );
});

test("Template verwenden for Kurs organisieren preselects no Course and keeps Aufgaben erstellen on Nachfragen", async () => {
  const saved: unknown[] = [];
  api.route("POST", "/api/me/agents", async (request) => {
    saved.push(await request.json());
    return Response.json({ id: "a-org" }, { status: 201 });
  });

  render(
    <Providers>
      <NewAgentScreen apiOrigin={api.origin} templateId="organizeCourse" />
    </Providers>,
  );

  expect(
    ((await screen.findByLabelText("Name")) as HTMLInputElement).value,
  ).toBe("Kurs organisieren");
  expect((screen.getByLabelText("Uhrzeit") as HTMLInputElement).value).toBe(
    "06:00",
  );
  expect(screen.queryByText("Statistik I")).toBeNull();
  expect(await screen.findByText("Aufgaben erstellen")).toBeTruthy();
  expect(screen.getByText("Nachfragen")).toBeTruthy();
  expect(saved).toEqual([]);
});

test("Template verwenden for Briefings erstellen preselects all active Courses and saves nothing until Speichern", async () => {
  const saved: unknown[] = [];
  api.route("POST", "/api/me/agents", async (request) => {
    saved.push(await request.json());
    return Response.json({ id: "a-briefing" }, { status: 201 });
  });

  render(
    <Providers>
      <NewAgentScreen apiOrigin={api.origin} templateId="createBriefings" />
    </Providers>,
  );

  const name = await screen.findByLabelText("Name");
  expect((name as HTMLInputElement).value).toBe("Briefings erstellen");
  expect((screen.getByLabelText("Uhrzeit") as HTMLInputElement).value).toBe(
    "07:00",
  );
  // Both active Courses are preselected automatically.
  expect(screen.getByText("Statistik I")).toBeTruthy();
  expect(screen.getByText("Algorithmen")).toBeTruthy();
  expect(await screen.findByText("Briefing erstellen")).toBeTruthy();
  // Nothing saved until the student presses Speichern.
  expect(saved).toEqual([]);

  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  await waitFor(() =>
    expect(saved).toEqual([
      {
        name: "Briefings erstellen",
        description: "Gibt dir täglich Updates über deinen Lernfortschritt.",
        emoji: "📧",
        instructions: templatesFixture[2]!.instructions,
        courseIds: [activeCourses[0]!.id, activeCourses[1]!.id],
        capabilities: [{ id: "createBriefing", mode: null }],
        connections: [],
        budgetMicroUsd: 5_000_000,
        trigger: { rhythm: "daily", minute: 420 },
        modelKey: "sonnet-5.5-reasoning-high",
        templateId: "createBriefings",
      },
    ]),
  );
});
