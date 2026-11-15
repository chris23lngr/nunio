import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { ArtifactScreen } from "@/features/study/artifact-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

vi.mock("next/navigation", () => ({
  usePathname: () => "/artifacts/a0000000-0000-4000-8000-000000000001",
}));

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

const artifactId = "a0000000-0000-4000-8000-000000000001";
const attemptId = "e0000000-0000-4000-8000-000000000001";
const source = {
  kind: "source",
  sourceId: "s1",
  title: "Skript",
  location: { page: 2 },
};
const summary = {
  id: artifactId,
  kind: "practice_set",
  status: "ready",
  failure: null as string | null,
  topicIds: ["t1"],
  obligationId: null,
  createdAt: "2026-11-10T09:00:00.000Z",
  openedAt: null,
  withdrawn: false,
  version: 1,
};
const first = "Wann konvergiert eine Funktionenfolge gleichmäßig?";
const second = "Was misst der Abstand?";
const practiceSet = {
  ...summary,
  content: {
    title: "Gleichmäßige Konvergenz von Funktionenfolgen",
    items: [
      {
        id: "1",
        topicIds: ["t1"],
        question: `${first} [S1]`,
        answer: "Wenn der Abstand überall klein wird.",
        citations: [{ tag: "S1", provenance: source }],
      },
      {
        id: "2",
        topicIds: ["t1"],
        question: `${second} [S1]`,
        answer: "Wie weit die Folge von der Grenzfunktion liegt.",
        citations: [{ tag: "S1", provenance: source }],
      },
    ],
  },
};
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();
/** The latest Attempt on an item, as the API shows it. */
const attempt = (
  itemId: string,
  text: string,
  verdict: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id: `${attemptId.slice(0, -1)}${itemId}`,
  artifactId,
  itemId,
  topicIds: ["t1"],
  text,
  verdict,
  feedback: verdict && {
    text: "Punktweise reicht nicht [S1].",
    citations: [{ tag: "S1", provenance: source }],
  },
  ungradedReason: null,
  createdAt: daysAgo(3),
  ...extra,
});

/**
 * Serves the Artifact, one view per GET in turn (the last one repeats), with the student's latest Attempts and
 * Courses, then shows it.
 */
function serveArtifact(
  shown: unknown,
  { attempts = [] as unknown[], courses = [] as unknown[] } = {},
) {
  const views = Array.isArray(shown) ? shown : [shown];
  api.route("GET", `/api/me/artifacts/${artifactId}`, () =>
    Response.json(views.length > 1 ? views.shift() : views[0]),
  );
  api.route("GET", `/api/me/artifacts/${artifactId}/attempts`, () =>
    Response.json(attempts),
  );
  api.route("GET", "/api/me/review", () => Response.json({ courses }));
  render(
    <TestProviders>
      <SidebarProvider>
        <ArtifactScreen apiOrigin={api.origin} id={artifactId} pollMs={20} />
      </SidebarProvider>
    </TestProviders>,
  );
}

