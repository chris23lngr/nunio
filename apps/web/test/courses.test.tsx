import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { CoursesScreen } from "@/features/courses/courses-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

beforeEach(() => replace.mockReset());

const choices = [
  "2027-ss",
  "2026-ws",
  "2026-ss",
  "2025-ws",
  "2025-ss",
  "2024-ws",
  "2024-ss",
  "2023-ws",
  "2023-ss",
  "2022-ws",
];

function course(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    code: null,
    title: "Kurs",
    status: "accepted",
    semester: "2026-ws",
    color: "rose",
    entered: false,
    archived: false,
    next: null,
    ...overrides,
  };
}

const due = (
  title: string,
  date: string,
  time: string | null,
  unreviewed = false,
) => ({
  id: crypto.randomUUID(),
  kind: "assignment",
  title,
  due: { date, time, timeZone: "Europe/Berlin" },
  unreviewed,
});

function serveCourses(courses: unknown[]) {
  api.route("GET", "/api/me/courses", () =>
    Response.json({ current: "2026-ws", choices, courses }),
  );
}

function renderScreen(semester?: string) {
  render(
    <TestProviders>
      <CoursesScreen apiOrigin={api.origin} semester={semester} />
    </TestProviders>,
  );
}

/** Each card's text, in the order shown. */
async function cards() {
  const list = await screen.findByRole("list", { name: /^Kurse/ });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

test("shows the current Semester's accepted Courses in the order the server gives, Archived ones greyed", async () => {
  serveCourses([
    course({
      title: "Analysis I",
      code: "MA-101",
      next: due("Blatt 3", "2026-11-20", "12:00", true),
    }),
    course({
      title: "Statistik II",
      code: "STA2",
      next: due("Klausur", "2027-02-12", null),
    }),
    course({ title: "Algorithmen", semester: "2026-ss" }),
    course({ title: "Datenbanken", status: "proposed" }),
    course({ title: "Lineare Algebra" }),
    course({ title: "Mikroökonomik", archived: true }),
  ]);
  renderScreen();

  expect(await cards()).toEqual([
    "MA-101Analysis IBlatt 3 · Freitag, 20.11. um 12:00 Uhrungeprüft",
    "STA2Statistik IIKlausur · Freitag, 12.02.",
    "Lineare AlgebraNichts fällig",
    "MikroökonomikArchiviertNichts fällig",
  ]);
});

test("shows the current Semester when the URL names none that exists", async () => {
  serveCourses([
    course({ title: "Analysis I" }),
    course({ title: "Algorithmen", semester: "2026-ss" }),
  ]);
  renderScreen("winter");

  expect(await cards()).toEqual(["Analysis INichts fällig"]);
});

test("offers the current Semester, those with Courses and all of them, and keeps the choice in the URL", async () => {
  serveCourses([
    course({ title: "Analysis I" }),
    course({ title: "Algorithmen", semester: "2026-ss" }),
    course({ title: "Datenbanken", semester: "2025-ws", status: "proposed" }),
  ]);
  renderScreen("2026-ss");
  const user = userEvent.setup();

  expect(await cards()).toEqual(["AlgorithmenNichts fällig"]);
  await user.click(screen.getByRole("combobox", { name: "Semester" }));
  expect(
    (await screen.findAllByRole("option")).map((item) => item.textContent),
  ).toEqual([
    "Wintersemester 2026/27 (aktuell)",
    "Sommersemester 2026",
    "Alle Semester",
  ]);

  await user.click(
    await screen.findByRole("option", { name: "Alle Semester" }),
  );
  expect(replace).toHaveBeenLastCalledWith("/courses?semester=all", {
    scroll: false,
  });
  await user.click(screen.getByRole("combobox", { name: "Semester" }));
  await user.click(
    await screen.findByRole("option", {
      name: "Wintersemester 2026/27 (aktuell)",
    }),
  );
  expect(replace).toHaveBeenLastCalledWith("/courses", { scroll: false });
});

test("shows every proposal whatever the Semester, to accept or reject in place", async () => {
  const datenbanken = course({
    title: "Datenbanken",
    code: "DB",
    status: "proposed",
    semester: "2025-ws",
  });
  const physik = course({ title: "Physik", status: "proposed" });
  let courses = [course({ title: "Analysis I" }), datenbanken, physik];
  const decisions: unknown[] = [];
  api.route("GET", "/api/me/courses", () =>
    Response.json({ current: "2026-ws", choices, courses }),
  );
  for (const proposal of [datenbanken, physik])
    api.route(
      "POST",
      `/api/me/courses/${proposal.id}/decision`,
      async (request) => {
        const { decision } = (await request.json()) as { decision: string };
        decisions.push([proposal.title, decision]);
        courses = courses
          .map((c) =>
            c.id === proposal.id
              ? {
                  ...c,
                  status: decision === "accept" ? "accepted" : "rejected",
                }
              : c,
          )
          .filter((c) => c.status !== "rejected");
        return Response.json({ status: "ok" });
      },
    );
  renderScreen();
  const user = userEvent.setup();

  const proposals = await screen.findByRole("region", {
    name: "Von nunio erkannt",
  });
  expect(
    within(proposals)
      .getAllByRole("listitem")
      .map((i) => i.textContent),
  ).toEqual(["DB · DatenbankenAnnehmenAblehnen", "PhysikAnnehmenAblehnen"]);
  await user.click(
    within(proposals).getAllByRole("button", { name: "Ablehnen" })[1]!,
  );
  await waitFor(() =>
    expect(within(proposals).queryByText("Physik")).toBeNull(),
  );
  await user.click(within(proposals).getByRole("button", { name: "Annehmen" }));

  expect(decisions).toEqual([
    ["Physik", "reject"],
    ["Datenbanken", "accept"],
  ]);
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Von nunio erkannt" }),
    ).toBeNull(),
  );
});

