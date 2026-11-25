import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ReviewList } from "@/app/(app)/review/review-list";
import { api } from "./api";

const renderReview = () =>
  render(
    <SidebarProvider>
      <ReviewList apiOrigin={api.origin} />
    </SidebarProvider>,
  );

const course = (id: string, title: string, status: string) => ({
  id,
  code: null as string | null,
  title,
  status,
  archived: false,
  obligations: [] as unknown[],
  facts: [] as unknown[],
});
const citation = (extractionId: string, quote: string, page: number) => ({
  extractionId,
  sourceId: `source-${extractionId}`,
  title: "Syllabus ADS.pdf",
  page,
  quote,
  grounding: "text",
});
const due = (date: string | null, time: string | null = null) => ({
  date,
  time,
  timeZone: time ? "Europe/Berlin" : null,
  text: null,
});
const obligation = (
  id: string,
  title: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  state: "unreviewed",
  uncertainty: null,
  provenance: {
    kind: "source",
    sourceId: "source-1",
    title: "Syllabus ADS.pdf",
    page: 3,
    quote: "",
  },
  disagreement: false,
  unsupported: null,
  kind: "exam",
  reportedSubmittedAt: null,
  title,
  due: due("2027-02-12", "09:00"),
  destination: null,
  values: [
    {
      due: due("2027-02-12", "09:00"),
      overruled: false,
      citations: [citation(`${id}-x`, "Die Endklausur findet statt.", 3)],
    },
  ],
  ...overrides,
});
const fact = (
  id: string,
  value: string,
  overrides: Record<string, unknown> = {},
) => ({
  id,
  state: "unreviewed",
  uncertainty: null,
  provenance: {
    kind: "source",
    sourceId: "source-1",
    title: "Syllabus ADS.pdf",
    page: 4,
    quote: "",
  },
  disagreement: false,
  unsupported: null,
  type: "topic",
  key: value.toLowerCase(),
  value,
  values: [
    {
      value,
      overruled: false,
      citations: [citation(`${id}-f`, `Woche 7: ${value}`, 4)],
    },
  ],
  ...overrides,
});

const analysis = course("course-1", "Analysis I", "accepted");
const similar = course("course-2", "Analysis 1", "proposed");
let courses: ReturnType<typeof course>[] = [];
let suggestions: unknown[] = [];
let series: unknown[] = [];

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  courses = [similar, analysis];
  suggestions = [{ courseId: similar.id, intoId: analysis.id }];
  series = [];
  api.route("GET", "/api/me/review", () => Response.json({ courses }));
  api.route("GET", "/api/me/courses/merge-suggestions", () =>
    Response.json(suggestions),
  );
  api.route("GET", "/api/me/plan", () =>
    Response.json({ eventSeries: series, fixedEvents: [], calendars: [] }),
  );
  api.route("GET", "/api/me/courses", () =>
    Response.json({ current: "2026-ws", choices: [], courses: [] }),
  );
});

const suggestion = async () => {
  await userEvent.click(
    await screen.findByRole("button", { name: /^Analysis 1/ }),
  );
  return within(
    await screen.findByRole("article", { name: "Analysis 1" }),
  ).findByText("Ähnlich zu „Analysis I“ – zusammenführen?");
};

