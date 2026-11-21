import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { AgentDetailScreen } from "@/features/agents/agent-detail-screen";
import { AgentFormScreen } from "@/features/agents/agent-form-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/agents/new",
}));
beforeEach(() => {
  replace.mockReset();
  api.route("GET", "/api/me/agents/capabilities", () =>
    Response.json(capabilitySet),
  );
  api.route("GET", "/api/me/models", () => Response.json(chatModels));
  // These Agents never ran, so they open on their Auftrag.
  for (const id of ["a-1", "a-paused", "a-ended"])
    api.route("GET", `/api/me/agents/${id}/runs`, () =>
      Response.json({ runs: [], nextCursor: null }),
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

/** The capability set in code, as the API lists it. */
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
];

const dataHandling = {
  provider: "OpenRouter",
  upstream: ["Amazon Bedrock", "Google"],
  routing: "international",
  zeroRetention: true,
};
/** The Models Chat offers, as the API lists them. */
const chatModels = {
  models: [
    {
      key: "haiku-5.5-reasoning-high",
      name: "Haiku 5.5",
      provider: "Anthropic",
      description: "Schnell und sparsam für kurze, klare Aufgaben.",
      dataHandling,
      cost: { relativeToDefault: 0.05, tier: "low" },
    },
    {
      key: "sonnet-5.5-reasoning-high",
      name: "Sonnet 5.5",
      provider: "Anthropic",
      description: "Ausgewogen für Erklärungen und alltägliches Lernen.",
      dataHandling,
      cost: { relativeToDefault: 1, tier: "medium" },
    },
    {
      key: "opus-5.5-reasoning-high",
      name: "Opus 5.5",
      provider: "Anthropic",
      description: "Am gründlichsten für anspruchsvolle, lange Aufgaben.",
      dataHandling,
      cost: { relativeToDefault: 2, tier: "high" },
    },
  ],
  default: "sonnet-5.5-reasoning-high",
  // The student's choice for Chat, which a new Agent does not take.
  selected: "haiku-5.5-reasoning-high",
};

const ids = {
  statistics: "c0000000-0000-4000-8000-000000000001",
  micro: "c0000000-0000-4000-8000-000000000002",
  algorithms: "c0000000-0000-4000-8000-000000000003",
  archived: "c0000000-0000-4000-8000-000000000004",
};
const offered = [
  {
    id: ids.algorithms,
    title: "Algorithms and Data Structures",
    color: "rose",
    archived: false,
    topics: 1,
    sources: 1,
  },
  {
    id: ids.statistics,
    title: "Statistics II",
    color: "violet",
    archived: false,
    topics: 12,
    sources: 3,
  },
  {
    id: ids.micro,
    title: "Microeconomics",
    color: "teal",
    archived: false,
    topics: 4,
    sources: 0,
  },
];

function renderScreen(ui: React.ReactNode) {
  return render(
    <TestProviders>
      <SidebarProvider>{ui}</SidebarProvider>
    </TestProviders>,
  );
}

test("'Neuer Agent' opens a blank form with 🤖 and 5 USD, and Speichern saves the whole form", async () => {
  const saved: unknown[] = [];
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("POST", "/api/me/agents", async (request) => {
    saved.push(await request.json());
    return Response.json({ id: "a-1" }, { status: 201 });
  });
  renderScreen(<AgentFormScreen apiOrigin={api.origin} agent={null} />);

  const crumbs = screen.getByRole("navigation", { name: "breadcrumb" });
  expect(
    within(crumbs).getByRole("link", { name: "Agenten" }).getAttribute("href"),
  ).toBe("/agents");
  expect(within(crumbs).getByText("Neuer Agent")).toBeTruthy();
  const tabs = screen.getByRole("tablist");
  expect(
    within(tabs)
      .getAllByRole("tab")
      .map((tab) => [
        tab.textContent,
        tab.getAttribute("aria-selected"),
        (tab as HTMLButtonElement).disabled,
      ]),
  ).toEqual([
    ["Aktivität", "false", false],
    ["Auftrag", "true", false],
    ["Ablauf", "false", true],
  ]);
  expect(
    (screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value,
  ).toBe("");
  const budget = screen.getByRole("spinbutton", { name: "Budget" });
  expect((budget as HTMLInputElement).value).toBe("5");
  expect(
    screen.getByText("Wie viel dein Agent pro Monat ausgeben darf."),
  ).toBeTruthy();
  expect(
    screen.getByText("Was soll der Agent für dich übernehmen?"),
  ).toBeTruthy();
  // Täglich at 06:00, and a schedule is the only Auslöser of v1.
  const trigger = screen.getByRole("region", { name: "Auslöser" });
  const kind = within(trigger).getByRole("combobox", { name: "Auslöser" });
  expect(kind.textContent).toContain("Zu einer Uhrzeit");
  expect(
    kind.hasAttribute("disabled") || kind.hasAttribute("data-disabled"),
  ).toBe(true);
  expect(
    within(trigger).getByRole("combobox", { name: "Rhythmus" }).textContent,
  ).toContain("Täglich");
  expect(
    within(trigger).queryByRole("group", { name: "Wochentage" }),
  ).toBeNull();
  expect(
    (within(trigger).getByLabelText("Uhrzeit") as HTMLInputElement).value,
  ).toBe("06:00");

  await userEvent.type(
    screen.getByRole("textbox", { name: "Name" }),
    "Klausur Statistik",
  );
  expect(within(crumbs).getByText("Klausur Statistik")).toBeTruthy();
  await userEvent.type(
    screen.getByRole("textbox", { name: "Beschreibung" }),
    "Hält mich auf Kurs.",
  );
  await userEvent.type(
    screen.getByRole("textbox", { name: "Auftrag" }),
    "Bereite mich auf die Klausur vor.",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Kurse bearbeiten" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Kurse verwalten" });
  await userEvent.click(
    await within(sheet).findByRole("checkbox", { name: /Statistics II/ }),
  );
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Speichern" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const chosen = screen.getByRole("list", { name: "Kurse" });
  expect(within(chosen).getByText("Statistics II")).toBeTruthy();
  expect(within(chosen).getByText("12 Themen · 3 Quellen")).toBeTruthy();
  await userEvent.clear(budget);
  await userEvent.type(budget, "2.5");
  // The Chat default is preselected.
  expect(
    await within(screen.getByRole("region", { name: "Modell" })).findByText(
      "Sonnet 5.5",
    ),
  ).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/agents/a-1"));
  expect(saved).toEqual([
    {
      name: "Klausur Statistik",
      description: "Hält mich auf Kurs.",
      emoji: "🤖",
      instructions: "Bereite mich auf die Klausur vor.",
      courseIds: [ids.statistics],
      capabilities: [],
      budgetMicroUsd: 2_500_000,
      trigger: { rhythm: "daily", minute: 360 },
      modelKey: "sonnet-5.5-reasoning-high",
    },
  ]);
});

test("Speichern asks for a name and at least one Course before saving", async () => {
  const saved: unknown[] = [];
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("POST", "/api/me/agents", async (request) => {
    saved.push(await request.json());
    return Response.json({ id: "a-1" }, { status: 201 });
  });
  renderScreen(<AgentFormScreen apiOrigin={api.origin} agent={null} />);

  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  expect(screen.getByText("Gib deinem Agenten einen Namen.")).toBeTruthy();
  expect(screen.getByText("Wähle mindestens einen Kurs.")).toBeTruthy();
  expect(saved).toEqual([]);
});

const agent = {
  id: "a-1",
  preset: null,
  name: "Klausur Statistik",
  description: "Hält mich auf Kurs.",
  emoji: "📊",
  instructions: "Bereite mich auf die Klausur vor.",
  courses: [
    {
      id: ids.archived,
      title: "Alte Vorlesung",
      color: "amber",
      archived: true,
      topics: 2,
      sources: 1,
    },
    { ...offered[1], topics: 12, sources: 3 },
  ],
  capabilities: [{ id: "createStudyBlocks", mode: "automatic" }],
  course: null,
  exam: null,
  state: "active",
  pausedBy: null,
  running: false,
  grants: ["studyBlock.create"],
  budget: { limitMicroUsd: 5_000_000, usedMicroUsd: 0, heldMicroUsd: 0 },
  trigger: { rhythm: "daily", minute: 360 },
  modelKey: "sonnet-5.5-reasoning-high",
  recentActions: [],
  next: { runAt: null, action: null },
};

test("a saved Agent's form shows its Courses, an Archived one as archived, and Speichern updates the whole form", async () => {
  const saved: unknown[] = [];
  api.route("GET", "/api/me/agents/a-1", () => Response.json(agent));
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("PUT", "/api/me/agents/a-1", async (request) => {
    saved.push(await request.json());
    return Response.json({ status: "ok" });
  });
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);

  const name = await screen.findByRole("textbox", { name: "Name" });
  expect((name as HTMLInputElement).value).toBe("Klausur Statistik");
  const chosen = screen.getByRole("list", { name: "Kurse" });
  const archived = within(chosen).getByText("Alte Vorlesung").closest("li")!;
  expect(within(archived).getByText("Archiviert")).toBeTruthy();
  expect(within(archived).getByText("2 Themen · 1 Quelle")).toBeTruthy();
  await userEvent.clear(name);
  await userEvent.type(name, "Statistik");

  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  // Shown once the saved Agent is read back, so no request outlives the test.
  expect(await screen.findByText("Gespeichert")).toBeTruthy();
  await waitFor(() =>
    expect(saved).toEqual([
      {
        name: "Statistik",
        description: "Hält mich auf Kurs.",
        emoji: "📊",
        instructions: "Bereite mich auf die Klausur vor.",
        courseIds: [ids.archived, ids.statistics],
        capabilities: [{ id: "createStudyBlocks", mode: "automatic" }],
        budgetMicroUsd: 5_000_000,
        trigger: { rhythm: "daily", minute: 360 },
        modelKey: "sonnet-5.5-reasoning-high",
      },
    ]),
  );
});

test("'Modell auswählen' lists Chat's Models with their logo and, on hover, the catalog's description, and saves the one picked", async () => {
  const saved: { modelKey: string }[] = [];
  api.route("GET", "/api/me/agents/a-1", () => Response.json(agent));
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("PUT", "/api/me/agents/a-1", async (request) => {
    saved.push(await request.json());
    return Response.json({ status: "ok" });
  });
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);
  const section = await screen.findByRole("region", { name: "Modell" });
  expect(await within(section).findByText("Sonnet 5.5")).toBeTruthy();

  await userEvent.click(
    within(section).getByRole("button", { name: "Modell ändern" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Modell auswählen" });
  const choices = within(sheet).getByRole("radiogroup", { name: "Modelle" });
  const radios = within(choices).getAllByRole("radio") as HTMLInputElement[];
  expect(
    radios.map((radio) => [radio.getAttribute("aria-label"), radio.checked]),
  ).toEqual([
    ["Haiku 5.5", false],
    ["Sonnet 5.5", true],
    ["Opus 5.5", false],
  ]);
  for (const radio of radios)
    expect(
      radio.closest("label")!.querySelector('img[src*="claude"]'),
    ).toBeTruthy();
  expect(
    screen.queryByText("Am gründlichsten für anspruchsvolle, lange Aufgaben."),
  ).toBeNull();
  await userEvent.hover(radios[2]!.closest("label")!);
  expect(
    await screen.findByText(
      "Am gründlichsten für anspruchsvolle, lange Aufgaben.",
    ),
  ).toBeTruthy();
  await userEvent.click(radios[2]!);
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Speichern" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Modell auswählen" }),
    ).toBeNull(),
  );
  expect(within(section).getByText("Opus 5.5")).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  expect(await screen.findByText("Gespeichert")).toBeTruthy();
  expect(saved.map((form) => form.modelKey)).toEqual([
    "opus-5.5-reasoning-high",
  ]);
});