test("explains how Courses come about when there are none, and says when a Semester is empty", async () => {
  serveCourses([]);
  const { unmount } = render(
    <TestProviders>
      <CoursesScreen apiOrigin={api.origin} />
    </TestProviders>,
  );
  expect(
    await screen.findByRole("heading", { name: "Noch keine Kurse" }),
  ).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Quellen hochladen" })
      .getAttribute("href"),
  ).toBe("/");
  expect(screen.getByRole("button", { name: "Kurs erstellen" })).toBeTruthy();
  unmount();

  serveCourses([course({ title: "Algorithmen", semester: "2026-ss" })]);
  renderScreen();
  expect(
    await screen.findByRole("heading", {
      name: "Keine Kurse in Wintersemester 2026/27",
    }),
  ).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Quellen hochladen" })).toBeNull();
});

test("points to the proposals when nunio found Courses but none is accepted yet", async () => {
  serveCourses([course({ title: "Physik", status: "proposed" })]);
  renderScreen();

  expect(
    await screen.findByRole("heading", { name: "Nimm deine Kurse an" }),
  ).toBeTruthy();
});

test("offers to try again when the Courses cannot be loaded", async () => {
  let fail = true;
  api.route("GET", "/api/me/courses", () =>
    fail
      ? Response.json({ error: "unavailable" }, { status: 500 })
      : Response.json({
          current: "2026-ws",
          choices,
          courses: [course({ title: "Analysis I" })],
        }),
  );
  renderScreen();
  const user = userEvent.setup();

  expect(
    await screen.findByText(
      "Deine Kurse konnten nicht geladen werden.",
      {},
      { timeout: 3000 },
    ),
  ).toBeTruthy();
  fail = false;
  await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
  expect(await cards()).toEqual(["Analysis INichts fällig"]);
});

test("creates a Course in the shown Semester, and names the Course a clash points to", async () => {
  const analysis = course({ title: "Analysis I", status: "proposed" });
  let courses: unknown[] = [
    course({ title: "Algorithmen", semester: "2026-ss" }),
    analysis,
  ];
  const created: unknown[] = [];
  api.route("GET", "/api/me/courses", () =>
    Response.json({ current: "2026-ws", choices, courses }),
  );
  api.route("POST", "/api/me/courses", async (request) => {
    const body = (await request.json()) as { title: string };
    created.push(body);
    if (body.title === "analysis i")
      return Response.json(
        {
          error: "clash",
          course: {
            id: analysis.id,
            title: "Analysis I",
            status: "proposed",
            archived: false,
          },
        },
        { status: 409 },
      );
    courses = [...courses, course({ title: body.title, semester: "2026-ss" })];
    return Response.json({ id: "new" }, { status: 201 });
  });
  renderScreen("2026-ss");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Erstellen" }));
  const dialog = await screen.findByRole("dialog", { name: "Kurs erstellen" });
  expect(within(dialog).getByLabelText("Semester").textContent).toContain(
    "Sommersemester 2026",
  );
  await user.type(within(dialog).getByLabelText("Titel"), "analysis i");
  await user.click(
    within(dialog).getByRole("button", { name: "Kurs erstellen" }),
  );
  expect(
    await within(dialog).findByText(
      "„Analysis I“ gibt es schon als Vorschlag von nunio. Nimm ihn oben an, statt einen neuen anzulegen.",
    ),
  ).toBeTruthy();

  await user.clear(within(dialog).getByLabelText("Titel"));
  await user.type(within(dialog).getByLabelText("Titel"), "Datenbanken");
  await user.type(within(dialog).getByLabelText("Kürzel (optional)"), "DB");
  await user.click(
    within(dialog).getByRole("button", { name: "Kurs erstellen" }),
  );

  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(created.at(-1)).toEqual({
    title: "Datenbanken",
    code: "DB",
    semester: "2026-ss",
  });
  expect(await cards()).toEqual([
    "AlgorithmenNichts fällig",
    "DatenbankenNichts fällig",
  ]);
});

