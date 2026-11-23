import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { StudyScreen } from "@/features/study/study-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

const analysisId = "c0000000-0000-4000-8000-000000000001";
const algebraId = "c0000000-0000-4000-8000-000000000002";
const konvergenz = "70000000-0000-4000-8000-000000000001";
const stetigkeit = "70000000-0000-4000-8000-000000000002";
const reihen = "70000000-0000-4000-8000-000000000003";
const integrale = "70000000-0000-4000-8000-000000000004";
const matrizen = "70000000-0000-4000-8000-000000000005";
const sheetId = "0b000000-0000-4000-8000-000000000001";
const talkId = "0b000000-0000-4000-8000-000000000002";
const doneId = "0b000000-0000-4000-8000-000000000003";
const examId = "0b000000-0000-4000-8000-000000000004";
const artifactId = "a0000000-0000-4000-8000-000000000001";

const provenance = {
  kind: "source",
  sourceId: "s1",
  title: "Skript",
  page: 2,
  quote: "Gleichmäßige Konvergenz",
};
const topic = (id: string, value: string) => ({
  id,
  type: "topic",
  value,
  state: "unreviewed",
  uncertainty: null,
  provenance,
  disagreement: false,
  unsupported: null,
  values: [],
});
const obligation = (
  id: string,
  kind: string,
  title: string,
  date: string,
  reportedSubmittedAt: string | null = null,
) => ({
  id,
  kind,
  title,
  state: "confirmed",
  reportedSubmittedAt,
  due: { date, time: null, timeZone: null, text: null },
  destination: "Moodle",
  uncertainty: null,
  provenance,
  disagreement: false,
  unsupported: null,
  values: [],
});
/** Two Courses as review shows them: Analysis I with four Topics and its Obligations, Lineare Algebra with one Topic. */
const review = {
  courses: [
    {
      id: analysisId,
      code: "MA-101",
      title: "Analysis I",
      status: "accepted",
      obligations: [
        obligation(sheetId, "assignment", "Blatt 3", "2099-11-20"),
        obligation(talkId, "presentation", "Vortrag Reihen", "2099-12-11"),
        obligation(
          doneId,
          "assignment",
          "Blatt 2",
          "2026-11-13",
          "2026-11-12T18:00:00.000Z",
        ),
        obligation(examId, "exam", "Klausur", "2099-02-10"),
      ],
      facts: [
        topic(reihen, "Reihen"),
        topic(integrale, "Integrale"),
        topic(stetigkeit, "Stetigkeit"),
        topic(konvergenz, "Gleichmäßige Konvergenz"),
      ],
    },
    {
      id: algebraId,
      code: null,
      title: "Lineare Algebra",
      status: "accepted",
      obligations: [],
      facts: [topic(matrizen, "Matrizen")],
    },
  ],
};
const level = (topicId: string, name: string) => ({
  topicId,
  level: name,
  latestAttempt: null,
  lastEvidenceAt: null,
});
const courseSummary = (id: string, title: string, color: string) => ({
  id,
  code: null,
  title,
  status: "accepted",
  semester: "2026-ws",
  color,
  entered: true,
  archived: false,
  next: null,
  lastActivityAt: null,
});
const ruleOf = (status: string) =>
  status === "unknown"
    ? { status, reason: "none" }
    : { status, level: "course", text: null, provenance: { kind: "entry" } };