test("Abbrechen closes 'Modell auswählen' without changing the Agent's Model", async () => {
  api.route("GET", "/api/me/agents/a-1", () => Response.json(agent));
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);
  const section = await screen.findByRole("region", { name: "Modell" });
  await within(section).findByText("Sonnet 5.5");

  await userEvent.click(
    within(section).getByRole("button", { name: "Modell ändern" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Modell auswählen" });
  await userEvent.click(
    within(sheet).getByRole("radio", { name: "Haiku 5.5" }),
  );
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Abbrechen" }),
  );

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(within(section).getByText("Sonnet 5.5")).toBeTruthy();
});

test("a Model Chat stopped offering while the form was open is refused on Speichern, asking for another", async () => {
  api.route("GET", "/api/me/agents/a-1", () => Response.json(agent));
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("PUT", "/api/me/agents/a-1", () =>
    Response.json({ error: "model_unavailable" }, { status: 422 }),
  );
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);
  const section = await screen.findByRole("region", { name: "Modell" });
  await userEvent.click(
    await within(section).findByRole("button", { name: "Modell ändern" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Modell auswählen" });
  await userEvent.click(within(sheet).getByRole("radio", { name: "Opus 5.5" }));
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Speichern" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  expect((await screen.findByRole("alert")).textContent).toBe(
    "Dieses Modell ist nicht mehr verfügbar. Wähle ein anderes und speichere noch einmal.",
  );
});

test("an Agent whose Model Chat no longer offers says so, and keeps it until another is picked", async () => {
  const saved: { modelKey: string }[] = [];
  api.route("GET", "/api/me/agents/a-1", () =>
    Response.json({ ...agent, modelKey: "sonnet-4-reasoning-high" }),
  );
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("PUT", "/api/me/agents/a-1", async (request) => {
    saved.push(await request.json());
    return Response.json({ status: "ok" });
  });
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);

  const section = await screen.findByRole("region", { name: "Modell" });
  expect(
    await within(section).findByText(
      "Nicht mehr verfügbar. Wähle ein anderes Modell, sonst stoppen die Läufe deines Agenten.",
    ),
  ).toBeTruthy();
  await userEvent.click(
    within(section).getByRole("button", { name: "Modell ändern" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Modell auswählen" });
  expect(
    (within(sheet).getAllByRole("radio") as HTMLInputElement[]).some(
      (radio) => radio.checked,
    ),
  ).toBe(false);
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Abbrechen" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  expect(await screen.findByText("Gespeichert")).toBeTruthy();
  expect(saved.map((form) => form.modelKey)).toEqual([
    "sonnet-4-reasoning-high",
  ]);
});

test("Auslöser shows a saved Agent's Wochentage and Uhrzeit, and saves the ones chosen", async () => {
  const saved: unknown[] = [];
  api.route("GET", "/api/me/agents/a-1", () =>
    Response.json({
      ...agent,
      trigger: { rhythm: "weekdays", weekdays: [1, 3], minute: 1170 },
    }),
  );
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("PUT", "/api/me/agents/a-1", async (request) => {
    saved.push(await request.json());
    return Response.json({ status: "ok" });
  });
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);

  const trigger = await screen.findByRole("region", { name: "Auslöser" });
  expect(
    within(trigger).getByRole("combobox", { name: "Rhythmus" }).textContent,
  ).toContain("Wochentage");
  const days = within(trigger).getByRole("group", { name: "Wochentage" });
  expect(
    within(days)
      .getAllByRole("button")
      .map((day) => [day.textContent, day.getAttribute("aria-pressed")]),
  ).toEqual([
    ["Mo", "true"],
    ["Di", "false"],
    ["Mi", "true"],
    ["Do", "false"],
    ["Fr", "false"],
    ["Sa", "false"],
    ["So", "false"],
  ]);
  const time = within(trigger).getByLabelText("Uhrzeit") as HTMLInputElement;
  expect(time.value).toBe("19:30");

  await userEvent.click(within(days).getByRole("button", { name: "Fr" }));
  await userEvent.click(within(days).getByRole("button", { name: "Mo" }));
  await userEvent.clear(time);
  await userEvent.type(time, "07:15");
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  expect(await screen.findByText("Gespeichert")).toBeTruthy();
  await waitFor(() =>
    expect(saved).toEqual([
      expect.objectContaining({
        trigger: { rhythm: "weekdays", weekdays: [3, 5], minute: 435 },
      }),
    ]),
  );
});

test("Auslöser switches between Täglich and Wochentage, and asks for at least one Wochentag and an Uhrzeit", async () => {
  const saved: unknown[] = [];
  api.route("GET", "/api/me/agents/a-1", () => Response.json(agent));
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("PUT", "/api/me/agents/a-1", async (request) => {
    saved.push(await request.json());
    return Response.json({ status: "ok" });
  });
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);
  const trigger = await screen.findByRole("region", { name: "Auslöser" });

  await userEvent.click(
    within(trigger).getByRole("combobox", { name: "Rhythmus" }),
  );
  await userEvent.click(
    await screen.findByRole("option", { name: "Wochentage" }),
  );
  const days = await within(trigger).findByRole("group", {
    name: "Wochentage",
  });
  expect(
    within(days)
      .getAllByRole("button")
      .filter((day) => day.getAttribute("aria-pressed") === "true"),
  ).toEqual([]);
  await userEvent.clear(within(trigger).getByLabelText("Uhrzeit"));
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  expect(screen.getByText("Wähle mindestens einen Wochentag.")).toBeTruthy();
  expect(screen.getByText("Gib eine Uhrzeit an.")).toBeTruthy();
  expect(saved).toEqual([]);

  await userEvent.click(within(days).getByRole("button", { name: "So" }));
  await userEvent.type(within(trigger).getByLabelText("Uhrzeit"), "21:00");
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(saved).toEqual([
      expect.objectContaining({
        trigger: { rhythm: "weekdays", weekdays: [7], minute: 1260 },
      }),
    ]),
  );

  await userEvent.click(
    within(trigger).getByRole("combobox", { name: "Rhythmus" }),
  );
  await userEvent.click(await screen.findByRole("option", { name: "Täglich" }));
  expect(
    within(trigger).queryByRole("group", { name: "Wochentage" }),
  ).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(saved.at(-1)).toEqual(
      expect.objectContaining({ trigger: { rhythm: "daily", minute: 1260 } }),
    ),
  );
});

