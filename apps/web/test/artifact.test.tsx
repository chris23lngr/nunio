import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { ArtifactScreen } from "@/features/study/artifact-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

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
const practiceSet = {
  ...summary,
  content: {
    items: [
      {
        id: "1",
        topicIds: ["t1"],
        question: "Wann konvergiert eine Funktionenfolge gleichmäßig?",
        answer: "Wenn der Abstand überall klein wird.",
        citations: [{ tag: "S1", provenance: source }],
      },
    ],
  },
};
const graded = (verdict: string) => ({
  id: attemptId,
  artifactId,
  itemId: "1",
  topicIds: ["t1"],
  text: "Punktweise.",
  verdict,
  feedback: {
    text: "Punktweise reicht nicht [S1].",
    citations: [{ tag: "S1", provenance: source }],
  },
  createdAt: "2026-11-10T09:05:00.000Z",
});

/** Serves the Artifact, one view per GET in turn (the last one repeats), and records what the student sends. */
function serveArtifact(...views: unknown[]) {
  const sent: { path: string; body: unknown }[] = [];
  api.route("GET", `/api/me/artifacts/${artifactId}`, () =>
    Response.json(views.length > 1 ? views.shift() : views[0]),
  );
  render(
    <TestProviders>
      <ArtifactScreen apiOrigin={api.origin} id={artifactId} pollMs={20} />
    </TestProviders>,
  );
  return sent;
}

test("waits while a practice set is made, then grades the student's answer with Feedback and its Source", async () => {
  const sent: unknown[] = [];
  api.route("POST", "/api/me/attempts", async (request) => {
    sent.push(await request.json());
    return Response.json(
      { status: "graded", attempt: graded("incorrect") },
      { status: 201 },
    );
  });
  serveArtifact(
    { ...summary, status: "making", version: null, content: null },
    practiceSet,
  );

  await screen.findByText("Being made…");
  const item = await screen.findByRole("article", {
    name: "Wann konvergiert eine Funktionenfolge gleichmäßig?",
  });
  await userEvent.type(
    within(item).getByLabelText("Your answer"),
    "Punktweise.",
  );
  await userEvent.click(
    within(item).getByRole("button", { name: "Check my answer" }),
  );

  const feedback = await within(item).findByRole("region", {
    name: "Feedback",
  });
  expect(within(feedback).getByText("Not yet correct")).toBeTruthy();
  expect(
    within(feedback).getByText("Punktweise reicht nicht [S1]."),
  ).toBeTruthy();
  expect(within(feedback).getByText("[S1] Skript, page 2")).toBeTruthy();
  expect(sent).toEqual([{ artifactId, itemId: "1", text: "Punktweise." }]);
});

test("keeps an answer it could not grade, and grades it when the student asks again", async () => {
  api.route("POST", "/api/me/attempts", () =>
    Response.json(
      { status: "ungraded", attemptId, reason: "grader_failed" },
      { status: 201 },
    ),
  );
  api.route("POST", `/api/me/attempts/${attemptId}/grade`, () =>
    Response.json(graded("correct")),
  );
  serveArtifact(practiceSet);
  const item = await screen.findByRole("article", {
    name: "Wann konvergiert eine Funktionenfolge gleichmäßig?",
  });
  await userEvent.type(
    within(item).getByLabelText("Your answer"),
    "Punktweise.",
  );
  await userEvent.click(
    within(item).getByRole("button", { name: "Check my answer" }),
  );

  await within(item).findByText(
    "Your answer is saved, but could not be graded yet.",
  );
  await userEvent.click(
    within(item).getByRole("button", { name: "Grade again" }),
  );

  await within(item).findByText("Correct");
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
  expect(screen.getByText("[S1] Skript, page 2")).toBeTruthy();
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