/** Serves the study screen's data and records what the student sends. */
function serveStudy(course?: string) {
  const sent: { path: string; body: unknown }[] = [];
  api.route("GET", "/api/me/review", () => Response.json(review));
  api.route("GET", "/api/me/courses", () =>
    Response.json({
      current: "2026-ws",
      choices: ["2026-ws"],
      courses: [
        courseSummary(analysisId, "Analysis I", "rose"),
        courseSummary(algebraId, "Lineare Algebra", "blue"),
      ],
    }),
  );
  api.route("GET", `/api/me/courses/${analysisId}/levels`, () =>
    Response.json([
      level(reihen, "solid"),
      level(integrale, "not_studied"),
      level(stetigkeit, "shaky"),
      level(konvergenz, "weak"),
    ]),
  );
  api.route("GET", `/api/me/courses/${algebraId}/levels`, () =>
    Response.json([level(matrizen, "weak")]),
  );
  api.route("GET", `/api/me/courses/${analysisId}/artifact-options`, () =>
    Response.json({
      topics: [],
      obligations: [
        {
          id: sheetId,
          title: "Blatt 3",
          kind: "assignment",
          due: { date: "2099-11-20", time: null, timeZone: null },
          aiUse: ruleOf("conditional"),
        },
        {
          id: talkId,
          title: "Vortrag Reihen",
          kind: "presentation",
          due: { date: "2099-12-11", time: null, timeZone: null },
          aiUse: ruleOf("unknown"),
        },
      ],
    }),
  );
  api.route("GET", `/api/me/courses/${algebraId}/artifact-options`, () =>
    Response.json({ topics: [], obligations: [] }),
  );
  api.route("GET", "/api/me/artifacts", () =>
    Response.json([
      {
        id: "a0000000-0000-4000-8000-000000000009",
        kind: "draft",
        status: "ready",
        failure: null,
        topicIds: [],
        obligationId: sheetId,
        createdAt: "2026-11-10T09:00:00.000Z",
        openedAt: null,
        withdrawn: false,
        title: "Blatt 3",
        courseId: analysisId,
        count: null,
        version: 2,
        updatedAt: "2026-11-11T09:00:00.000Z",
        lastPractisedAt: null,
        shaky: false,
      },
    ]),
  );
  const record =
    (status: number, reply: unknown) => async (request: Request) => {
      sent.push({
        path: new URL(request.url).pathname,
        body: await request.json(),
      });
      return Response.json(reply, { status });
    };
  api.route(
    "POST",
    "/api/me/artifacts",
    record(202, { artifactId, runId: "r1" }),
  );
  api.route(
    "POST",
    `/api/me/topics/${integrale}/self-assessment`,
    record(200, { status: "ok" }),
  );
  render(
    <TestProviders>
      <SidebarProvider>
        <StudyScreen apiOrigin={api.origin} course={course} />
      </SidebarProvider>
    </TestProviders>,
  );
  return sent;
}

/** The Topics a list shows, in order. */
const titles = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label"));

test("shows a tab per Course and the selected Course's weak, then shaky, then unstudied Topics to practise next", async () => {
  serveStudy();
  const tabs = await screen.findByRole("tablist", { name: "Kurse" });
  expect(
    within(tabs)
      .getAllByRole("tab")
      .map((tab) => tab.textContent),
  ).toEqual(["Analysis I4", "Lineare Algebra1"]);
  expect(
    within(tabs).getByRole("tab", { selected: true }).textContent,
  ).toContain("Analysis I");

  const next = await screen.findByRole("region", { name: "Als Nächstes üben" });
  await within(next).findByText("Schwach");
  expect(titles(next)).toEqual([
    "Gleichmäßige Konvergenz",
    "Stetigkeit",
    "Integrale",
  ]);
  expect(
    within(next).getByRole("listitem", { name: "Gleichmäßige Konvergenz" })
      .textContent,
  ).toContain("Klausur in ");

  await userEvent.click(within(tabs).getByRole("tab", { name: /Lineare/ }));
  const algebra = await screen.findByRole("region", {
    name: "Als Nächstes üben",
  });
  await within(algebra).findByRole("listitem", { name: "Matrizen" });
});

test("opens the Course named in the address", async () => {
  serveStudy(algebraId);
  const tabs = await screen.findByRole("tablist", { name: "Kurse" });
  expect(
    within(tabs).getByRole("tab", { selected: true }).textContent,
  ).toContain("Lineare Algebra");
});