test("'Jetzt starten' is disabled until the Agent is first saved", () => {
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  renderScreen(<AgentFormScreen apiOrigin={api.origin} agent={null} />);

  const start = screen.getByRole("button", { name: "Jetzt starten" });
  expect((start as HTMLButtonElement).disabled).toBe(true);
});

test("'Jetzt starten' runs the saved configuration, leaving unsaved edits, and shows 'Läuft gerade…' until the Run ends", async () => {
  let shown = agent;
  const started: string[] = [];
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("GET", "/api/me/agents/a-1", () => Response.json(shown));
  api.route("POST", "/api/me/agents/a-1/runs", async (request) => {
    started.push(await request.text());
    shown = { ...agent, running: true };
    return Response.json({ id: "r-1" }, { status: 201 });
  });
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);
  const name = await screen.findByRole("textbox", { name: "Name" });
  await userEvent.type(name, " neu");

  await userEvent.click(screen.getByRole("button", { name: "Jetzt starten" }));

  const running = await screen.findByRole("button", {
    name: "Läuft gerade…",
  });
  expect((running as HTMLButtonElement).disabled).toBe(true);
  // Nothing was saved: the Run reads the saved configuration, and the edit stays in the form.
  expect(started).toEqual([""]);
  expect((name as HTMLInputElement).value).toBe("Klausur Statistik neu");

  shown = { ...agent, running: false };
  const again = await screen.findByRole(
    "button",
    { name: "Jetzt starten" },
    { timeout: 5_000 },
  );
  expect((again as HTMLButtonElement).disabled).toBe(false);
});