test("Prüfen lists each Course with its open entries and shows the chosen one", async () => {
  courses = [
    {
      ...analysis,
      obligations: [
        obligation("exam", "Endklausur"),
        obligation("sheet", "Übungsblatt 4", {
          state: "confirmed",
          kind: "assignment",
          values: [
            {
              due: due("2026-12-04", "23:59"),
              overruled: false,
              citations: [
                {
                  ...citation("sheet-x", "Abgabe des vierten Übungsblatts.", 1),
                  title: "Übungsblatt 4.pdf",
                },
              ],
            },
          ],
        }),
      ],
    },
    similar,
  ];
  renderReview();

  expect(
    await screen.findByRole("heading", { level: 1, name: "Prüfen" }),
  ).toBeTruthy();
  const rail = await screen.findByRole("navigation", { name: "Kurse" });
  expect(
    within(rail).getByRole("button", { name: "Analysis I – 1 offen" }),
  ).toHaveProperty("ariaCurrent", "true");
  const shown = screen.getByRole("article", { name: "Analysis I" });
  expect(within(shown).getByText("Endklausur")).toBeTruthy();
  expect(
    within(shown).getByText("„Die Endklausur findet statt.“"),
  ).toBeTruthy();
  expect(within(shown).getByText("Syllabus ADS.pdf, Seite 3")).toBeTruthy();
  expect(within(shown).getByText("Bestätigt")).toBeTruthy();

  await userEvent.click(
    within(rail).getByRole("button", { name: /^Analysis 1/ }),
  );
  expect(
    await screen.findByRole("article", { name: "Analysis 1" }),
  ).toBeTruthy();
  expect(screen.queryByRole("article", { name: "Analysis I" })).toBeNull();
});

test("confirming an entry sends the decision", async () => {
  let confirmed = false;
  courses = [{ ...analysis, obligations: [obligation("exam", "Endklausur")] }];
  api.route("POST", "/api/me/review/obligation/exam/confirm", () => {
    confirmed = true;
    return Response.json({ status: "ok" });
  });
  renderReview();

  await userEvent.click(
    await screen.findByRole("button", { name: "Bestätigen" }),
  );

  await waitFor(() => expect(confirmed).toBe(true));
});

test("a Disagreement shows each value with its quote and uses the one chosen", async () => {
  let used: unknown;
  courses = [
    {
      ...analysis,
      obligations: [
        obligation("signup", "Anmeldung zur Klausur", {
          kind: "registration",
          disagreement: true,
          due: due(null),
          values: [
            {
              due: due("2027-01-15"),
              overruled: false,
              citations: [citation("q1", "Bis zum 15. Januar.", 2)],
            },
            {
              due: due("2027-01-22"),
              overruled: false,
              citations: [citation("q2", "Verlängert bis zum 22.01.", 5)],
            },
          ],
        }),
      ],
    },
  ];
  api.route("POST", "/api/me/review/obligation/signup/use", async (request) => {
    used = await request.json();
    return Response.json({ status: "ok" });
  });
  renderReview();

  const choices = await screen.findByRole("group", { name: "Widerspruch" });
  expect(within(choices).getByText("„Bis zum 15. Januar.“")).toBeTruthy();
  const second = within(choices)
    .getByText("„Verlängert bis zum 22.01.“")
    .closest("li")!;
  // A Disagreement is decided by choosing a value, not by confirming.
  expect(screen.queryByRole("button", { name: "Bestätigen" })).toBeNull();

  await userEvent.click(
    within(second).getByRole("button", { name: "Diesen übernehmen" }),
  );

  await waitFor(() => expect(used).toEqual({ extractionId: "q2" }));
});

test("a corrected Fact with a new Disagreement allows keeping the Correction", async () => {
  let kept = false;
  courses = [
    {
      ...analysis,
      facts: [
        fact("rule-1", "Erlaubt mit Hinweis", {
          type: "ai_use_rule",
          state: "confirmed",
          provenance: { kind: "correction" },
          disagreement: true,
          values: [
            {
              value: "Keine KI erlaubt",
              overruled: false,
              citations: [citation("r1", "KI ist untersagt.", 2)],
            },
          ],
        }),
      ],
    },
  ];
  api.route("POST", "/api/me/review/fact/rule-1/keep_mine", () => {
    kept = true;
    return Response.json({ status: "ok" });
  });
  renderReview();

  const choices = await screen.findByRole("group", { name: "Widerspruch" });
  expect(within(choices).getByText("„KI ist untersagt.“")).toBeTruthy();

  await userEvent.click(
    within(choices).getByRole("button", { name: "Meine behalten" }),
  );

  await waitFor(() => expect(kept).toBe(true));
});

