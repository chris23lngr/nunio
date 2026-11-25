import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ProjectsScreen } from "@/features/projects/projects-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

/** The page header needs the app's sidebar. */
function Providers({ children }: { children: ReactNode }) {
  return (
    <TestProviders>
      <SidebarProvider>{children}</SidebarProvider>
    </TestProviders>
  );
}

const obligation = (id: string, title: string, date: string | null) => ({
  id,
  title,
  kind: "exam",
  due: { date, time: null, timeZone: null, text: null },
});
const statistik = {
  id: "c-stat",
  title: "Statistics II",
  code: null,
  status: "accepted",
  obligations: [obligation("o-stat", "Klausur Statistics II", "2026-12-02")],
  facts: [],
};
const mikro = {
  id: "c-mikro",
  title: "Microeconomics",
  code: null,
  status: "accepted",
  obligations: [
    obligation("o-mikro", "Klausur Microeconomics", "2027-02-11"),
    obligation("o-haus", "Hausarbeit Marktversagen", null),
  ],
  facts: [],
};
const summary = (id: string, title: string, color: string) => ({
  id,
  title,
  code: null,
  status: "accepted",
  semester: "2026-ws",
  color,
  entered: true,
  archived: false,
  next: null,
  lastActivityAt: null,
});

let projects: unknown[];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-23T10:00:00Z"));
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  projects = [];
  api.route("GET", "/api/me/projects", () => Response.json(projects));
  api.route("GET", "/api/me/review", () =>
    Response.json({ courses: [statistik, mikro] }),
  );
  api.route("GET", "/api/me/courses", () =>
    Response.json({
      current: "2026-ws",
      choices: ["2026-ws"],
      courses: [
        summary("c-stat", "Statistics II", "fuchsia"),
        summary("c-mikro", "Microeconomics", "violet"),
      ],
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
});

const renderScreen = () =>
  render(
    <Providers>
      <ProjectsScreen apiOrigin={api.origin} />
    </Providers>,
  );
const rows = () =>
  within(screen.getByRole("list", { name: "Projekte" })).getAllByRole(
    "listitem",
  );

test("lists each Project with its Courses and its Ziel, or Kein Ziel", async () => {
  projects = [
    {
      id: "p-1",
      name: "Klausurvorbereitung Statistik",
      courseIds: ["c-stat", "c-mikro"],
      obligationId: "o-stat",
    },
    {
      id: "p-2",
      name: "Mikro-Lerngruppe",
      courseIds: ["c-mikro"],
      obligationId: null,
    },
  ];
  renderScreen();

  await screen.findByText("Klausurvorbereitung Statistik");
  expect(screen.getByText("2 Projekte")).toBeTruthy();
  const [first, second] = rows();
  expect(await within(first!).findByText("Statistics II")).toBeTruthy();
  expect(within(first!).getByText("Microeconomics")).toBeTruthy();
  expect(within(first!).getByText("Klausur Statistics II")).toBeTruthy();
  expect(within(first!).getByText("Mi., 2. Dez. · noch 9 Tage")).toBeTruthy();
  expect(within(second!).getByText("Kein Ziel")).toBeTruthy();
});

test("without Projects, explains them and offers to create one", async () => {
  renderScreen();

  expect(await screen.findByText("Noch keine Projekte")).toBeTruthy();
  expect(screen.queryByRole("list", { name: "Projekte" })).toBeNull();
  // Only the empty state's button, not also the header's.
  expect(screen.getAllByRole("button", { name: "Neues Projekt" })).toHaveLength(
    1,
  );
});

test("says so when the Projects cannot be loaded", async () => {
  api.route("GET", "/api/me/projects", () =>
    Response.json({ error: "boom" }, { status: 500 }),
  );
  renderScreen();

  // After the query client's one retry.
  expect(
    (await screen.findByRole("alert", {}, { timeout: 3000 })).textContent,
  ).toBe("Deine Projekte konnten nicht geladen werden.");
});

test("Neues Projekt creates a Project toward a Pflicht of its chosen Courses", async () => {
  const created: unknown[] = [];
  api.route("POST", "/api/me/projects", async (request) => {
    created.push(await request.json());
    projects = [
      {
        id: "p-new",
        name: "Klausurvorbereitung Mikro",
        courseIds: ["c-mikro"],
        obligationId: "o-mikro",
      },
    ];
    return Response.json({ id: "p-new" }, { status: 201 });
  });
  renderScreen();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Neues Projekt" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Neues Projekt" });
  await user.type(
    within(sheet).getByLabelText("Name"),
    "Klausurvorbereitung Mikro",
  );
  const ziel = within(sheet).getByRole("combobox", { name: "Ziel" });
  expect(ziel.textContent).toContain("Kein Ziel");
  await user.click(
    within(sheet).getByRole("checkbox", { name: "Microeconomics" }),
  );
  await user.click(ziel);
  // Only the chosen Courses' Pflichten are offered.
  expect(
    screen.queryByRole("option", { name: /Klausur Statistics II/ }),
  ).toBeNull();
  await user.click(
    await screen.findByRole("option", { name: /Klausur Microeconomics/ }),
  );
  await user.click(within(sheet).getByRole("button", { name: "Erstellen" }));

  await waitFor(() =>
    expect(created).toEqual([
      {
        name: "Klausurvorbereitung Mikro",
        courseIds: ["c-mikro"],
        obligationId: "o-mikro",
      },
    ]),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Neues Projekt" })).toBeNull(),
  );
  expect(await screen.findByText("Klausurvorbereitung Mikro")).toBeTruthy();
});

