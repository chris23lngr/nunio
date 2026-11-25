import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ObligationScreen } from "@/features/study/obligation-screen";
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
const sheetId = "0b000000-0000-4000-8000-000000000001";
const talkId = "0b000000-0000-4000-8000-000000000002";
const forbiddenId = "0b000000-0000-4000-8000-000000000003";
const draft1Id = "a0000000-0000-4000-8000-000000000001";
const draft2Id = "a0000000-0000-4000-8000-000000000002";
const newDraftId = "a0000000-0000-4000-8000-000000000003";
const critiqueId = "a0000000-0000-4000-8000-000000000004";

const provenance = {
  kind: "source",
  sourceId: "s1",
  title: "Syllabus ADS",
  page: 4,
  quote: "Abgaben",
};

function serveContext() {
  api.route("GET", "/api/me/review", () =>
    Response.json({
      courses: [
        {
          id: analysisId,
          code: "CS-201",
          title: "Algorithms and Data Structures",
          status: "accepted",
          obligations: [
            {
              id: sheetId,
              kind: "assignment",
              title: "Programmierprojekt: Kürzeste Wege",
              state: "confirmed",
              reportedSubmittedAt: null,
              due: {
                date: "2099-12-04",
                time: "23:59",
                timeZone: null,
                text: null,
              },
              destination: "Moodle · Abgabeordner „Projekt 2“",
              uncertainty: null,
              provenance,
              disagreement: false,
              unsupported: null,
              values: [],
            },
            {
              id: talkId,
              kind: "presentation",
              title: "Präsentation: Hashing-Verfahren",
              state: "confirmed",
              reportedSubmittedAt: null,
              due: {
                date: "2099-12-11",
                time: "10:15",
                timeZone: null,
                text: null,
              },
              destination: null,
              uncertainty: null,
              provenance,
              disagreement: false,
              unsupported: null,
              values: [],
            },
            {
              id: forbiddenId,
              kind: "assignment",
              title: "Übungsblatt 7: Beweise",
              state: "confirmed",
              reportedSubmittedAt: null,
              due: {
                date: "2099-12-18",
                time: null,
                timeZone: null,
                text: null,
              },
              destination: "Moodle",
              uncertainty: null,
              provenance,
              disagreement: false,
              unsupported: null,
              values: [],
            },
          ],
          facts: [],
        },
      ],
    }),
  );
  api.route("GET", "/api/me/courses", () =>
    Response.json({
      current: "2026-ws",
      choices: ["2026-ws"],
      courses: [
        {
          id: analysisId,
          code: "CS-201",
          title: "Algorithms and Data Structures",
          status: "accepted",
          semester: "2026-ws",
          color: "rose",
          entered: true,
          archived: false,
          next: null,
          lastActivityAt: null,
        },
      ],
    }),
  );
}

function renderObligation(id: string) {
  render(
    <TestProviders>
      <SidebarProvider>
        <ObligationScreen apiOrigin={api.origin} id={id} />
      </SidebarProvider>
    </TestProviders>,
  );
}