test("correcting an Obligation submits the updated values and Abbrechen closes without saving", async () => {
  let corrected: unknown = null;
  courses = [
    {
      ...analysis,
      obligations: [
        obligation("sheet", "Übungsblatt 4", { kind: "assignment" }),
      ],
    },
  ];
  api.route(
    "POST",
    "/api/me/review/obligation/sheet/correct",
    async (request) => {
      corrected = await request.json();
      return Response.json({ status: "ok" });
    },
  );
  const user = userEvent.setup();
  renderReview();

  await user.click(await screen.findByRole("button", { name: "Korrigieren" }));
  const form = screen.getByRole("form", { name: "Korrigieren" });
  await user.click(within(form).getByRole("button", { name: "Abbrechen" }));
  expect(corrected).toBeNull();
  expect(screen.queryByRole("form", { name: "Korrigieren" })).toBeNull();

  await user.click(screen.getByRole("button", { name: "Korrigieren" }));
  const reopened = screen.getByRole("form", { name: "Korrigieren" });
  const title = within(reopened).getByLabelText("Titel");
  await user.clear(title);
  await user.type(title, "Übungsblatt 4 (neu)");
  await user.click(
    within(reopened).getByRole("button", { name: "Korrektur speichern" }),
  );

  await waitFor(() =>
    expect(corrected).toEqual({
      title: "Übungsblatt 4 (neu)",
      due: { date: "2027-02-12", time: "09:00", timeZone: "Europe/Berlin" },
      destination: null,
    }),
  );
});