test("'Jetzt starten' is disabled while the Agent is Paused or Ended", async () => {
  for (const state of ["paused", "ended"]) {
    api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
    api.route("GET", `/api/me/agents/a-${state}`, () =>
      Response.json({ ...agent, id: `a-${state}`, state }),
    );
    const { unmount } = renderScreen(
      <AgentDetailScreen apiOrigin={api.origin} id={`a-${state}`} />,
    );

    const start = await screen.findByRole("button", { name: "Jetzt starten" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    unmount();
  }
});

test("the header's menu pauses, resumes and ends the Agent, and a Paused one shows why under the header with Fortsetzen", async () => {
  let shown: Record<string, unknown> = { ...agent };
  const controls: string[] = [];
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("GET", "/api/me/agents/a-1", () => Response.json(shown));
  for (const [control, state, pausedBy] of [
    ["pause", "paused", "student"],
    ["resume", "active", null],
    ["end", "ended", null],
  ] as const)
    api.route("POST", `/api/me/agents/a-1/${control}`, () => {
      controls.push(control);
      shown = { ...shown, state, pausedBy };
      return Response.json({ status: "ok" });
    });
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);
  const menu = async () => {
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Aktionen für Klausur Statistik",
      }),
    );
    return screen.findByRole("menu");
  };

  // The header has the lifecycle controls; editing is the Auftrag already open.
  expect(
    within(await menu())
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual(["Pausieren", "Beenden", "Löschen"]);
  await userEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", {
      name: "Pausieren",
    }),
  );
  expect(await screen.findByText("Von dir pausiert")).toBeTruthy();

  await userEvent.click(screen.getByRole("button", { name: "Fortsetzen" }));
  await waitFor(() =>
    expect(screen.queryByText("Von dir pausiert")).toBeNull(),
  );
  await userEvent.click(
    within(await menu()).getByRole("menuitem", { name: "Beenden" }),
  );
  await waitFor(async () =>
    expect(
      within(await menu())
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Löschen"]),
  );
  expect(controls).toEqual(["pause", "resume", "end"]);
});