test("shows conditional AI-use rule, drafts, critique and handoff; confirms conditions before drafting and critiquing", async () => {
  serveContext();
  const sent: { path: string; body: unknown }[] = [];
  api.route("GET", `/api/me/obligations/${sheetId}/handoff`, () =>
    Response.json({
      obligation: {
        id: sheetId,
        title: "Programmierprojekt: Kürzeste Wege",
        due: { date: "2099-12-04", time: "23:59", timeZone: null },
        destination: "Moodle · Abgabeordner „Projekt 2“",
        reportedSubmittedAt: null,
      },
      rule: {
        status: "conditional",
        level: "course",
        text: "Code selbst schreiben und jede KI-Nutzung im README dokumentieren.",
        provenance: {
          kind: "source",
          sourceId: "s1",
          title: "Syllabus ADS",
          page: 4,
        },
      },
      drafts: [
        {
          id: draft2Id,
          version: 2,
          createdAt: "2026-11-20T12:00:00.000Z",
        },
        {
          id: draft1Id,
          version: 1,
          createdAt: "2026-11-17T10:00:00.000Z",
        },
      ],
    }),
  );
  api.route("POST", "/api/me/artifacts", async (request) => {
    const body = (await request.json()) as {
      kind: string;
      conditionsConfirmed?: boolean;
    };
    sent.push({ path: "/api/me/artifacts", body });
    if (!body.conditionsConfirmed) {
      return Response.json({ error: "ai_use_conditions" }, { status: 409 });
    }
    return Response.json(
      {
        artifactId: body.kind === "critique" ? critiqueId : newDraftId,
        runId: "r1",
      },
      { status: 202 },
    );
  });

  renderObligation(sheetId);

  expect(
    await screen.findByRole("heading", {
      level: 1,
      name: "Programmierprojekt: Kürzeste Wege",
    }),
  ).toBeTruthy();
  expect(await screen.findByText("Hausarbeit")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Zurück zu Lernen" }).getAttribute("href"),
  ).toBe(`/study?course=${analysisId}`);
  expect(screen.getByText("KI mit Bedingungen erlaubt")).toBeTruthy();
  expect(
    screen.getByText("Syllabus ADS, Seite 4 · gilt für den ganzen Kurs"),
  ).toBeTruthy();

  const draftsList = screen.getByRole("list", { name: "Entwürfe" });
  expect(within(draftsList).getByText("Entwurf, Version 2")).toBeTruthy();
  expect(
    within(draftsList)
      .getAllByRole("link", { name: "Öffnen" })
      .map((a) => a.getAttribute("href")),
  ).toEqual([`/artifacts/${draft2Id}`, `/artifacts/${draft1Id}`]);

  const handoff = screen.getByRole("region", { name: "Abgabe vorbereiten" });
  expect(
    within(handoff).getByText("Moodle · Abgabeordner „Projekt 2“"),
  ).toBeTruthy();
  expect(
    within(handoff).getByText(
      "Laut deiner Quelle; nunio hat das nicht geprüft.",
    ),
  ).toBeTruthy();
  expect(within(handoff).getByText("Denk an die KI-Bedingungen")).toBeTruthy();
  expect(
    within(handoff)
      .getByRole("link", { name: "Entwurf, Version 2" })
      .getAttribute("href"),
  ).toBe(`/artifacts/${draft2Id}`);

  // Trying to draft before confirming triggers 409 ai_use_conditions, then confirming retries.
  await userEvent.type(
    screen.getByLabelText("Anweisungen für einen Entwurf"),
    "Gliederung fürs README",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Entwurf erstellen" }),
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Ich halte mich an diese Bedingungen",
    }),
  );

  await screen.findByText("Entwurf wird erstellt");
  expect(
    screen.getByRole("link", { name: "Entwurf öffnen" }).getAttribute("href"),
  ).toBe(`/artifacts/${newDraftId}`);
  expect(
    screen.getByText("Du hast zugesagt, dich an diese Bedingungen zu halten."),
  ).toBeTruthy();

  // Subsequent critique uses the confirmed condition immediately.
  await userEvent.type(
    screen.getByLabelText("Deine eigene Arbeit"),
    "Dijkstra ist schneller ohne negative Kanten.",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Kritik anfordern" }),
  );
  await screen.findByText("Kritik wird erstellt");
  expect(
    screen.getByRole("link", { name: "Kritik öffnen" }).getAttribute("href"),
  ).toBe(`/artifacts/${critiqueId}`);

  expect(sent).toEqual([
    {
      path: "/api/me/artifacts",
      body: {
        kind: "draft",
        obligationId: sheetId,
        instructions: "Gliederung fürs README",
        from: { selection: { courseIds: [analysisId], sourceIds: [] } },
      },
    },
    {
      path: "/api/me/artifacts",
      body: {
        kind: "draft",
        obligationId: sheetId,
        instructions: "Gliederung fürs README",
        from: { selection: { courseIds: [analysisId], sourceIds: [] } },
        conditionsConfirmed: true,
      },
    },
    {
      path: "/api/me/artifacts",
      body: {
        kind: "critique",
        obligationId: sheetId,
        of: { ownWork: "Dijkstra ist schneller ohne negative Kanten." },
        from: { selection: { courseIds: [analysisId], sourceIds: [] } },
        conditionsConfirmed: true,
      },
    },
  ]);
});

test("reports the Abgabe as submitted through Handoff and takes it back", async () => {
  serveContext();
  let reportedAt: string | null = null;
  const reported: boolean[] = [];
  api.route("GET", `/api/me/obligations/${sheetId}/handoff`, () =>
    Response.json({
      obligation: {
        id: sheetId,
        title: "Programmierprojekt: Kürzeste Wege",
        due: { date: "2099-12-04", time: "23:59", timeZone: null },
        destination: "Moodle",
        reportedSubmittedAt: reportedAt,
      },
      rule: {
        status: "allowed",
        level: "course",
        text: null,
        provenance: { kind: "entry" },
      },
      drafts: [],
    }),
  );
  api.route(
    "POST",
    `/api/me/obligations/${sheetId}/reported-submitted`,
    async (request) => {
      const body = (await request.json()) as { reported: boolean };
      reported.push(body.reported);
      reportedAt = body.reported ? "2026-11-18T13:20:00.000Z" : null;
      return Response.json({ status: "ok" });
    },
  );

  renderObligation(sheetId);

  await userEvent.click(
    await screen.findByRole("button", { name: "Ich habe abgegeben" }),
  );
  await screen.findByText(/als abgegeben gemeldet/);
  await userEvent.click(screen.getByRole("button", { name: "Zurücknehmen" }));
  await screen.findByRole("button", { name: "Ich habe abgegeben" });
  expect(reported).toEqual([true, false]);
});

