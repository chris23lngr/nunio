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
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

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
  course: null,
  exam: null,
  state: "active",
  pausedBy: null,
  grants: [],
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
        budgetMicroUsd: 5_000_000,
      },
    ]),
  );
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
