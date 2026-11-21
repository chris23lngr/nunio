import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import { AgentScreen } from "@/features/agents/agent-screen";
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

const courses = [
  {
    id: "c0000000-0000-4000-8000-000000000001",
    code: "MA-101",
    title: "Analysis I",
    status: "accepted",
    obligations: [],
    facts: [],
  },
  {
    id: "c0000000-0000-4000-8000-000000000002",
    code: null,
    title: "Physik I",
    status: "proposed",
    obligations: [],
    facts: [],
  },
];

test("the student delegates 'keep this course organized' for one of their accepted Courses", async () => {
  let delegated: object[] = [];
  const created: unknown[] = [];
  api.route("GET", "/api/me/agents", () => Response.json(delegated));
  api.route("GET", "/api/me/review", () => Response.json({ courses }));
  api.route("POST", "/api/me/agents", async (request) => {
    created.push(await request.json());
    delegated = [
      {
        id: "r-1",
        preset: "keep_course_organized",
        course: { id: courses[0]!.id, title: "Analysis I" },
        state: "active",
        pausedBy: null,
      },
    ];
    return Response.json({ id: "r-1" }, { status: 201 });
  });
  render(
    <Providers>
      <AgentsScreen apiOrigin={api.origin} />
    </Providers>,
  );

  const course = await screen.findByRole("combobox", { name: "Course" });
  await userEvent.click(course);
  await screen.findByRole("option", { name: "Analysis I" });
  expect(screen.queryByRole("option", { name: "Physik I" })).toBeNull();
  await userEvent.click(screen.getByRole("option", { name: "Analysis I" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Keep this course organized" }),
  );

  const row = await screen.findByRole("link", {
    name: /Keep Analysis I organized/,
  });
  expect(row.getAttribute("href")).toBe("/agents/r-1");
  await waitFor(() =>
    expect(created).toEqual([
      { preset: "keep_course_organized", courseId: courses[0]!.id },
    ]),
  );
});

const shown = (state: "active" | "paused") => ({
  id: "r-1",
  preset: "keep_course_organized",
  course: { id: courses[0]!.id, title: "Analysis I" },
  state,
  pausedBy: state === "paused" ? "student" : null,
  grants: ["studyBlock.create", "studyBlock.move"],
  budget: { limitMicroUsd: 1_000_000, usedMicroUsd: 250_000, heldMicroUsd: 0 },
  recentActions: [
    {
      id: "a-1",
      status: "done",
      refusal: null,
      at: "2026-11-17T05:00:00.000Z",
      action: {
        kind: "studyBlock.create",
        work: { title: "Problem sheet 1", course: "Analysis I" },
        from: null,
        to: {
          start: "2026-11-17T09:00:00.000Z",
          end: "2026-11-17T10:00:00.000Z",
        },
      },
    },
  ],
  next:
    state === "active"
      ? {
          runAt: "2026-11-18T05:00:00.000Z",
          action: {
            kind: "studyBlock.create",
            work: { title: "Problem sheet 2", course: "Analysis I" },
            from: null,
            to: {
              start: "2026-11-18T09:00:00.000Z",
              end: "2026-11-18T10:00:00.000Z",
            },
          },
        }
      : { runAt: null, action: null },
});

test("an Agent's screen shows its scope, Grants, recent and next Actions and Budget, and pauses it", async () => {
  let state: "active" | "paused" = "active";
  const controls: string[] = [];
  api.route("GET", "/api/me/agents/r-1", () => Response.json(shown(state)));
  api.route("POST", "/api/me/agents/r-1/pause", () => {
    controls.push("pause");
    state = "paused";
    return Response.json({ status: "ok" });
  });
  render(
    <Providers>
      <AgentScreen apiOrigin={api.origin} id="r-1" />
    </Providers>,
  );

  expect(
    await screen.findByRole("heading", { name: "Keep Analysis I organized" }),
  ).toBeTruthy();
  expect(
    screen.getByText(/add Study Blocks and move the ones nunio placed/i),
  ).toBeTruthy();
  expect(
    screen.getByRole("list", { name: "Recent Actions" }).textContent,
  ).toMatch(/Added a block for Problem sheet 1/);
  expect(
    screen.getByText(/Next: add a block for Problem sheet 2/),
  ).toBeTruthy();
  expect(screen.getByText("$0.25 of $1.00 used")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Pause" }));

  expect(await screen.findByRole("button", { name: "Resume" })).toBeTruthy();
  expect(screen.getByText(/Paused by you/)).toBeTruthy();
  expect(controls).toEqual(["pause"]);
});

test("pausing refreshes the list even while its cached state is fresh", async () => {
  let state: "active" | "paused" = "active";
  api.route("GET", "/api/me/review", () => Response.json({ courses }));
  api.route("GET", "/api/me/agents", () =>
    Response.json([
      { ...shown(state), badge: state === "paused" ? "paused" : null },
    ]),
  );
  api.route("GET", "/api/me/agents/r-1", () => Response.json(shown(state)));
  api.route("POST", "/api/me/agents/r-1/pause", () => {
    state = "paused";
    return Response.json({ status: "ok" });
  });
  render(
    <Providers>
      <AgentsScreen apiOrigin={api.origin} />
      <AgentScreen apiOrigin={api.origin} id="r-1" />
    </Providers>,
  );
  const row = (
    await screen.findByRole("link", { name: "Keep Analysis I organized" })
  ).closest("li")!;
  expect(row.textContent).not.toContain("Pausiert");
  await userEvent.click(await screen.findByRole("button", { name: "Pause" }));
  await screen.findByRole("button", { name: "Resume" });
  await waitFor(() => expect(row.textContent).toContain("Pausiert"));
});

test("the student delegates 'prepare me for this exam' for one of their exams", async () => {
  const withExams = [
    {
      ...courses[0]!,
      obligations: [
        {
          id: "e0000000-0000-4000-8000-000000000001",
          kind: "exam",
          title: "Klausur",
          state: "confirmed",
        },
        {
          id: "e0000000-0000-4000-8000-000000000002",
          kind: "assignment",
          title: "Blatt 3",
          state: "confirmed",
        },
        {
          id: "e0000000-0000-4000-8000-000000000003",
          kind: "exam",
          title: "Probeklausur",
          state: "rejected",
        },
      ],
    },
  ];
  const created: unknown[] = [];
  api.route("GET", "/api/me/agents", () => Response.json([]));
  api.route("GET", "/api/me/review", () =>
    Response.json({ courses: withExams }),
  );
  api.route("POST", "/api/me/agents", async (request) => {
    created.push(await request.json());
    return Response.json({ id: "r-2" }, { status: 201 });
  });
  render(
    <Providers>
      <AgentsScreen apiOrigin={api.origin} />
    </Providers>,
  );

  const exam = await screen.findByRole("combobox", { name: "Exam" });
  await userEvent.click(exam);
  await screen.findByRole("option", { name: "Klausur (Analysis I)" });
  expect(
    screen.queryByRole("option", { name: /Blatt 3|Probeklausur/ }),
  ).toBeNull();
  await userEvent.click(
    screen.getByRole("option", { name: "Klausur (Analysis I)" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Prepare me for this exam" }),
  );

  await waitFor(() =>
    expect(created).toEqual([
      {
        preset: "prepare_for_exam",
        obligationId: "e0000000-0000-4000-8000-000000000001",
      },
    ]),
  );
});

test("an exam's Agent is named for the exam in the list and on its screen", async () => {
  const exam = { id: "e0000000-0000-4000-8000-000000000001", title: "Klausur" };
  api.route("GET", "/api/me/agents", () =>
    Response.json([
      {
        id: "r-2",
        preset: "prepare_for_exam",
        course: { id: courses[0]!.id, title: "Analysis I" },
        exam,
        state: "active",
        pausedBy: null,
      },
    ]),
  );
  api.route("GET", "/api/me/review", () => Response.json({ courses }));
  api.route("GET", "/api/me/agents/r-2", () =>
    Response.json({
      ...shown("active"),
      id: "r-2",
      preset: "prepare_for_exam",
      exam,
    }),
  );
  render(
    <Providers>
      <AgentsScreen apiOrigin={api.origin} />
      <AgentScreen apiOrigin={api.origin} id="r-2" />
    </Providers>,
  );

  expect(
    (
      await screen.findByRole("link", { name: "Prepare for Klausur" })
    ).getAttribute("href"),
  ).toBe("/agents/r-2");
  expect(
    await screen.findByRole("heading", {
      name: "Prepare for Klausur (Analysis I)",
    }),
  ).toBeTruthy();
});

/** A free-text Agent as the list returns it. */
const listed = (overrides: Record<string, unknown>) => ({
  id: "a-1",
  preset: null,
  name: "Klausur Statistik",
  description: "Hält meine Klausurvorbereitung auf Kurs.",
  emoji: "📊",
  course: null,
  exam: null,
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
  api.route("GET", "/api/me/review", () => Response.json({ courses: [] }));
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
  api.route("GET", "/api/me/review", () => Response.json({ courses: [] }));
  api.route("GET", "/api/me/agents", () =>
    Response.json(
      [
        ["a-1", "student"],
        ["a-2", "budget"],
        ["a-3", "course_archived"],
        ["a-4", "no_course"],
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

  await screen.findByRole("link", { name: "Agent a-4" });
  expect(agentRows().map((row) => row.textContent)).toEqual([
    expect.not.stringMatching(/Pausiert:|Von dir/),
    expect.stringContaining("Pausiert: Budget aufgebraucht"),
    expect.stringContaining("Pausiert: Alle Kurse archiviert"),
    expect.stringContaining("Pausiert: Kein Kurs mehr"),
  ]);
});

test("Agenten durchsuchen narrows the list to Agents whose name or Beschreibung matches", async () => {
  api.route("GET", "/api/me/review", () => Response.json({ courses: [] }));
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
        preset: "keep_course_organized",
        name: "",
        description: "",
        course: { id: "c-1", title: "Lineare Algebra" },
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
  ).toEqual(["Keep Lineare Algebra organized"]);

  await userEvent.clear(search);
  await userEvent.type(search, "Briefing");
  expect(screen.queryByRole("list", { name: "Agenten" })).toBeNull();
  expect(screen.getByText("Kein Agent passt zu deiner Suche.")).toBeTruthy();
});

test("a row's menu offers Freigaben bestätigen while an Approval is open, then Bearbeiten, the lifecycle and, apart, Löschen", async () => {
  api.route("GET", "/api/me/review", () => Response.json({ courses: [] }));
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
  api.route("GET", "/api/me/review", () => Response.json({ courses: [] }));
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
  api.route("GET", "/api/me/review", () => Response.json({ courses: [] }));
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