test("rejected entries fold into Abgelehnt (n) and can be restored", async () => {
  let restored = false;
  courses = [
    {
      ...analysis,
      facts: [
        fact("topic-1", "Lineare Algebra", { state: "rejected" }),
        fact("topic-2", "Kürzeste Wege"),
      ],
    },
  ];
  api.route("POST", "/api/me/review/fact/topic-1/restore", () => {
    restored = true;
    return Response.json({ status: "ok" });
  });
  const user = userEvent.setup();
  renderReview();

  expect(await screen.findByText("Kürzeste Wege")).toBeTruthy();
  expect(screen.queryByText(/Lineare Algebra/)).toBeNull();

  await user.click(screen.getByRole("button", { name: /Abgelehnt \(1\)/ }));
  expect(await screen.findByText("Thema: Lineare Algebra")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Wiederherstellen" }));
  await waitFor(() => expect(restored).toBe(true));
});

test("a proposed Course shows its decision card, preview entries, and accept/reject actions", async () => {
  const decisions: unknown[] = [];
  courses = [
    {
      ...similar,
      obligations: [obligation("or-exam", "Klausur Operations Research")],
      facts: [fact("or-topic", "Simplex-Verfahren")],
    },
  ];
  suggestions = [];
  api.route(
    "POST",
    `/api/me/courses/${similar.id}/decision`,
    async (request) => {
      decisions.push(await request.json());
      return Response.json({ status: "ok" });
    },
  );
  const user = userEvent.setup();
  renderReview();

  expect(await screen.findByText("Ist das einer deiner Kurse?")).toBeTruthy();
  expect(screen.getByText(/Klausur Operations Research/)).toBeTruthy();
  expect(screen.getByText("Simplex-Verfahren")).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Ja, übernehmen" }));
  await waitFor(() => expect(decisions).toEqual([{ decision: "accept" }]));
});

test("rejected Courses fold in the rail and can be restored", async () => {
  let restored = false;
  const dropped = course("course-3", "BWL I", "rejected");
  courses = [analysis, dropped];
  suggestions = [];
  api.route(
    "POST",
    `/api/me/courses/${dropped.id}/decision`,
    async (request) => {
      expect(await request.json()).toEqual({ decision: "restore" });
      restored = true;
      return Response.json({ status: "ok" });
    },
  );
  const user = userEvent.setup();
  renderReview();

  const rail = await screen.findByRole("navigation", { name: "Kurse" });
  await user.click(
    within(rail).getByRole("button", { name: "Abgelehnte Kurse (1)" }),
  );
  expect(within(rail).getByText("BWL I")).toBeTruthy();
  await user.click(
    within(rail).getByRole("button", { name: "Wiederherstellen" }),
  );
  await waitFor(() => expect(restored).toBe(true));
});

test("Prüfen invites a first Source while there is nothing to check", async () => {
  courses = [];
  suggestions = [];
  renderReview();

  expect(await screen.findByText("Noch nichts zu prüfen")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Quelle hochladen" }).getAttribute("href"),
  ).toBe("/");
  await userEvent.click(
    screen.getByRole("button", { name: "Frist selbst eintragen" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Frist hinzufügen" }),
  ).toBeTruthy();
});

test("open calendar series get their own place in the rail", async () => {
  series = [
    {
      id: "s-om",
      calendarId: "cal-1",
      title: "OM Vorlesung",
      courseId: null,
      state: "undecided",
      routine: null,
    },
  ];
  renderReview();

  await userEvent.click(
    await screen.findByRole("button", { name: "Kalender-Serien – 1 offen" }),
  );

  expect(
    await screen.findByRole("group", { name: "OM Vorlesung" }),
  ).toBeTruthy();
});

test("Review suggests merging a Course into one it looks like, and merges it on request", async () => {
  let merged: unknown;
  api.route("POST", `/api/me/courses/${similar.id}/merge`, async (request) => {
    merged = await request.json();
    suggestions = [];
    return Response.json({ status: "ok" });
  });
  renderReview();
  await suggestion();

  await userEvent.click(screen.getByRole("button", { name: "Zusammenführen" }));

  await waitFor(() => expect(merged).toEqual({ into: analysis.id }));
  await waitFor(() =>
    expect(
      screen.queryByText("Ähnlich zu „Analysis I“ – zusammenführen?"),
    ).toBeNull(),
  );
});

test("Nein, verschieden keeps two Courses apart for good", async () => {
  let keptApart: unknown;
  api.route(
    "POST",
    `/api/me/courses/${similar.id}/keep-apart`,
    async (request) => {
      keptApart = await request.json();
      suggestions = [];
      return Response.json({ status: "ok" });
    },
  );
  renderReview();
  await suggestion();

  await userEvent.click(
    screen.getByRole("button", { name: "Nein, verschieden" }),
  );

  await waitFor(() => expect(keptApart).toEqual({ other: analysis.id }));
  await waitFor(() =>
    expect(
      screen.queryByText("Ähnlich zu „Analysis I“ – zusammenführen?"),
    ).toBeNull(),
  );
});

test("merging shows conflicting Corrections inline when the server returns 409", async () => {
  courses = [
    {
      ...analysis,
      obligations: [obligation("exam-1", "Endklausur")],
    },
    {
      ...similar,
      status: "accepted",
      obligations: [obligation("exam-2", "Endklausur")],
    },
  ];
  suggestions = [];
  api.route("POST", `/api/me/courses/${analysis.id}/merge`, () =>
    Response.json(
      { items: [{ kind: "obligation", id: "exam-2" }] },
      { status: 409 },
    ),
  );
  const user = userEvent.setup();
  renderReview();

  const article = await screen.findByRole("article", { name: "Analysis I" });
  await user.click(
    within(article).getByRole("button", {
      name: "Kursaktionen für Analysis I",
    }),
  );
  await user.click(
    await screen.findByRole("menuitem", { name: "Gleicher Kurs wie …" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Kurs zusammenführen",
  });
  await user.click(
    within(dialog).getByRole("combobox", { name: "Gleicher Kurs wie" }),
  );
  await user.click(await screen.findByRole("option", { name: "Analysis 1" }));
  await user.click(
    within(dialog).getByRole("button", { name: "Zusammenführen" }),
  );

  expect(await within(dialog).findByRole("alert")).toHaveProperty(
    "textContent",
    "Beide Kurse haben unterschiedliche Korrekturen für Klausur: Endklausur. Gleiche sie an oder übernimm einen Wert und führe dann erneut zusammen.",
  );
});