test.each([
  ["course_archived", "Pausiert: Alle Kurse archiviert"],
  ["no_course", "Pausiert: Kein Kurs mehr"],
])(
  "a Paused Agent says why under the header when it has no Course left to act for (%s)",
  async (pausedBy, line) => {
    api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
    api.route("GET", "/api/me/agents/a-paused", () =>
      Response.json({ ...agent, id: "a-paused", state: "paused", pausedBy }),
    );
    renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-paused" />);

    expect(await screen.findByText(line)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fortsetzen" })).toBeTruthy();
  },
);

test("Fortsetzen says what to do when the Agent has no Course to act for", async () => {
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("GET", "/api/me/agents/a-paused", () =>
    Response.json({
      ...agent,
      id: "a-paused",
      state: "paused",
      pausedBy: "no_course",
    }),
  );
  api.route("POST", "/api/me/agents/a-paused/resume", () =>
    Response.json({ error: "no_course" }, { status: 409 }),
  );
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-paused" />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Fortsetzen" }),
  );

  expect(
    await screen.findByText(
      "Dein Agent hat keinen aktiven Kurs, für den er arbeiten kann. Gib ihm einen Kurs oder hebe eine Archivierung auf, dann setze ihn fort.",
    ),
  ).toBeTruthy();
});

test("a Paused Agent says it ran out of Budget under the header", async () => {
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("GET", "/api/me/agents/a-paused", () =>
    Response.json({
      ...agent,
      id: "a-paused",
      state: "paused",
      pausedBy: "budget",
    }),
  );
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-paused" />);

  expect(await screen.findByText("Pausiert: Budget aufgebraucht")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Fortsetzen" })).toBeTruthy();
});

test("Budget shows what the Agent spent this month next to its monthly Budget", async () => {
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("GET", "/api/me/agents/a-1", () =>
    Response.json({
      ...agent,
      budget: {
        limitMicroUsd: 5_000_000,
        usedMicroUsd: 1_000_000,
        heldMicroUsd: 250_000,
      },
    }),
  );
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);

  expect(
    await screen.findByText("Diesen Monat ausgegeben: 1,25 von 5,00 USD"),
  ).toBeTruthy();
});

test("Löschen in the header's menu asks first, then deletes the Agent and returns to the list", async () => {
  const deleted: string[] = [];
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("GET", "/api/me/agents/a-1", () => Response.json(agent));
  api.route("DELETE", "/api/me/agents/a-1", () => {
    deleted.push("a-1");
    return Response.json({ status: "ok" });
  });
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);

  await userEvent.click(
    await screen.findByRole("button", {
      name: "Aktionen für Klausur Statistik",
    }),
  );
  await userEvent.click(
    within(await screen.findByRole("menu")).getByRole("menuitem", {
      name: "Löschen",
    }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "„Klausur Statistik“ löschen?",
  });
  expect(deleted).toEqual([]);
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Löschen" }),
  );

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/agents"));
  expect(deleted).toEqual(["a-1"]);
});

