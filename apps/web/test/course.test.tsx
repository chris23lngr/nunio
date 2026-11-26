import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { CourseScreen } from "@/features/courses/course-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => `/courses/${courseId}`,
}));

const courseId = crypto.randomUUID();
const ids = {
  sorting: crypto.randomUUID(),
  trees: crypto.randomUUID(),
  graphs: crypto.randomUUID(),
  hashing: crypto.randomUUID(),
  lecture: crypto.randomUUID(),
  intro: crypto.randomUUID(),
};
const daysFromNow = (days: number, hour = 12) => {
  const at = new Date();
  at.setDate(at.getDate() + days);
  at.setHours(hour, 0, 0, 0);
  return at.toISOString();
};

type Page = Record<string, unknown>;
function page(overrides: Page = {}): Page {
  return {
    course: {
      id: courseId,
      code: "INF2",
      title: "Operations Management",
      status: "accepted",
      semester: "2026-ws",
      color: "violet",
      entered: false,
      archived: false,
    },
    sources: [
      {
        id: ids.lecture,
        title: "Vorlesung 04.pdf",
        bytes: 12_582_912,
        createdAt: daysFromNow(-3),
      },
      {
        id: ids.intro,
        title: "Einführung Operations Management.pdf",
        bytes: 2_097_152,
        createdAt: daysFromNow(-28),
      },
    ],
    topics: [
      topic(ids.sorting, "Sortieralgorithmen", "solid", daysFromNow(-2)),
      topic(ids.trees, "Bäume und Suchstrukturen", "shaky", daysFromNow(0, 0)),
      topic(ids.graphs, "Graphen", "weak", daysFromNow(-7)),
      topic(ids.hashing, "Hashing", "not_studied", null),
    ],
    dated: [],
    disagreements: [],
    ...overrides,
  };
}
function topic(
  id: string,
  title: string,
  level: string,
  lastEvidenceAt: string | null,
) {
  return {
    id,
    title,
    level,
    lastEvidenceAt,
    sources: [{ id: ids.lecture, title: "Vorlesung 04.pdf", pages: [7] }],
  };
}

/** Serves the course page, its Topic Areas (none by default), and records what the student sends. */
function serve(
  data: Page = page(),
  areas: Page = { areas: [], ungrouped: [] },
) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  let current = data;
  api.route("GET", `/api/me/courses/${courseId}`, () => Response.json(current));
  api.route("GET", `/api/me/courses/${courseId}/topic-areas`, () =>
    Response.json(areas),
  );
  api.route("GET", "/api/me/artifacts", () => Response.json([]));
  const record = (reply: unknown) => async (request: Request) => {
    const text = await request.text();
    sent.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: text ? JSON.parse(text) : null,
    });
    return Response.json(reply);
  };
  return {
    sent,
    record,
    /** What the page shows from the next fetch on. */
    change: (next: Page) => {
      current = next;
    },
  };
}

function renderScreen(topicId?: string) {
  return render(
    <TestProviders>
      <SidebarProvider>
        <CourseScreen apiOrigin={api.origin} id={courseId} topic={topicId} />
      </SidebarProvider>
    </TestProviders>,
  );
}

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

test("shows the Course with its code, Semester and Sources, a way to learn, and its Topics with the student's Level and last Evidence", async () => {
  serve();
  renderScreen();

  await screen.findByRole("heading", {
    level: 1,
    name: "Operations Management",
  });
  const crumbs = screen.getByRole("navigation", { name: "breadcrumb" });
  expect(
    within(crumbs).getByRole("link", { name: "Kurse" }).getAttribute("href"),
  ).toBe("/courses");
  const facts = screen.getByRole("list", { name: "Über den Kurs" });
  expect(
    within(facts)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["INF2", "Wintersemester 2026/27", "2 Quellen"]);
  expect(
    screen.getByRole("link", { name: "Lernen" }).getAttribute("href"),
  ).toBe("/artifacts");

  const topics = screen.getByRole("list", { name: "Themen" });
  expect(
    within(topics)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    "SicherSortieralgorithmenVor 2 Tagen",
    "UnsicherBäume und SuchstrukturenHeute",
    "SchwachpunktGraphenVor 1 Woche",
    "Nicht gelerntHashingNoch nie",
  ]);
});