test("shows a practice set under its title with the student's saved answers, their Feedback and when they last practised", async () => {
  serveArtifact([practiceSet], {
    attempts: [attempt("1", "Punktweise.", "incorrect")],
  });

  expect(
    (
      await screen.findByRole("heading", {
        level: 1,
        name: "Gleichmäßige Konvergenz von Funktionenfolgen",
      })
    ).textContent,
  ).toBeTruthy();
  const trail = screen.getByRole("navigation", { name: "breadcrumb" });
  expect(
    within(trail).getByRole("link", { name: "Artefakte" }).getAttribute("href"),
  ).toBe("/artifacts");
  expect(
    screen.getByRole("link", { name: "Zurück" }).getAttribute("href"),
  ).toBe("/artifacts");
  expect(await screen.findByText("Zuletzt gelernt vor 3 Tagen")).toBeTruthy();

  const answered = screen.getByRole("article", { name: `1. ${first}` });
  expect(
    (within(answered).getByLabelText("Deine Antwort") as HTMLTextAreaElement)
      .value,
  ).toBe("Punktweise.");
  expect(within(answered).getByText("Quelle: Skript, Seite 2")).toBeTruthy();
  const feedback = within(answered).getByRole("region", { name: "Feedback" });
  expect(within(feedback).getByText("Noch nicht richtig")).toBeTruthy();
  expect(feedback.textContent).toContain("Punktweise reicht nicht");
  expect(
    within(feedback).getByRole("button", {
      name: "Quelle S1: Skript, Seite 2",
    }),
  ).toBeTruthy();

  const open = screen.getByRole("article", { name: `2. ${second}` });
  expect(
    (within(open).getByLabelText("Deine Antwort") as HTMLTextAreaElement).value,
  ).toBe("");
  expect(within(open).queryByRole("region", { name: "Feedback" })).toBeNull();
  expect(
    (
      screen.getByRole("button", {
        name: "Antworten prüfen",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);

  const questions = screen.getByRole("navigation", { name: "Fragen" });
  expect(
    within(questions)
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]),
  ).toEqual([
    [`1. ${first}`, "#frage-1"],
    [`2. ${second}`, "#frage-2"],
  ]);
});

test("checks only the new, changed and ungraded answers with one button, and keeps the Feedback while the student reworks one", async () => {
  const sent: unknown[] = [];
  let release = () => {};
  api.route(
    "POST",
    `/api/me/artifacts/${artifactId}/attempts`,
    async (request) => {
      const body = (await request.json()) as {
        answers: { itemId: string; text: string }[];
      };
      sent.push(body);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return Response.json(
        body.answers.map(({ itemId, text }) =>
          attempt(itemId, text, itemId === "1" ? "correct" : "partial"),
        ),
        { status: 201 },
      );
    },
  );
  serveArtifact(practiceSet, {
    attempts: [attempt("1", "Gleichmäßig.", null)],
  });
  const answered = await screen.findByRole("article", { name: `1. ${first}` });
  const open = screen.getByRole("article", { name: `2. ${second}` });
  await within(answered).findByText("Konnte nicht bewertet werden");
  await userEvent.type(
    within(open).getByLabelText("Deine Antwort"),
    "Abstand.",
  );

  await userEvent.click(
    screen.getByRole("button", { name: "Antworten prüfen" }),
  );

  expect(
    (await screen.findByRole("button", { name: "Wird geprüft…" })).hasAttribute(
      "disabled",
    ),
  ).toBe(true);
  expect(
    (within(open).getByLabelText("Deine Antwort") as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
  release();
  await within(answered).findByText("Richtig");
  expect(within(open).getByText("Teilweise richtig")).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Antworten prüfen",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);

  await userEvent.type(
    within(open).getByLabelText("Deine Antwort"),
    " Überall.",
  );
  expect(within(open).getByText("Teilweise richtig")).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Antworten prüfen" }),
  );
  release();

  await screen.findByRole("button", { name: "Antworten prüfen" });
  expect(sent).toEqual([
    {
      answers: [
        { itemId: "1", text: "Gleichmäßig." },
        { itemId: "2", text: "Abstand." },
      ],
    },
    { answers: [{ itemId: "2", text: "Abstand. Überall." }] },
  ]);
});

test("says why an answer could not be graded, that Feedback went with its Source, and keeps the answers when checking fails", async () => {
  let fail = false;
  api.route("POST", `/api/me/artifacts/${artifactId}/attempts`, () =>
    fail
      ? Response.json({ error: "internal" }, { status: 500 })
      : Response.json(
          [
            attempt("2", "Abstand.", null, {
              ungradedReason: "allowance_exhausted",
            }),
          ],
          { status: 201 },
        ),
  );
  serveArtifact(practiceSet, {
    attempts: [attempt("1", "Punktweise.", "partial", { feedback: null })],
  });
  const answered = await screen.findByRole("article", { name: `1. ${first}` });
  const withdrawn = await within(answered).findByRole("region", {
    name: "Feedback",
  });
  expect(within(withdrawn).getByText("Teilweise richtig")).toBeTruthy();
  expect(
    within(withdrawn).getByText(
      "Das Feedback ist weg, weil eine Quelle gelöscht wurde.",
    ),
  ).toBeTruthy();

  const open = screen.getByRole("article", { name: `2. ${second}` });
  await userEvent.type(
    within(open).getByLabelText("Deine Antwort"),
    "Abstand.",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Antworten prüfen" }),
  );
  await within(open).findByText("Konnte nicht bewertet werden");
  expect(
    within(open).getByText("Dein KI-Kontingent ist aufgebraucht."),
  ).toBeTruthy();

  fail = true;
  await userEvent.click(
    screen.getByRole("button", { name: "Antworten prüfen" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Deine Antworten konnten nicht geprüft werden. Versuch es noch einmal.",
  );
  expect(
    (within(open).getByLabelText("Deine Antwort") as HTMLTextAreaElement).value,
  ).toBe("Abstand.");
});

test("says on return why an answer is still ungraded", async () => {
  serveArtifact(practiceSet, {
    attempts: [
      attempt("1", "Punktweise.", null, {
        ungradedReason: "allowance_exhausted",
      }),
    ],
  });

  const answered = await screen.findByRole("article", { name: `1. ${first}` });
  await within(answered).findByText("Konnte nicht bewertet werden");
  expect(
    within(answered).getByText("Dein KI-Kontingent ist aufgebraucht."),
  ).toBeTruthy();
});

test("names a practice set made before titles by its Topics", async () => {
  serveArtifact(
    {
      ...practiceSet,
      content: { ...practiceSet.content, title: null },
      topicIds: ["t1", "t2"],
    },
    {
      courses: [
        {
          id: "c1",
          title: "Analysis I",
          status: "accepted",
          facts: [
            { id: "t1", type: "topic", state: "accepted", value: "Konvergenz" },
            { id: "t2", type: "topic", state: "accepted", value: "Stetigkeit" },
          ],
          obligations: [],
        },
      ],
    },
  );

  expect(
    await screen.findByRole("heading", {
      level: 1,
      name: "Konvergenz und Stetigkeit",
    }),
  ).toBeTruthy();
});

test("says why an Artifact could not be made, and that a withdrawn one's content is gone", async () => {
  serveArtifact({
    ...summary,
    status: "failed",
    failure: "no_material",
    version: null,
    content: null,
  });
  expect((await screen.findByRole("alert")).textContent).toBe(
    "This could not be made: nothing in your material matched.",
  );
});

test("says a withdrawn Artifact's content is gone with its Source", async () => {
  serveArtifact({ ...practiceSet, withdrawn: true, content: null });
  await screen.findByText(
    "A Source it was made from was deleted, so its content is gone.",
  );
});

const flashcards = {
  ...summary,
  kind: "flashcards",
  content: {
    cards: [
      {
        id: "1",
        topicIds: ["t1"],
        front: "Gleichmäßige Konvergenz",
        back: "Der Abstand wird überall\ngleichzeitig klein.",
        citations: [{ tag: "S1", provenance: source }],
      },
    ],
  },
};

test("previews flashcards as Anki will import them, saves the student's edit as a new version, and links the download", async () => {
  const saved: unknown[] = [];
  let stale = false;
  api.route(
    "POST",
    `/api/me/artifacts/${artifactId}/versions`,
    async (request) => {
      saved.push(await request.json());
      return stale
        ? Response.json({ error: "stale" }, { status: 409 })
        : Response.json({ version: 2 }, { status: 201 });
    },
  );
  serveArtifact(flashcards);

  const preview = await screen.findByRole("table", {
    name: "As Anki will import them",
  });
  expect(
    within(preview)
      .getAllByRole("row")
      .map((row) => row.textContent),
  ).toEqual([
    "FrontBack",
    "Gleichmäßige KonvergenzDer Abstand wird überall\ngleichzeitig klein.",
  ]);
  const link = screen.getByRole("link", { name: "Download for Anki" });
  expect(link.getAttribute("href")).toBe(
    `${api.origin}/api/me/artifacts/${artifactId}/anki.tsv`,
  );

  const back = screen.getByLabelText("Back of card 1");
  await userEvent.clear(back);
  await userEvent.type(back, "Kürzer.");
  await userEvent.click(screen.getByRole("button", { name: "Add a card" }));
  await userEvent.type(screen.getByLabelText("Front of card 2"), "Neu");
  await userEvent.type(screen.getByLabelText("Back of card 2"), "Karte");
  await userEvent.click(
    screen.getByRole("button", { name: "Save as a new version" }),
  );

  await screen.findByText("Saved as version 2.");
  expect(saved).toEqual([
    {
      baseVersion: 1,
      content: {
        cards: [
          { id: "1", front: "Gleichmäßige Konvergenz", back: "Kürzer." },
          { front: "Neu", back: "Karte" },
        ],
      },
    },
  ]);
  stale = true;
  await userEvent.click(
    screen.getByRole("button", { name: "Save as a new version" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "This changed meanwhile. Reload it before saving again.",
  );
});

test("saves the student's rework of a draft as a new version, and shows a Critique read-only", async () => {
  const saved: unknown[] = [];
  api.route(
    "POST",
    `/api/me/artifacts/${artifactId}/versions`,
    async (request) => {
      saved.push(await request.json());
      return Response.json({ version: 2 }, { status: 201 });
    },
  );
  serveArtifact({
    ...summary,
    kind: "draft",
    content: {
      text: "Entwurf zu Aufgabe 1 [S1].",
      citations: [{ tag: "S1", provenance: source }],
    },
  });

  const draft = await screen.findByLabelText("Draft");
  expect(
    screen.getByRole("button", { name: "Quelle S1: Skript, Seite 2" }),
  ).toBeTruthy();
  await userEvent.clear(draft);
  await userEvent.type(draft, "Meine Fassung.");
  await userEvent.click(
    screen.getByRole("button", { name: "Save as a new version" }),
  );

  await screen.findByText("Saved as version 2.");
  expect(saved).toEqual([
    { baseVersion: 1, content: { text: "Meine Fassung." } },
  ]);
});

test("shows a Critique as text the student cannot edit", async () => {
  serveArtifact({
    ...summary,
    kind: "critique",
    content: { text: "Aufgabe 1 übersieht etwas [S1].", citations: [] },
  });

  await screen.findByText("Aufgabe 1 übersieht etwas [S1].");
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Save as a new version" }),
  ).toBeNull();
});