/** Opens a card's menu and returns its item labels. */
async function menuOf(title: string) {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: `Aktionen für ${title}` }),
  );
  return (await screen.findAllByRole("menuitem")).map(
    (item) => item.textContent,
  );
}

test("offers Reject only for Courses nunio proposed, and Restore for Archived ones", async () => {
  serveCourses([
    course({ title: "Analysis I", next: due("Blatt 3", "2026-11-20", null) }),
    course({ title: "Eigener Kurs", entered: true }),
    course({ title: "Mikroökonomik", archived: true }),
  ]);
  renderScreen();

  expect(await menuOf("Analysis I")).toEqual([
    "Bearbeiten",
    "Archivieren",
    "Ablehnen",
    "Löschen",
  ]);
  await userEvent.setup().keyboard("{Escape}");
  expect(await menuOf("Eigener Kurs")).toEqual([
    "Bearbeiten",
    "Archivieren",
    "Löschen",
  ]);
  await userEvent.setup().keyboard("{Escape}");
  expect(await menuOf("Mikroökonomik")).toEqual([
    "Bearbeiten",
    "Archivierung aufheben",
    "Ablehnen",
    "Löschen",
  ]);
});

test("archives after showing what stops, and restores without asking", async () => {
  const analysis = course({ title: "Analysis I" });
  const calls: string[] = [];
  api.route("GET", "/api/me/courses", () =>
    Response.json({
      current: "2026-ws",
      choices,
      courses: [{ ...analysis, archived: calls.at(-1) === "archive" }],
    }),
  );
  api.route("GET", `/api/me/courses/${analysis.id}/impact`, () =>
    Response.json({
      obligations: 3,
      tasks: 2,
      studyBlocks: 6,
      futureStudyBlocks: 4,
      responsibilities: 1,
    }),
  );
  for (const action of ["archive", "unarchive"])
    api.route("POST", `/api/me/courses/${analysis.id}/${action}`, () => {
      calls.push(action);
      return Response.json({ status: "ok" });
    });
  renderScreen();
  const user = userEvent.setup();

  await menuOf("Analysis I");
  await user.click(screen.getByRole("menuitem", { name: "Archivieren" }));
  const dialog = await screen.findByRole("dialog", {
    name: "„Analysis I“ archivieren?",
  });
  expect(
    await within(dialog).findByText(
      "nunio plant und arbeitet nicht mehr für diesen Kurs. 4 geplante Lernzeiten werden entfernt, und 1 laufender Auftrag an nunio wird pausiert.",
    ),
  ).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "Archivieren" }));
  await waitFor(() => expect(calls).toEqual(["archive"]));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

  await screen.findByText("Archiviert");
  await menuOf("Analysis I");
  await user.click(
    screen.getByRole("menuitem", { name: "Archivierung aufheben" }),
  );
  await waitFor(() => expect(calls).toEqual(["archive", "unarchive"]));
});