test("groups Topics into collapsed Topic Areas with their counts, the rest last under Weitere Themen", async () => {
  const ref = (id: string, name: string) => ({ id, name });
  serve(page(), {
    areas: [
      {
        id: crypto.randomUUID(),
        name: "Algorithmen",
        inferred: false,
        topics: [
          ref(ids.graphs, "Graphen"),
          ref(ids.sorting, "Sortieralgorithmen"),
        ],
      },
    ],
    ungrouped: [
      ref(ids.trees, "Bäume und Suchstrukturen"),
      ref(ids.hashing, "Hashing"),
    ],
  });
  renderScreen();

  const algorithms = await screen.findByRole("button", {
    name: "Algorithmen 2",
  });
  const others = screen.getByRole("button", { name: "Weitere Themen 2" });
  expect(algorithms.getAttribute("aria-expanded")).toBe("false");
  expect(others.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Graphen")).toBeNull();

  await userEvent.click(algorithms);

  expect(
    within(screen.getByRole("list", { name: "Algorithmen" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    "SchwachpunktGraphenVor 1 Woche",
    "SicherSortieralgorithmenVor 2 Tagen",
  ]);
  expect(screen.queryByText("Hashing")).toBeNull();
});

function artifact(overrides: Record<string, unknown>) {
  return {
    id: crypto.randomUUID(),
    kind: "practice_set",
    status: "ready",
    failure: null,
    topicIds: [],
    obligationId: null,
    createdAt: daysFromNow(-2),
    openedAt: null,
    withdrawn: false,
    title: "Artefakt",
    courseId,
    count: null,
    version: 1,
    updatedAt: daysFromNow(-2),
    lastPractisedAt: null,
    shaky: false,
    ...overrides,
  };
}

test("opens a Topic's details with its Level to change, its Artifacts and the pages of its Sources", async () => {
  const { sent, record } = serve();
  const cards = artifact({
    kind: "flashcards",
    title: "Schritte von Prognoseziel bis zur Überwachung",
    topicIds: [ids.hashing, ids.sorting],
  });
  api.route("GET", "/api/me/artifacts", () =>
    Response.json([
      cards,
      artifact({ title: "Nur über Graphen", topicIds: [ids.graphs] }),
    ]),
  );
  api.route(
    "POST",
    `/api/me/topics/${ids.sorting}/self-assessment`,
    record({ status: "ok" }),
  );
  const user = userEvent.setup();
  renderScreen(ids.sorting);

  const sheet = await screen.findByRole("dialog", {
    name: "Sortieralgorithmen",
  });
  const levels = within(sheet).getByRole("radiogroup", { name: "Lernstatus" });
  expect(
    within(levels)
      .getAllByRole("radio")
      .map((radio) => [
        radio.getAttribute("aria-label") ?? radio.textContent,
        (radio as HTMLInputElement).checked,
      ]),
  ).toEqual([
    ["Nicht gelernt", false],
    ["Schwachpunkt", false],
    ["Unsicher", false],
    ["Sicher", true],
  ]);
  const made = await within(sheet).findByRole("list", { name: "Artefakte" });
  expect(
    within(made)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["Schritte von Prognoseziel bis zur ÜberwachungVor 2 Tagen"]);
  expect(
    within(made)
      .getByRole("link", {
        name: "Schritte von Prognoseziel bis zur Überwachung",
      })
      .getAttribute("href"),
  ).toBe(`/artifacts/${cards.id}`);
  expect(
    within(within(sheet).getByRole("list", { name: "Quellen" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["Vorlesung 04.pdfSeite 7"]);

  await user.click(within(levels).getByRole("radio", { name: "Schwachpunkt" }));
  await waitFor(() =>
    expect(sent).toEqual([
      {
        method: "POST",
        path: `/api/me/topics/${ids.sorting}/self-assessment`,
        body: { level: "weak" },
      },
    ]),
  );

  await user.click(within(sheet).getByRole("button", { name: "Schließen" }));
  expect(replace).toHaveBeenCalledWith(`/courses/${courseId}`, {
    scroll: false,
  });
});

test("deletes a Topic only on a second click of its delete button, then closes its details", async () => {
  const { sent, record } = serve();
  api.route(
    "POST",
    `/api/me/review/fact/${ids.graphs}/reject`,
    record({ status: "ok" }),
  );
  const user = userEvent.setup();
  renderScreen(ids.graphs);
  const sheet = await screen.findByRole("dialog", { name: "Graphen" });

  await user.click(
    within(sheet).getByRole("button", { name: "Thema löschen" }),
  );
  const armed = within(sheet).getByRole("button", {
    name: "Wirklich löschen?",
  });
  expect(sent).toEqual([]);
  await user.tab();
  expect(
    within(sheet).getByRole("button", { name: "Thema löschen" }),
  ).toBeTruthy();

  await user.click(
    within(sheet).getByRole("button", { name: "Thema löschen" }),
  );
  await user.click(
    within(sheet).getByRole("button", { name: "Wirklich löschen?" }),
  );

  await waitFor(() =>
    expect(sent).toEqual([
      {
        method: "POST",
        path: `/api/me/review/fact/${ids.graphs}/reject`,
        body: null,
      },
    ]),
  );
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith(`/courses/${courseId}`, {
      scroll: false,
    }),
  );
  expect(armed).toBeTruthy();
});

test("says when a Topic has no Artifacts and no Sources yet", async () => {
  serve(
    page({
      topics: [
        { ...topic(ids.hashing, "Hashing", "not_studied", null), sources: [] },
      ],
    }),
  );
  renderScreen(ids.hashing);
  const sheet = await screen.findByRole("dialog", { name: "Hashing" });

  await within(sheet).findByText("Keine Artefakte");
  expect(
    within(sheet).getByText(
      "Für dieses Thema existieren noch keine Artefakte.",
    ),
  ).toBeTruthy();
  expect(within(sheet).getByText("Keine Quellen")).toBeTruthy();
  expect(
    within(sheet).getByText("Für dieses Thema existieren noch keine Quellen."),
  ).toBeTruthy();
});

const dated = (
  kind: string,
  title: string,
  start: string,
  more: Record<string, unknown> = {},
) => ({
  kind,
  id: crypto.randomUUID(),
  title,
  start,
  end: null,
  allDay: false,
  obligationKind: null,
  unreviewed: false,
  ...more,
});
const dayLabel = (iso: string) => {
  const at = new Date(iso);
  return `${new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short", year: "numeric" }).format(at)} • ${new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(at)}`;
};

test("shows the next five dated items by day, saying what each is and when", async () => {
  const today = new Date().toISOString();
  const soon = new Date(Date.now() + 60_000).toISOString();
  serve(
    page({
      dated: [
        dated("study_block", "Gestern geübt", daysFromNow(-1, 9), {
          end: daysFromNow(-1, 10),
        }),
        dated("study_block", "Bäume wiederholen", today, { end: soon }),
        dated("course_event", "OM Vorlesung", daysFromNow(1, 10), {
          end: daysFromNow(1, 12),
        }),
        dated("obligation", "Klausur", daysFromNow(3, 0), {
          obligationKind: "exam",
          allDay: true,
          unreviewed: true,
        }),
        dated("obligation", "Übungsblatt 3", daysFromNow(3, 23), {
          obligationKind: "assignment",
        }),
        dated("obligation", "Referat", daysFromNow(5, 0), {
          obligationKind: "presentation",
          allDay: true,
        }),
        dated("study_block", "Zu weit weg", daysFromNow(9, 9), {
          end: daysFromNow(9, 10),
        }),
      ],
    }),
  );
  renderScreen();

  const agenda = await screen.findByRole("region", { name: "Termine" });
  const time = (iso: string) =>
    new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  expect(
    within(agenda)
      .getAllByRole("listitem")
      .map((day) => [
        within(day).getByRole("heading").textContent,
        within(day)
          .getAllByRole("term")
          .map(
            (t) => `${t.textContent} | ${t.nextElementSibling?.textContent}`,
          ),
      ]),
  ).toEqual([
    [
      `${dayLabel(today)} • Heute`,
      [`Bäume wiederholen | Lernblock • ${time(today)} - ${time(soon)}`],
    ],
    [
      `${dayLabel(daysFromNow(1))} • Morgen`,
      [
        `OM Vorlesung | Lehrveranstaltung • ${time(daysFromNow(1, 10))} - ${time(daysFromNow(1, 12))}`,
      ],
    ],
    [
      dayLabel(daysFromNow(3)),
      [
        "Klausur | Termin nicht bestätigt",
        `Übungsblatt 3 | Abgabe • ${time(daysFromNow(3, 23))}`,
      ],
    ],
    [dayLabel(daysFromNow(5)), ["Referat | Präsentation • ganztägig"]],
  ]);
});

test("says when nothing dated is coming up", async () => {
  serve(page({ dated: [] }));
  renderScreen();

  const agenda = await screen.findByRole("region", { name: "Termine" });
  expect(within(agenda).getByText("Keine Termine")).toBeTruthy();
});

test("asks about one open Disagreement at a time and uses the value the student picks", async () => {
  const room = {
    kind: "fact",
    id: crypto.randomUUID(),
    key: "exam.room",
    values: [
      {
        value: "B 204",
        extractionId: crypto.randomUUID(),
        sources: ["Vorlesung 04.pdf"],
      },
      {
        value: "C 112",
        extractionId: crypto.randomUUID(),
        sources: ["Modulhandbuch.pdf"],
      },
    ],
  };
  const sheet = {
    kind: "obligation",
    id: crypto.randomUUID(),
    title: "Übungsblatt 3",
    values: [
      {
        due: { date: "2026-11-22", time: null, timeZone: "Europe/Berlin" },
        extractionId: crypto.randomUUID(),
        sources: ["Modulhandbuch.pdf"],
      },
      {
        due: { date: "2026-11-20", time: "12:00", timeZone: "Europe/Berlin" },
        extractionId: crypto.randomUUID(),
        sources: ["Ankündigung.pdf", "Vorlesung 04.pdf"],
      },
    ],
  };
  const { sent, record, change } = serve(
    page({ disagreements: [room, sheet] }),
  );
  api.route("POST", `/api/me/review/fact/${room.id}/use`, async (request) => {
    change(page({ disagreements: [sheet] }));
    return record({ status: "ok" })(request);
  });
  const user = userEvent.setup();
  renderScreen();

  const asked = await screen.findByRole("region", { name: "Abweichungen" });
  expect(within(asked).getByRole("heading").textContent).toBe(
    "Klausurraum: B 204 oder C 112?",
  );
  expect(
    within(asked).getByText(
      "Vorlesung 04.pdf und Modulhandbuch.pdf nennen verschiedene Räume",
    ),
  ).toBeTruthy();
  await user.click(
    within(asked).getByRole("button", { name: "Raum C 112 verwenden" }),
  );

  await waitFor(() =>
    expect(within(asked).getByRole("heading").textContent).toBe(
      "Übungsblatt 3: 22.11. oder 20.11., 12:00 Uhr?",
    ),
  );
  expect(sent).toEqual([
    {
      method: "POST",
      path: `/api/me/review/fact/${room.id}/use`,
      body: { extractionId: room.values[1]!.extractionId },
    },
  ]);
  expect(
    within(asked).getByText(
      "Modulhandbuch.pdf, Ankündigung.pdf und Vorlesung 04.pdf nennen verschiedene Termine",
    ),
  ).toBeTruthy();
  expect(
    within(asked)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Termin 22.11. verwenden", "Termin 20.11., 12:00 Uhr verwenden"]);
});

test("lists the Course's Sources by age and size, and deletes one only once the student confirms", async () => {
  const { sent, record } = serve();
  api.route(
    "DELETE",
    `/api/me/sources/${ids.lecture}`,
    record({ status: "ok" }),
  );
  const user = userEvent.setup();
  renderScreen();

  const listed = await screen.findByRole("list", { name: "Quellen" });
  expect(
    within(listed)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual([
    "Vorlesung 04.pdfVor 3 Tagen • 12 MiB",
    "Einführung Operations Management.pdfVor 4 Wochen • 2 MiB",
  ]);
  await user.click(
    within(listed).getByRole("button", {
      name: "Aktionen für Vorlesung 04.pdf",
    }),
  );
  expect(
    (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
  ).toEqual(["Herunterladen", "Löschen"]);
  await user.click(screen.getByRole("menuitem", { name: "Löschen" }));
  const dialog = await screen.findByRole("dialog", { name: "Quelle löschen?" });
  expect(sent).toEqual([]);
  await user.click(
    within(dialog).getByRole("button", { name: "Endgültig löschen" }),
  );

  await waitFor(() =>
    expect(sent).toEqual([
      { method: "DELETE", path: `/api/me/sources/${ids.lecture}`, body: null },
    ]),
  );
});

test("uploads PDFs into this Course", async () => {
  const { sent, record } = serve();
  api.route("POST", "/api/me/sources", async (request) => {
    await record({})(request);
    return Response.json({
      source: {
        id: "source-new",
        title: "Folien.pdf",
        status: "uploading",
        failure: null,
        extraction: "pending",
        courseId,
      },
      upload: { url: `${api.origin}/upload`, headers: {} },
    });
  });
  api.route("PUT", "/upload", () => new Response(null, { status: 200 }));
  api.route("POST", "/api/me/sources/source-new/complete", () =>
    Response.json({ status: "queued" }),
  );
  api.route("GET", "/api/me/sources", () => Response.json([]));
  api.route("GET", "/api/me/courses", () =>
    Response.json({ current: "2026-ws", choices: ["2026-ws"], courses: [] }),
  );
  const user = userEvent.setup();
  renderScreen();
  await screen.findByRole("list", { name: "Quellen" });

  await user.upload(
    screen.getByLabelText("Hochladen"),
    new File(["%PDF"], "Folien.pdf", { type: "application/pdf" }),
  );

  await waitFor(() =>
    expect(sent).toEqual([
      {
        method: "POST",
        path: "/api/me/sources",
        body: {
          title: "Folien.pdf",
          bytes: 4,
          type: "application/pdf",
          course: { id: courseId },
        },
      },
    ]),
  );
});

test("says when the Course has no Topics or Sources yet, and marks a Course nunio only proposed", async () => {
  const proposed = page({ topics: [], sources: [] });
  serve({
    ...proposed,
    course: { ...(proposed.course as Page), status: "proposed" },
  });
  renderScreen();

  const heading = await screen.findByRole("heading", { level: 1 });
  expect(heading.parentElement?.textContent).toContain("Vorgeschlagen");
  expect(screen.getByText("Keine Themen")).toBeTruthy();
  expect(screen.getByText("Keine Quellen")).toBeTruthy();
  expect(
    within(screen.getByRole("list", { name: "Über den Kurs" })).getByText(
      "0 Quellen",
    ),
  ).toBeTruthy();
});

test("marks an archived Course, and says when a Course is gone", async () => {
  const archived = page();
  serve({
    ...archived,
    course: { ...(archived.course as Page), archived: true },
  });
  const { unmount } = renderScreen();
  const heading = await screen.findByRole("heading", { level: 1 });
  expect(heading.parentElement?.textContent).toContain("Archiviert");
  unmount();

  api.route("GET", `/api/me/courses/${courseId}`, () =>
    Response.json({ error: "gone" }, { status: 404 }),
  );
  renderScreen();
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Diesen Kurs gibt es nicht mehr.",
  );
  expect(
    screen.getByRole("link", { name: "Zu deinen Kursen" }).getAttribute("href"),
  ).toBe("/courses");
});

test("confirms the Course's default email Destination, and removes it", async () => {
  const { sent, record, change } = serve(page({ emailDestination: null }));
  api.route(
    "POST",
    `/api/me/courses/${courseId}/email-destination`,
    async (request) => {
      const { address } = (await request.clone().json()) as {
        address: string | null;
      };
      change(
        page({
          emailDestination: address && {
            address,
            confirmedAt: "2026-11-18T13:20:00.000Z",
          },
        }),
      );
      return record({ status: "ok" })(request);
    },
  );
  renderScreen();

  const destination = await screen.findByRole("group", {
    name: "Abgabe per E-Mail",
  });
  await userEvent.click(
    within(destination).getByRole("button", {
      name: "E-Mail-Adresse eintragen",
    }),
  );
  await userEvent.type(
    within(destination).getByRole("textbox", { name: "E-Mail-Adresse" }),
    "lehrstuhl@uni-beispiel.de",
  );
  await userEvent.click(
    within(destination).getByRole("button", { name: "Bestätigen" }),
  );
  await within(destination).findByText("lehrstuhl@uni-beispiel.de");
  expect(within(destination).getByText("Bestätigt am 18. Nov.")).toBeTruthy();

  await userEvent.click(
    within(destination).getByRole("button", { name: "Entfernen" }),
  );
  await within(destination).findByRole("button", {
    name: "E-Mail-Adresse eintragen",
  });
  const path = `/api/me/courses/${courseId}/email-destination`;
  expect(sent).toEqual([
    { method: "POST", path, body: { address: "lehrstuhl@uni-beispiel.de" } },
    { method: "POST", path, body: { address: null } },
  ]);
});