test("unchecking a Course drops a Ziel that belongs to it", async () => {
  const created: unknown[] = [];
  api.route("POST", "/api/me/projects", async (request) => {
    created.push(await request.json());
    return Response.json({ id: "p-new" }, { status: 201 });
  });
  renderScreen();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Neues Projekt" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Neues Projekt" });
  await user.type(within(sheet).getByLabelText("Name"), "Lerngruppe");
  const mikroBox = within(sheet).getByRole("checkbox", {
    name: "Microeconomics",
  });
  await user.click(mikroBox);
  await user.click(within(sheet).getByRole("combobox", { name: "Ziel" }));
  await user.click(
    await screen.findByRole("option", { name: /Klausur Microeconomics/ }),
  );
  await user.click(mikroBox);
  await user.click(within(sheet).getByRole("button", { name: "Erstellen" }));

  await waitFor(() =>
    expect(created).toEqual([
      { name: "Lerngruppe", courseIds: [], obligationId: null },
    ]),
  );
});

test("keeps the sheet open and says so when the Project cannot be created", async () => {
  api.route("POST", "/api/me/projects", () =>
    Response.json({ error: "nope" }, { status: 400 }),
  );
  renderScreen();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Neues Projekt" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Neues Projekt" });
  await user.type(within(sheet).getByLabelText("Name"), "Lerngruppe");
  await user.click(within(sheet).getByRole("button", { name: "Erstellen" }));

  expect((await within(sheet).findByRole("alert")).textContent).toBe(
    "Das Projekt wurde nicht erstellt. Versuche es noch einmal.",
  );
});

const oneProject = () => {
  projects = [
    {
      id: "p-1",
      name: "Bachelorarbeit",
      courseIds: ["c-stat"],
      obligationId: null,
    },
  ];
};

test("Umbenennen renames the Project in its row; Enter saves", async () => {
  oneProject();
  const renamed: unknown[] = [];
  api.route("PATCH", "/api/me/projects/p-1", async (request) => {
    renamed.push(await request.json());
    projects = [{ ...(projects[0] as object), name: "Bachelorarbeit Graphen" }];
    return Response.json({ status: "ok" });
  });
  renderScreen();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Aktionen für Bachelorarbeit" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Umbenennen" }));
  const input = within(rows()[0]!).getByRole("textbox", {
    name: "Name von Bachelorarbeit",
  });
  expect(within(rows()[0]!).getByText("Enter speichert · Esc bricht ab"));
  await user.clear(input);
  await user.type(input, "Bachelorarbeit Graphen{Enter}");

  await waitFor(() =>
    expect(renamed).toEqual([{ name: "Bachelorarbeit Graphen" }]),
  );
  expect(await screen.findByText("Bachelorarbeit Graphen")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
});

test("Esc leaves the name as it was", async () => {
  oneProject();
  const patch = vi.fn(() => Response.json({ status: "ok" }));
  api.route("PATCH", "/api/me/projects/p-1", patch);
  renderScreen();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Aktionen für Bachelorarbeit" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Umbenennen" }));
  await user.type(
    screen.getByRole("textbox", { name: "Name von Bachelorarbeit" }),
    " neu{Escape}",
  );

  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText("Bachelorarbeit")).toBeTruthy();
  expect(patch).not.toHaveBeenCalled();
});

test("Löschen asks in the row first, then deletes the Project", async () => {
  oneProject();
  const remove = vi.fn(() => {
    projects = [];
    return Response.json({ status: "ok" });
  });
  api.route("DELETE", "/api/me/projects/p-1", remove);
  renderScreen();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Aktionen für Bachelorarbeit" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Löschen" }));
  const row = rows()[0]!;
  expect(within(row).getByText("Bachelorarbeit löschen?")).toBeTruthy();
  expect(
    within(row).getByText(
      "Kurse und Ziel bleiben erhalten. Nur das Projekt verschwindet.",
    ),
  ).toBeTruthy();
  await user.click(within(row).getByRole("button", { name: "Abbrechen" }));
  expect(screen.queryByText("Bachelorarbeit löschen?")).toBeNull();
  expect(remove).not.toHaveBeenCalled();

  await user.click(
    screen.getByRole("button", { name: "Aktionen für Bachelorarbeit" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Löschen" }));
  await user.click(within(rows()[0]!).getByRole("button", { name: "Löschen" }));

  expect(await screen.findByText("Noch keine Projekte")).toBeTruthy();
  expect(remove).toHaveBeenCalledOnce();
});

test("Esc clears a failed rename error and keeps the original name", async () => {
  oneProject();
  api.route("PATCH", "/api/me/projects/p-1", () =>
    Response.json({ error: "boom" }, { status: 500 }),
  );
  renderScreen();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Aktionen für Bachelorarbeit" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Umbenennen" }));
  const input = within(rows()[0]!).getByRole("textbox", {
    name: "Name von Bachelorarbeit",
  });
  await user.type(input, " neu{Enter}");

  expect((await within(rows()[0]!).findByRole("alert")).textContent).toBe(
    "Das Projekt wurde nicht umbenannt. Versuche es noch einmal.",
  );
  await user.keyboard("{Escape}");

  expect(screen.queryByRole("textbox")).toBeNull();
  expect(within(rows()[0]!).queryByRole("alert")).toBeNull();
  expect(within(rows()[0]!).getByText("Bachelorarbeit")).toBeTruthy();
});

