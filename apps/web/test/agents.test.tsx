import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { AgentsScreen } from "@/features/agents/agents-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

/** The list's page header needs the app's sidebar. */
function Providers({ children }: { children: ReactNode }) {
  return (
    <TestProviders>
      <SidebarProvider>{children}</SidebarProvider>
    </TestProviders>
  );
}
beforeEach(() => {
  api.route("GET", "/api/me/agents/templates", () => Response.json([]));
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

/** An Agent as the list returns it. */
const listed = (overrides: Record<string, unknown>) => ({
  id: "a-1",
  name: "Klausur Statistik",
  description: "Hält meine Klausurvorbereitung auf Kurs.",
  emoji: "📊",
  state: "active",
  pausedBy: null,
  badge: null,
  approvalRunId: null,
  ...overrides,
});

const agentRows = () =>
  within(screen.getByRole("list", { name: "Agenten" })).getAllByRole(
    "listitem",
  );

test("lists each Agent with its emoji, name, Beschreibung and one badge, in the order the API sorts them", async () => {
  api.route("GET", "/api/me/agents", () =>
    Response.json([
      listed({
        id: "a-1",
        name: "Pausierter",
        state: "paused",
        pausedBy: "student",
        badge: "paused",
      }),
      listed({
        id: "a-2",
        name: "Fragender",
        emoji: "🙋",
        badge: "approval_needed",
      }),
      listed({ id: "a-3", name: "Laufender", badge: "running" }),
      listed({ id: "a-4", name: "Ruhiger", description: "" }),
      listed({ id: "a-5", name: "Beendeter", state: "ended", badge: "ended" }),
    ]),
  );
  render(
    <Providers>
      <AgentsScreen apiOrigin={api.origin} />
    </Providers>,
  );

  await screen.findByRole("link", { name: "Fragender" });
  expect(
    agentRows().map((row) => [
      within(row).getByRole("link").textContent,
      row.textContent,
    ]),
  ).toEqual([
    ["Pausierter", expect.stringContaining("Pausiert")],
    ["Fragender", expect.stringContaining("Freigabe benötigt")],
    ["Laufender", expect.stringContaining("Läuft gerade")],
    ["Ruhiger", expect.not.stringMatching(/Pausiert|Freigabe|Läuft|Beendet/)],
    ["Beendeter", expect.stringContaining("Beendet")],
  ]);
  const asking = agentRows()[1]!;
  expect(within(asking).getByText("🙋")).toBeTruthy();
  expect(
    within(asking).getByText("Hält meine Klausurvorbereitung auf Kurs."),
  ).toBeTruthy();
  // An Ended Agent stays, and opens on its Activity like any other.
  expect(
    screen.getByRole("link", { name: "Beendeter" }).getAttribute("href"),
  ).toBe("/agents/a-5");
  expect(
    screen.getByRole("link", { name: "Neuer Agent" }).getAttribute("href"),
  ).toBe("/agents/new");
});

test("a Paused row says why, unless the student paused it", async () => {
  api.route("GET", "/api/me/agents", () =>
    Response.json(
      [
        ["a-1", "student"],
        ["a-2", "budget"],
        ["a-3", "course_archived"],
        ["a-4", "no_course"],
        ["a-5", "conversion"],
      ].map(([id, pausedBy]) =>
        listed({
          id,
          name: `Agent ${id}`,
          state: "paused",
          pausedBy,
          badge: "paused",
        }),
      ),
    ),
  );
  render(
    <Providers>
      <AgentsScreen apiOrigin={api.origin} />
    </Providers>,
  );

  await screen.findByRole("link", { name: "Agent a-5" });
  expect(agentRows().map((row) => row.textContent)).toEqual([
    expect.not.stringMatching(/Pausiert:|Von dir/),
    expect.stringContaining("Pausiert: Budget aufgebraucht"),
    expect.stringContaining("Pausiert: Alle Kurse archiviert"),
    expect.stringContaining("Pausiert: Kein Kurs mehr"),
    expect.stringContaining("Übernommen: prüfen und fortsetzen"),
  ]);
});

test("Agenten durchsuchen narrows the list to Agents whose name or Beschreibung matches", async () => {
  api.route("GET", "/api/me/agents", () =>
    Response.json([
      listed({ id: "a-1", name: "Klausur Statistik", description: "" }),
      listed({
        id: "a-2",
        name: "Kurs organisieren",
        description: "Räumt Analysis I auf.",
      }),
      listed({
        id: "a-3",
        name: "Kurs organisieren · Lineare Algebra",
        description: "",
      }),
    ]),
  );
  render(
    <Providers>
      <AgentsScreen apiOrigin={api.origin} />
    </Providers>,
  );
  const search = await screen.findByRole("searchbox", {
    name: "Agenten durchsuchen",
  });
  await screen.findByRole("link", { name: "Klausur Statistik" });

  await userEvent.type(search, "analysis");
  expect(
    agentRows().map((row) => within(row).getByRole("link").textContent),
  ).toEqual(["Kurs organisieren"]);

  await userEvent.clear(search);
  await userEvent.type(search, "lineare");
  expect(
    agentRows().map((row) => within(row).getByRole("link").textContent),
  ).toEqual(["Kurs organisieren · Lineare Algebra"]);

  await userEvent.clear(search);
  await userEvent.type(search, "Briefing");
  expect(screen.queryByRole("list", { name: "Agenten" })).toBeNull();
  expect(screen.getByText("Kein Agent passt zu deiner Suche.")).toBeTruthy();
});

test("a row's menu offers Freigaben bestätigen while an Approval is open, then Bearbeiten, the lifecycle and, apart, Löschen", async () => {
  api.route("GET", "/api/me/agents", () =>
    Response.json([
      listed({ badge: "approval_needed", approvalRunId: "r-oldest" }),
      listed({
        id: "a-2",
        name: "Beendeter",
        state: "ended",
        badge: "ended",
      }),
    ]),
  );
  render(
    <Providers>
      <AgentsScreen apiOrigin={api.origin} />
    </Providers>,
  );

  await userEvent.click(
    await screen.findByRole("button", {
      name: "Aktionen für Klausur Statistik",
    }),
  );
  const menu = await screen.findByRole("menu");
  expect(
    within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual([
    "Freigaben bestätigen",
    "Bearbeiten",
    "Pausieren",
    "Beenden",
    "Löschen",
  ]);
  // It opens the oldest Run awaiting the student's Approval.
  expect(
    within(menu)
      .getByRole("menuitem", { name: "Freigaben bestätigen" })
      .getAttribute("href"),
  ).toBe("/agents/a-1?run=r-oldest");
  expect(within(menu).getByRole("separator")).toBeTruthy();
  await userEvent.keyboard("{Escape}");

  await userEvent.click(
    screen.getByRole("button", { name: "Aktionen für Beendeter" }),
  );
  expect(
    within(await screen.findByRole("menu"))
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual(["Bearbeiten", "Löschen"]);
});

test("Löschen in a row's menu asks first, and deletes the Agent only once the student confirms", async () => {
  let agents = [listed({}), listed({ id: "a-2", name: "Anderer" })];
  const deleted: string[] = [];
  api.route("GET", "/api/me/agents", () => Response.json(agents));
  api.route("DELETE", "/api/me/agents/a-1", () => {
    deleted.push("a-1");
    agents = agents.filter((agent) => agent.id !== "a-1");
    return Response.json({ status: "ok" });
  });
  render(
    <Providers>
      <AgentsScreen apiOrigin={api.origin} />
    </Providers>,
  );
  const remove = async () => {
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
    return screen.findByRole("dialog", {
      name: "„Klausur Statistik“ löschen?",
    });
  };

  await userEvent.click(
    within(await remove()).getByRole("button", { name: "Abbrechen" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(deleted).toEqual([]);

  const dialog = await remove();
  expect(dialog.textContent).toContain("endgültig gelöscht");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Löschen" }),
  );

  await waitFor(() =>
    expect(
      agentRows().map((row) => within(row).getByRole("link").textContent),
    ).toEqual(["Anderer"]),
  );
  expect(deleted).toEqual(["a-1"]);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a row's menu pauses, resumes and ends its Agent, and opens its Auftrag to edit it", async () => {
  let agent = listed({});
  const controls: string[] = [];
  api.route("GET", "/api/me/agents", () => Response.json([agent]));
  for (const [control, state] of [
    ["pause", "paused"],
    ["resume", "active"],
    ["end", "ended"],
  ] as const)
    api.route("POST", `/api/me/agents/a-1/${control}`, () => {
      controls.push(control);
      agent = listed({
        state,
        pausedBy: state === "paused" ? "student" : null,
        badge: state === "active" ? null : state,
      });
      return Response.json({ status: "ok" });
    });
  render(
    <Providers>
      <AgentsScreen apiOrigin={api.origin} />
    </Providers>,
  );
  const menu = async () => {
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Aktionen für Klausur Statistik",
      }),
    );
    return screen.findByRole("menu");
  };

  expect(
    within(await menu())
      .getByRole("menuitem", { name: "Bearbeiten" })
      .getAttribute("href"),
  ).toBe("/agents/a-1?tab=auftrag");
  await userEvent.click(
    within(screen.getByRole("menu")).getByRole("menuitem", {
      name: "Pausieren",
    }),
  );
  await waitFor(() =>
    expect(agentRows()[0]!.textContent).toContain("Pausiert"),
  );

  await userEvent.click(
    within(await menu()).getByRole("menuitem", { name: "Fortsetzen" }),
  );
  await waitFor(() =>
    expect(agentRows()[0]!.textContent).not.toContain("Pausiert"),
  );

  await userEvent.click(
    within(await menu()).getByRole("menuitem", { name: "Beenden" }),
  );
  await waitFor(() => expect(agentRows()[0]!.textContent).toContain("Beendet"));
  const ended = await menu();
  expect(
    within(ended)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual(["Bearbeiten", "Löschen"]);
  expect(controls).toEqual(["pause", "resume", "end"]);
});