test("starts a practice set on a Topic to practise next, and links to it", async () => {
  const sent = serveStudy();
  const next = await screen.findByRole("region", { name: "Als Nächstes üben" });
  const row = await within(next).findByRole("listitem", {
    name: "Gleichmäßige Konvergenz",
  });
  await userEvent.click(within(row).getByRole("button", { name: "Üben" }));

  await within(row).findByText("Übungsset wird erstellt");
  expect(
    within(row).getByRole("link", { name: "Öffnen" }).getAttribute("href"),
  ).toBe(`/artifacts/${artifactId}`);
  expect(sent).toEqual([
    {
      path: "/api/me/artifacts",
      body: {
        kind: "practice_set",
        topicIds: [konvergenz],
        from: { selection: { courseIds: [analysisId], sourceIds: [] } },
      },
    },
  ]);
});

test("asks for flashcards on a Topic to practise next", async () => {
  const sent = serveStudy();
  const next = await screen.findByRole("region", { name: "Als Nächstes üben" });
  const row = await within(next).findByRole("listitem", { name: "Stetigkeit" });
  await userEvent.click(
    within(row).getByRole("button", { name: "Karteikarten" }),
  );

  await within(row).findByText("Karteikarten werden erstellt");
  expect(sent.map(({ body }) => body)).toEqual([
    {
      kind: "flashcards",
      topicIds: [stetigkeit],
      from: { selection: { courseIds: [analysisId], sourceIds: [] } },
    },
  ]);
});

test("filters all Topics by Level and shows how the Levels are spread", async () => {
  serveStudy();
  const all = await screen.findByRole("region", { name: "Alle Themen" });
  await within(all).findByText("Sicher", { selector: "span" });
  expect(titles(within(all).getByRole("list"))).toEqual([
    "Reihen",
    "Integrale",
    "Stetigkeit",
    "Gleichmäßige Konvergenz",
  ]);

  const filterGroup = within(all).getByRole("group", {
    name: "Nach Verständnis filtern",
  });
  await userEvent.click(
    within(filterGroup).getByRole("button", { name: /^Schwach/ }),
  );
  expect(titles(within(all).getByRole("list"))).toEqual([
    "Gleichmäßige Konvergenz",
  ]);

  const spread = screen.getByRole("region", { name: "Verständnis" });
  expect(within(spread).getByText("4 Themen")).toBeTruthy();
  expect(
    within(spread)
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toEqual(["Sicher1", "Unsicher1", "Schwach1", "Noch nicht gelernt1"]);
});

test("records the student's own Self-assessment inline", async () => {
  const sent = serveStudy();
  const all = await screen.findByRole("region", { name: "Alle Themen" });
  const row = await within(all).findByRole("listitem", { name: "Integrale" });
  await userEvent.click(
    await within(row).findByRole("button", {
      name: "Noch nicht gelernt: selbst einschätzen",
    }),
  );
  await within(row).findByText("Wie sitzt das Thema jetzt?");
  await userEvent.click(within(row).getByRole("button", { name: "Sitzt" }));

  await within(row).findByText("Notiert.");
  expect(sent).toEqual([
    {
      path: `/api/me/topics/${integrale}/self-assessment`,
      body: { level: "solid" },
    },
  ]);
});

test("lists the Course's Abgaben with their state, each opening its own page", async () => {
  serveStudy();
  const list = await screen.findByRole("region", { name: "Abgaben" });
  expect(within(list).getByText("3 in diesem Kurs")).toBeTruthy();
  const sheet = within(list).getByRole("link", { name: /Blatt 3/ });
  expect(sheet.getAttribute("href")).toBe(`/study/obligations/${sheetId}`);
  await within(sheet).findByText("Entwurf v2 bereit");
  await within(sheet).findByText("KI mit Bedingungen");
  const talk = within(list).getByRole("link", { name: /Vortrag Reihen/ });
  await within(talk).findByText("KI-Regel unklar");
  const done = within(list).getByRole("link", { name: /Blatt 2/ });
  expect(within(done).getByText("Als abgegeben gemeldet")).toBeTruthy();
  expect(within(list).queryByRole("link", { name: /Klausur/ })).toBeNull();
});