test("keeps the delete confirmation open and says so when deleting fails", async () => {
  oneProject();
  api.route("DELETE", "/api/me/projects/p-1", () =>
    Response.json({ error: "boom" }, { status: 500 }),
  );
  renderScreen();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Aktionen für Bachelorarbeit" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Löschen" }));
  await user.click(within(rows()[0]!).getByRole("button", { name: "Löschen" }));

  expect((await within(rows()[0]!).findByRole("alert")).textContent).toBe(
    "Das Projekt wurde nicht gelöscht. Versuche es noch einmal.",
  );
  expect(within(rows()[0]!).getByText("Bachelorarbeit löschen?")).toBeTruthy();
});

test("reopening Neues Projekt starts with an empty name and Kein Ziel", async () => {
  api.route("POST", "/api/me/projects", () => {
    projects = [
      {
        id: "p-new",
        name: "Klausurvorbereitung Mikro",
        courseIds: ["c-mikro"],
        obligationId: "o-mikro",
      },
    ];
    return Response.json({ id: "p-new" }, { status: 201 });
  });
  renderScreen();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Neues Projekt" }),
  );
  const firstSheet = await screen.findByRole("dialog", {
    name: "Neues Projekt",
  });
  await user.type(
    within(firstSheet).getByLabelText("Name"),
    "Klausurvorbereitung Mikro",
  );
  await user.click(
    within(firstSheet).getByRole("checkbox", { name: "Microeconomics" }),
  );
  await user.click(within(firstSheet).getByRole("combobox", { name: "Ziel" }));
  await user.click(
    await screen.findByRole("option", { name: /Klausur Microeconomics/ }),
  );
  await user.click(
    within(firstSheet).getByRole("button", { name: "Erstellen" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "Neues Projekt" })).toBeNull(),
  );

  await user.click(screen.getByRole("button", { name: "Neues Projekt" }));
  const secondSheet = await screen.findByRole("dialog", {
    name: "Neues Projekt",
  });
  expect(
    (within(secondSheet).getByLabelText("Name") as HTMLInputElement).value,
  ).toBe("");
  expect(
    within(secondSheet).getByRole("combobox", { name: "Ziel" }).textContent,
  ).toContain("Kein Ziel");
});

test("Neues Projekt says so when the Courses cannot be loaded", async () => {
  api.route("GET", "/api/me/review", () =>
    Response.json({ error: "boom" }, { status: 500 }),
  );
  renderScreen();
  const user = userEvent.setup();

  await user.click(
    await screen.findByRole("button", { name: "Neues Projekt" }),
  );
  const sheet = await screen.findByRole("dialog", { name: "Neues Projekt" });
  expect(
    (await within(sheet).findByRole("alert", {}, { timeout: 3000 }))
      .textContent,
  ).toBe("Deine Kurse konnten nicht geladen werden.");
  expect(
    within(sheet).queryByText("Du hast noch keine bestätigten Kurse."),
  ).toBeNull();
});

test("formats due dates as heute, morgen, and plain date once past", async () => {
  api.route("GET", "/api/me/review", () =>
    Response.json({
      courses: [
        {
          ...statistik,
          obligations: [
            obligation("o-today", "Abgabe heute", "2026-11-23"),
            obligation("o-tomorrow", "Abgabe morgen", "2026-11-24"),
            obligation("o-past", "Vergangene Pflicht", "2026-11-20"),
          ],
        },
      ],
    }),
  );
  projects = [
    {
      id: "p-1",
      name: "Heute",
      courseIds: ["c-stat"],
      obligationId: "o-today",
    },
    {
      id: "p-2",
      name: "Morgen",
      courseIds: ["c-stat"],
      obligationId: "o-tomorrow",
    },
    {
      id: "p-3",
      name: "Vorbei",
      courseIds: ["c-stat"],
      obligationId: "o-past",
    },
  ];
  renderScreen();

  await screen.findByText("Heute");
  const [first, second, third] = rows();
  expect(await within(first!).findByText("Mo., 23. Nov. · heute")).toBeTruthy();
  expect(within(second!).getByText("Di., 24. Nov. · morgen")).toBeTruthy();
  expect(within(third!).getByText("Fr., 20. Nov.")).toBeTruthy();
});