test("asks the AI-use Rule question when unknown, disables AI sections until answered, and shows empty handoff copy", async () => {
  serveContext();
  let rule: Record<string, unknown> = { status: "unknown", reason: "none" };
  const answers: unknown[] = [];
  api.route("GET", `/api/me/obligations/${talkId}/handoff`, () =>
    Response.json({
      obligation: {
        id: talkId,
        title: "Präsentation: Hashing-Verfahren",
        due: { date: "2099-12-11", time: "10:15", timeZone: null },
        destination: null,
        reportedSubmittedAt: null,
      },
      rule,
      drafts: [],
    }),
  );
  api.route("POST", `/api/me/obligations/${talkId}/ai-use`, async (request) => {
    const body = (await request.json()) as {
      level: "obligation" | "course";
      value: "allowed" | "conditional" | "forbidden";
    };
    answers.push(body);
    rule = {
      status: body.value,
      level: body.level,
      text: null,
      provenance: { kind: "entry" },
    };
    return Response.json({ status: "ok" });
  });

  renderObligation(talkId);

  await screen.findByText("Erlaubt dein Kurs KI hierfür?");
  expect(screen.getByText("KI-Regel unklar")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Entwurf erstellen" }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("button", { name: "Kritik anfordern" }),
  ).toHaveProperty("disabled", true);

  const handoff = screen.getByRole("region", { name: "Abgabe vorbereiten" });
  expect(
    within(handoff).getByText("Deine Quellen sagen nicht, wo du abgibst."),
  ).toBeTruthy();
  expect(
    within(handoff).getByText("Frag im Kurs nach oder trag es selbst ein."),
  ).toBeTruthy();
  expect(within(handoff).getByText("Noch kein Entwurf")).toBeTruthy();

  await userEvent.click(
    screen.getByRole("radio", { name: "Für den ganzen Kurs" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Erlaubt" }));

  await screen.findByText("KI-Regel für diese Abgabe");
  expect(answers).toEqual([{ level: "course", value: "allowed" }]);
  expect(
    screen.getByRole("button", { name: "Entwurf erstellen" }),
  ).toHaveProperty("disabled", false);
});

test("renders forbidden AI-use Rule muted without AI actions while keeping Handoff usable", async () => {
  serveContext();
  api.route("GET", `/api/me/obligations/${forbiddenId}/handoff`, () =>
    Response.json({
      obligation: {
        id: forbiddenId,
        title: "Übungsblatt 7: Beweise",
        due: { date: "2099-12-18", time: null, timeZone: null },
        destination: "Moodle",
        reportedSubmittedAt: null,
      },
      rule: {
        status: "forbidden",
        level: "course",
        text: "Keine KI-Werkzeuge bei Übungsblättern.",
        provenance: {
          kind: "source",
          sourceId: "s1",
          title: "Syllabus ADS",
          page: 2,
        },
      },
      drafts: [],
    }),
  );

  renderObligation(forbiddenId);

  await screen.findByText("KI verboten");
  expect(screen.getByText("Verboten")).toBeTruthy();
  expect(
    screen.getByText(
      "Dein Kurs erlaubt hier keine KI. nunio erstellt weder Entwürfe noch Kritik.",
    ),
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Entwurf erstellen" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Kritik anfordern" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Ich habe abgegeben" }),
  ).toBeTruthy();
});

test("lets the student change an existing AI-use Rule inline", async () => {
  serveContext();
  let rule: Record<string, unknown> = {
    status: "allowed",
    level: "obligation",
    text: null,
    provenance: { kind: "entry" },
  };
  api.route("GET", `/api/me/obligations/${sheetId}/handoff`, () =>
    Response.json({
      obligation: {
        id: sheetId,
        title: "Programmierprojekt: Kürzeste Wege",
        due: { date: "2099-12-04", time: "23:59", timeZone: null },
        destination: "Moodle",
        reportedSubmittedAt: null,
      },
      rule,
      drafts: [],
    }),
  );
  api.route("POST", `/api/me/obligations/${sheetId}/ai-use`, async (req) => {
    const body = (await req.json()) as {
      level: "obligation" | "course";
      value: "allowed" | "conditional" | "forbidden";
    };
    rule = {
      status: body.value,
      level: body.level,
      text: null,
      provenance: { kind: "entry" },
    };
    return Response.json({ status: "ok" });
  });

  renderObligation(sheetId);

  await userEvent.click(await screen.findByRole("button", { name: "Ändern" }));
  await screen.findByText("Erlaubt dein Kurs KI hierfür?");
  await userEvent.click(screen.getByRole("button", { name: "Verboten" }));
  await screen.findByText("KI verboten");
});

test("shows a clear message when the Obligation is gone or not handed in", async () => {
  serveContext();
  api.route("GET", `/api/me/obligations/${sheetId}/handoff`, () =>
    Response.json({ error: "not_handed_in" }, { status: 409 }),
  );

  renderObligation(sheetId);

  expect(
    await screen.findByText("Für diese Verpflichtung wird nichts abgegeben."),
  ).toBeTruthy();
  await screen.findByRole("link", {
    name: "Algorithms and Data Structures",
  });
  expect(
    screen.getByRole("link", { name: "Zurück zu Lernen" }).getAttribute("href"),
  ).toBe(`/study?course=${analysisId}`);
});
