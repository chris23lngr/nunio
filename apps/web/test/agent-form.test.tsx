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
];

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
      },
    ]),
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