test("'Kurse verwalten' searches, reflects the Agent's Courses, and lists an Archived one only to remove it", async () => {
  const saved: unknown[] = [];
  api.route("GET", "/api/me/agents/a-1", () => Response.json(agent));
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("PUT", "/api/me/agents/a-1", async (request) => {
    saved.push(await request.json());
    return Response.json({ status: "ok" });
  });
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Kurse bearbeiten" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Kurse verwalten" });
  const boxes = await within(sheet).findAllByRole("checkbox");
  expect(
    boxes.map((box) => [
      box.closest("label")?.textContent,
      box.getAttribute("aria-checked"),
    ]),
  ).toEqual([
    ["Algorithms and Data Structures1 Thema · 1 Quelle", "false"],
    ["Statistics II12 Themen · 3 Quellen", "true"],
    ["Microeconomics4 Themen · 0 Quellen", "false"],
    ["Alte VorlesungArchiviert2 Themen · 1 Quelle", "true"],
  ]);
  // Once unchecked, an Archived Course is gone from the Agent: the sheet offers it no more.
  await userEvent.click(
    within(sheet).getByRole("checkbox", { name: /Alte Vorlesung/ }),
  );

  await userEvent.type(
    within(sheet).getByRole("searchbox", { name: "Kurse durchsuchen" }),
    "micro",
  );
  expect(
    within(sheet)
      .getAllByRole("checkbox")
      .map((box) => box.closest("label")?.textContent),
  ).toEqual(["Microeconomics4 Themen · 0 Quellen"]);
  await userEvent.click(within(sheet).getByRole("checkbox"));
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Speichern" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  expect(await screen.findByText("Gespeichert")).toBeTruthy();
  expect(saved).toEqual([
    expect.objectContaining({ courseIds: [ids.statistics, ids.micro] }),
  ]);
});

test("a Course Archived while the form is open shows as unavailable and can be taken off before saving", async () => {
  let courses = offered;
  const saved: unknown[] = [];
  api.route("GET", "/api/me/agents/courses", () => Response.json(courses));
  api.route("POST", "/api/me/agents", async (request) => {
    const body = (await request.json()) as { courseIds: string[] };
    saved.push(body);
    return body.courseIds.includes(ids.statistics)
      ? Response.json({ error: "course_archived" }, { status: 409 })
      : Response.json({ id: "a-1" }, { status: 201 });
  });
  renderScreen(<AgentFormScreen apiOrigin={api.origin} agent={null} />);
  await userEvent.type(
    screen.getByRole("textbox", { name: "Name" }),
    "Statistik",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Kurse bearbeiten" }),
  );
  let sheet = await screen.findByRole("dialog", { name: "Kurse verwalten" });
  await userEvent.click(
    await within(sheet).findByRole("checkbox", { name: /Statistics II/ }),
  );
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Speichern" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // Archived elsewhere meanwhile.
  courses = offered.filter((course) => course.id !== ids.statistics);

  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  expect((await screen.findByRole("alert")).textContent).toMatch(/archiviert/);
  const chosen = screen.getByRole("list", { name: "Kurse" });
  expect(await within(chosen).findByText("Nicht mehr verfügbar")).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Kurse bearbeiten" }),
  );
  sheet = await screen.findByRole("dialog", { name: "Kurse verwalten" });
  const stale = within(sheet).getByRole("checkbox", { name: /Statistics II/ });
  expect(stale.closest("label")?.textContent).toMatch(/Nicht mehr verfügbar/);
  expect(stale.getAttribute("aria-checked")).toBe("true");
  await userEvent.click(stale);
  await userEvent.click(
    within(sheet).getByRole("checkbox", { name: /Microeconomics/ }),
  );
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Speichern" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/agents/a-1"));
  expect(saved).toEqual([
    expect.objectContaining({ courseIds: [ids.statistics] }),
    expect.objectContaining({ courseIds: [ids.micro] }),
  ]);
});