test("deletes after saying what goes and that the Sources stay, and rejects after confirming", async () => {
  const analysis = course({ title: "Analysis I" });
  const statistik = course({ title: "Statistik II" });
  const calls: unknown[] = [];
  serveCourses([analysis, statistik]);
  api.route("GET", `/api/me/courses/${analysis.id}/impact`, () =>
    Response.json({
      obligations: 3,
      tasks: 2,
      studyBlocks: 6,
      futureStudyBlocks: 4,
      responsibilities: 0,
    }),
  );
  api.route("DELETE", `/api/me/courses/${analysis.id}`, () => {
    calls.push("delete");
    return Response.json({ status: "ok" });
  });
  api.route(
    "POST",
    `/api/me/courses/${statistik.id}/decision`,
    async (request) => {
      calls.push(await request.json());
      return Response.json({ status: "ok" });
    },
  );
  renderScreen();
  const user = userEvent.setup();

  await menuOf("Analysis I");
  await user.click(screen.getByRole("menuitem", { name: "Löschen" }));
  const deletion = await screen.findByRole("dialog", {
    name: "„Analysis I“ löschen?",
  });
  expect(
    await within(deletion).findByText(
      "3 Termine, 2 Aufgaben und 6 Lernzeiten werden endgültig gelöscht. Deine Quellen bleiben erhalten.",
    ),
  ).toBeTruthy();
  await user.click(
    within(deletion).getByRole("button", { name: "Endgültig löschen" }),
  );
  await waitFor(() => expect(calls).toEqual(["delete"]));

  await menuOf("Statistik II");
  await user.click(screen.getByRole("menuitem", { name: "Ablehnen" }));
  const rejection = await screen.findByRole("dialog", {
    name: "„Statistik II“ ablehnen?",
  });
  await user.click(within(rejection).getByRole("button", { name: "Ablehnen" }));
  await waitFor(() =>
    expect(calls).toEqual(["delete", { decision: "reject" }]),
  );
});

test("edits a Course's name, Semester and color", async () => {
  const analysis = course({ title: "Analysis I", code: "MA1", color: "rose" });
  const edits: unknown[] = [];
  serveCourses([analysis]);
  api.route("PATCH", `/api/me/courses/${analysis.id}`, async (request) => {
    edits.push(await request.json());
    return Response.json({ status: "ok" });
  });
  renderScreen();
  const user = userEvent.setup();

  await menuOf("Analysis I");
  await user.click(screen.getByRole("menuitem", { name: "Bearbeiten" }));
  const dialog = await screen.findByRole("dialog", { name: "Kurs bearbeiten" });
  expect(
    (within(dialog).getByLabelText("Titel") as HTMLInputElement).value,
  ).toBe("Analysis I");
  await user.clear(within(dialog).getByLabelText("Titel"));
  await user.type(within(dialog).getByLabelText("Titel"), "Analysis 1");
  await user.click(within(dialog).getByLabelText("Semester"));
  await user.click(
    await screen.findByRole("option", { name: "Sommersemester 2027" }),
  );
  await user.click(within(dialog).getByRole("radio", { name: "Türkis" }));
  await user.click(within(dialog).getByRole("button", { name: "Speichern" }));

  await waitFor(() =>
    expect(edits).toEqual([
      { title: "Analysis 1", code: "MA1", semester: "2027-ss", color: "teal" },
    ]),
  );
});

test("says when a proposal cannot be decided, or what archiving touches cannot be loaded, and lets the student retry", async () => {
  const physik = course({ title: "Physik", status: "proposed" });
  const analysis = course({ title: "Analysis I" });
  let impactFails = true;
  serveCourses([analysis, physik]);
  api.route("POST", `/api/me/courses/${physik.id}/decision`, () =>
    Response.json({ error: "unavailable" }, { status: 500 }),
  );
  api.route("GET", `/api/me/courses/${analysis.id}/impact`, () =>
    impactFails
      ? Response.json({ error: "unavailable" }, { status: 500 })
      : Response.json({
          obligations: 0,
          tasks: 0,
          studyBlocks: 0,
          futureStudyBlocks: 0,
          responsibilities: 0,
        }),
  );
  renderScreen();
  const user = userEvent.setup();

  const proposals = await screen.findByRole("region", {
    name: "Von nunio erkannt",
  });
  await user.click(within(proposals).getByRole("button", { name: "Annehmen" }));
  expect(
    await within(proposals).findByText(
      "Das hat nicht geklappt. Versuche es noch einmal.",
    ),
  ).toBeTruthy();

  await menuOf("Analysis I");
  await user.click(screen.getByRole("menuitem", { name: "Archivieren" }));
  const dialog = await screen.findByRole("dialog", {
    name: "„Analysis I“ archivieren?",
  });
  expect(
    await within(dialog).findByText(
      "Was davon betroffen ist, konnte nicht geladen werden.",
      {},
      { timeout: 3000 },
    ),
  ).toBeTruthy();
  impactFails = false;
  await user.click(
    within(dialog).getByRole("button", { name: "Erneut laden" }),
  );
  expect(
    await within(dialog).findByText(
      "nunio plant und arbeitet nicht mehr für diesen Kurs.",
    ),
  ).toBeTruthy();
});