test("Abbrechen closes 'Kurse verwalten' without changing the Agent's Courses", async () => {
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  renderScreen(<AgentFormScreen apiOrigin={api.origin} agent={null} />);

  await userEvent.click(
    screen.getByRole("button", { name: "Kurse bearbeiten" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Kurse verwalten" });
  await userEvent.click(
    await within(sheet).findByRole("checkbox", { name: /Microeconomics/ }),
  );
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Abbrechen" }),
  );

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("list", { name: "Kurse" })).toBeNull();
});

/** The form's Capabilities as listed: each title, its mode badge and its description. */
const listedCapabilities = () =>
  within(screen.getByRole("list", { name: "Fähigkeiten" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

test("'Fähigkeiten verwalten' adds Lernblöcke Capabilities on their default modes, Lernblöcke verschieben fixed on Nachfragen", async () => {
  const saved: unknown[] = [];
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("POST", "/api/me/agents", async (request) => {
    saved.push(await request.json());
    return Response.json({ id: "a-1" }, { status: 201 });
  });
  renderScreen(<AgentFormScreen apiOrigin={api.origin} agent={null} />);
  await userEvent.type(
    screen.getByRole("textbox", { name: "Name" }),
    "Statistik",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Kurse bearbeiten" }),
  );
  let sheet = await screen.findByRole("dialog", { name: "Kurse verwalten" });
  await userEvent.click(
    await within(sheet).findByRole("checkbox", { name: /Statistics II/ }),
  );
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Speichern" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("list", { name: "Fähigkeiten" })).toBeNull();

  await userEvent.click(
    screen.getByRole("button", { name: "Fähigkeit hinzufügen" }),
  );
  sheet = await screen.findByRole("dialog", { name: "Fähigkeiten verwalten" });
  const section = within(sheet).getByRole("button", { name: "Lernblöcke" });
  expect(section.getAttribute("aria-expanded")).toBe("true");
  const boxes = await within(sheet).findAllByRole("checkbox");
  expect(
    boxes.map((box) => [
      box.closest("label")?.textContent,
      box.getAttribute("aria-checked"),
    ]),
  ).toEqual([
    [
      "Lernblöcke erstellenNeue Lernzeit in freie Zeitfenster eintragen.",
      "false",
    ],
    [
      "Eigene Lernblöcke verschiebenNur Blöcke, die dieser Agent erstellt hat.",
      "false",
    ],
    [
      "Lernblöcke verschiebenAuch Blöcke, die du oder andere geplant haben.",
      "false",
    ],
    [
      "Eigene Lernblöcke entfernenNur Blöcke, die dieser Agent erstellt hat.",
      "false",
    ],
    [
      "Aufgaben erstellenNeue Aufgaben in deinen Kursen anlegen, auch zu Prüfungen und Abgaben oder zur Vor- und Nachbereitung.",
      "false",
    ],
  ]);
  expect(within(sheet).queryAllByRole("combobox")).toEqual([]);
  await userEvent.click(boxes[0]!);
  await userEvent.click(boxes[2]!);
  await userEvent.click(boxes[3]!);
  const create = within(sheet).getByRole("combobox", {
    name: "Freigabemodus für Lernblöcke erstellen",
  });
  expect(create.textContent).toContain("Automatisch");
  const others = within(sheet).getByRole("combobox", {
    name: "Freigabemodus für Lernblöcke verschieben",
  });
  expect(others.textContent).toContain("Nachfragen");
  expect(
    others.hasAttribute("disabled") ||
      others.getAttribute("aria-disabled") === "true" ||
      others.hasAttribute("data-disabled"),
  ).toBe(true);
  await userEvent.click(create);
  await userEvent.click(
    await screen.findByRole("option", { name: "Immer erlaubt" }),
  );
  await waitFor(() => expect(create.textContent).toContain("Immer erlaubt"));
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Speichern" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  expect(listedCapabilities()).toEqual([
    "Lernblöcke erstellenImmer erlaubtNeue Lernzeit in freie Zeitfenster eintragen.",
    "Lernblöcke verschiebenNachfragenAuch Blöcke, die du oder andere geplant haben.",
    "Eigene Lernblöcke entfernenAutomatischNur Blöcke, die dieser Agent erstellt hat.",
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/agents/a-1"));
  expect(saved).toEqual([
    expect.objectContaining({
      capabilities: [
        { id: "createStudyBlocks", mode: "always" },
        { id: "moveStudyBlocks", mode: "ask" },
        { id: "removeOwnStudyBlocks", mode: "automatic" },
      ],
    }),
  ]);
});

test("'Fähigkeiten verwalten' offers Aufgaben erstellen under Aufgaben, on Nachfragen until the student grants it", async () => {
  const saved: unknown[] = [];
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("POST", "/api/me/agents", async (request) => {
    saved.push(await request.json());
    return Response.json({ id: "a-1" }, { status: 201 });
  });
  renderScreen(<AgentFormScreen apiOrigin={api.origin} agent={null} />);
  await userEvent.type(
    screen.getByRole("textbox", { name: "Name" }),
    "Statistik",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Kurse bearbeiten" }),
  );
  let sheet = await screen.findByRole("dialog", { name: "Kurse verwalten" });
  await userEvent.click(
    await within(sheet).findByRole("checkbox", { name: /Statistics II/ }),
  );
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Speichern" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  await userEvent.click(
    screen.getByRole("button", { name: "Fähigkeit hinzufügen" }),
  );
  sheet = await screen.findByRole("dialog", { name: "Fähigkeiten verwalten" });
  expect(
    within(sheet)
      .getByRole("button", { name: "Aufgaben" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  await userEvent.click(
    await within(sheet).findByRole("checkbox", { name: /Aufgaben erstellen/ }),
  );
  const mode = within(sheet).getByRole("combobox", {
    name: "Freigabemodus für Aufgaben erstellen",
  });
  expect(mode.textContent).toContain("Nachfragen");
  await userEvent.click(mode);
  expect(
    (await screen.findAllByRole("option")).map((option) => option.textContent),
  ).toEqual(["Immer erlaubt", "Automatisch", "Nachfragen"]);
  await userEvent.click(screen.getByRole("option", { name: "Automatisch" }));
  await waitFor(() => expect(mode.textContent).toContain("Automatisch"));
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Speichern" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  expect(listedCapabilities()).toEqual([
    "Aufgaben erstellenAutomatischNeue Aufgaben in deinen Kursen anlegen, auch zu Prüfungen und Abgaben oder zur Vor- und Nachbereitung.",
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  await waitFor(() => expect(replace).toHaveBeenCalledWith("/agents/a-1"));
  expect(saved).toEqual([
    expect.objectContaining({
      capabilities: [{ id: "createTasks", mode: "automatic" }],
    }),
  ]);
});

test("'Fähigkeiten verwalten' searches, keeps an added Capability's mode, and Abbrechen changes nothing", async () => {
  api.route("GET", "/api/me/agents/a-1", () =>
    Response.json({
      ...agent,
      capabilities: [{ id: "createStudyBlocks", mode: "ask" }],
    }),
  );
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Fähigkeit hinzufügen" }),
  );
  let sheet = await screen.findByRole("dialog", {
    name: "Fähigkeiten verwalten",
  });
  expect(
    (
      await within(sheet).findByRole("combobox", {
        name: "Freigabemodus für Lernblöcke erstellen",
      })
    ).textContent,
  ).toContain("Nachfragen");
  await userEvent.type(
    within(sheet).getByRole("searchbox", { name: "Fähigkeiten durchsuchen" }),
    "eigene",
  );
  expect(
    within(sheet)
      .getAllByRole("checkbox")
      .map((box) => box.closest("label")?.textContent),
  ).toEqual([
    "Eigene Lernblöcke verschiebenNur Blöcke, die dieser Agent erstellt hat.",
    "Eigene Lernblöcke entfernenNur Blöcke, die dieser Agent erstellt hat.",
  ]);
  await userEvent.click(within(sheet).getAllByRole("checkbox")[0]!);
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Abbrechen" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(listedCapabilities()).toEqual([
    "Lernblöcke erstellenNachfragenNeue Lernzeit in freie Zeitfenster eintragen.",
  ]);

  await userEvent.click(
    screen.getByRole("button", { name: "Fähigkeit hinzufügen" }),
  );
  sheet = await screen.findByRole("dialog", { name: "Fähigkeiten verwalten" });
  await userEvent.type(
    within(sheet).getByRole("searchbox", { name: "Fähigkeiten durchsuchen" }),
    "Karteikarten",
  );
  expect(
    within(sheet).getByText("Keine Fähigkeit passt zu deiner Suche."),
  ).toBeTruthy();
});

test("a Capability's '⋯' menu changes its mode or removes it, and Lernblöcke verschieben stays on Nachfragen", async () => {
  const saved: unknown[] = [];
  api.route("GET", "/api/me/agents/a-1", () =>
    Response.json({
      ...agent,
      capabilities: [
        { id: "createStudyBlocks", mode: "automatic" },
        { id: "moveOwnStudyBlocks", mode: "automatic" },
        { id: "moveStudyBlocks", mode: "ask" },
      ],
    }),
  );
  api.route("GET", "/api/me/agents/courses", () => Response.json(offered));
  api.route("PUT", "/api/me/agents/a-1", async (request) => {
    saved.push(await request.json());
    return Response.json({ status: "ok" });
  });
  renderScreen(<AgentDetailScreen apiOrigin={api.origin} id="a-1" />);

  await userEvent.click(
    await screen.findByRole("button", {
      name: "Aktionen für Lernblöcke erstellen",
    }),
  );
  let menu = await screen.findByRole("menu");
  expect(within(menu).getByText("Freigabemodus")).toBeTruthy();
  expect(
    within(menu)
      .getAllByRole("menuitemradio")
      .map((item) => [item.textContent, item.getAttribute("aria-checked")]),
  ).toEqual([
    ["Immer erlaubt", "false"],
    ["Automatisch", "true"],
    ["Nachfragen", "false"],
  ]);
  expect(within(menu).getByRole("separator")).toBeTruthy();
  await userEvent.click(
    within(menu).getByRole("menuitemradio", { name: "Nachfragen" }),
  );
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(listedCapabilities()).toEqual([
    "Lernblöcke erstellenNachfragenNeue Lernzeit in freie Zeitfenster eintragen.",
    "Eigene Lernblöcke verschiebenAutomatischNur Blöcke, die dieser Agent erstellt hat.",
    "Lernblöcke verschiebenNachfragenAuch Blöcke, die du oder andere geplant haben.",
  ]);

  await userEvent.click(
    screen.getByRole("button", { name: "Aktionen für Lernblöcke verschieben" }),
  );
  menu = await screen.findByRole("menu");
  expect(
    within(menu)
      .getAllByRole("menuitemradio")
      .map((item) => [item.textContent, item.getAttribute("aria-disabled")]),
  ).toEqual([
    ["Immer erlaubt", "true"],
    ["Automatisch", "true"],
    ["Nachfragen", null],
  ]);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

  await userEvent.click(
    screen.getByRole("button", {
      name: "Aktionen für Eigene Lernblöcke verschieben",
    }),
  );
  await userEvent.click(
    await screen.findByRole("menuitem", { name: "Löschen" }),
  );
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  expect(listedCapabilities()).toEqual([
    "Lernblöcke erstellenNachfragenNeue Lernzeit in freie Zeitfenster eintragen.",
    "Lernblöcke verschiebenNachfragenAuch Blöcke, die du oder andere geplant haben.",
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));

  expect(await screen.findByText("Gespeichert")).toBeTruthy();
  expect(saved).toEqual([
    expect.objectContaining({
      capabilities: [
        { id: "createStudyBlocks", mode: "ask" },
        { id: "moveStudyBlocks", mode: "ask" },
      ],
    }),
  ]);
});
