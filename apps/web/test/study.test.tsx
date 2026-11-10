import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { StudyScreen } from "@/features/study/study-screen";
import { api } from "./api";
import { TestProviders } from "./providers";

const courseId = "c0000000-0000-4000-8000-000000000001";
const topicId = "70000000-0000-4000-8000-000000000001";
const sheetId = "0b000000-0000-4000-8000-000000000001";
const artifactId = "a0000000-0000-4000-8000-000000000001";

const provenance = {
  kind: "source",
  sourceId: "s1",
  title: "Skript",
  page: 2,
  quote: "Gleichmäßige Konvergenz",
};
/** One accepted Course with a Topic and an assignment, as review shows them. */
const review = {
  courses: [
    {
      id: courseId,
      code: "MA-101",
      title: "Analysis I",
      status: "accepted",
      obligations: [
        {
          id: sheetId,
          kind: "assignment",
          title: "Blatt 3",
          state: "confirmed",
          reportedSubmittedAt: null,
          due: { date: "2026-11-20", time: null, timeZone: null, text: null },
          destination: "Moodle",
          uncertainty: null,
          provenance,
          disagreement: false,
          unsupported: null,
          values: [],
        },
      ],
      facts: [
        {
          id: topicId,
          type: "topic",
          value: "Gleichmäßige Konvergenz",
          state: "unreviewed",
          uncertainty: null,
          provenance,
          disagreement: false,
          unsupported: null,
          values: [],
        },
      ],
    },
  ],
};

/** Serves the study screen's data and records what the student sends. */
function serveStudy(level: Record<string, unknown>) {
  const sent: { path: string; body: unknown }[] = [];
  api.route("GET", "/api/me/review", () => Response.json(review));
  api.route("GET", `/api/me/courses/${courseId}/levels`, () =>
    Response.json([{ topicId, ...level }]),
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
    `/api/me/topics/${topicId}/self-assessment`,
    record(200, { status: "ok" }),
  );
  render(
    <TestProviders>
      <StudyScreen apiOrigin={api.origin} />
    </TestProviders>,
  );
  return sent;
}

test("shows a disputed Topic with both sides, and asks for practice on it", async () => {
  const sent = serveStudy({
    level: "disputed",
    fromAttempts: "shaky",
    selfAssessment: "solid",
    lastEvidenceAt: "2026-11-09T10:00:00.000Z",
  });
  const topic = await screen.findByRole("article", {
    name: "Gleichmäßige Konvergenz",
  });

  await within(topic).findByText(
    "Disputed: your Attempts say shaky, but you said solid.",
  );
  expect(within(topic).getByText(/^Last evidence /)).toBeTruthy();
  await userEvent.click(
    within(topic).getByRole("button", { name: "Practice" }),
  );

  const link = await within(topic).findByRole("link", {
    name: "Open the practice set",
  });
  expect(link.getAttribute("href")).toBe(`/study/artifacts/${artifactId}`);
  expect(sent).toEqual([
    {
      path: "/api/me/artifacts",
      body: {
        kind: "practice_set",
        topicIds: [topicId],
        from: { selection: { courseIds: [courseId], sourceIds: [] } },
      },
    },
  ]);
});

test("shows a Topic not yet practiced, and records the student's own Self-assessment", async () => {
  const sent = serveStudy({
    level: "not_yet_practiced",
    fromAttempts: null,
    selfAssessment: null,
    lastEvidenceAt: null,
  });
  const topic = await screen.findByRole("article", {
    name: "Gleichmäßige Konvergenz",
  });

  await within(topic).findByText("Not yet practiced");
  await userEvent.click(
    within(topic).getByRole("button", { name: "I feel shaky" }),
  );

  await within(topic).findByText("Noted.");
  expect(sent).toEqual([
    {
      path: `/api/me/topics/${topicId}/self-assessment`,
      body: { level: "shaky" },
    },
  ]);
});

/** Serves the study screen and replies to each Artifact request in turn, recording what was sent. */
function serveWriting(...replies: { status: number; body: unknown }[]) {
  const sent: { method: string; path: string; body: unknown }[] = [];
  api.route("GET", "/api/me/review", () => Response.json(review));
  api.route("GET", `/api/me/courses/${courseId}/levels`, () =>
    Response.json([]),
  );
  api.route("POST", "/api/me/artifacts", async (request) => {
    sent.push({
      method: "POST",
      path: "/api/me/artifacts",
      body: await request.json(),
    });
    const reply = replies.shift()!;
    return Response.json(reply.body, { status: reply.status });
  });
  api.route(
    "POST",
    `/api/me/obligations/${sheetId}/ai-use`,
    async (request) => {
      sent.push({
        method: "POST",
        path: "ai-use",
        body: await request.json(),
      });
      return Response.json({ status: "ok" });
    },
  );
  api.route("GET", `/api/me/obligations/${sheetId}/ai-use`, () =>
    Response.json({
      status: "conditional",
      level: "course",
      text: "KI ist mit Kennzeichnung erlaubt.",
      provenance: { kind: "source", sourceId: "s1", title: "Skript", page: 1 },
    }),
  );
  render(
    <TestProviders>
      <StudyScreen apiOrigin={api.origin} />
    </TestProviders>,
  );
  return sent;
}
const started = { status: 202, body: { artifactId, runId: "r1" } };
const refused = (error: string) => ({ status: 409, body: { error } });
const from = { selection: { courseIds: [courseId], sourceIds: [] } };

test("asks for the AI-use Rule while it is unknown, records the student's answer, then drafts", async () => {
  const sent = serveWriting(refused("ai_use_unknown"), started);
  const sheet = await screen.findByRole("article", { name: "Blatt 3" });
  await userEvent.type(
    within(sheet).getByLabelText("Instructions for a draft"),
    "Nur Aufgabe 1.",
  );
  await userEvent.click(within(sheet).getByRole("button", { name: "Draft" }));

  const question = await within(sheet).findByRole("group", {
    name: "Does your course allow AI for this?",
  });
  await userEvent.click(
    within(question).getByRole("radio", { name: "For the whole course" }),
  );
  await userEvent.click(
    within(question).getByRole("button", { name: "Allowed" }),
  );

  await within(sheet).findByRole("link", { name: "Open the draft" });
  const draft = {
    kind: "draft",
    obligationId: sheetId,
    instructions: "Nur Aufgabe 1.",
    from,
  };
  expect(sent.map(({ path, body }) => [path, body])).toEqual([
    ["/api/me/artifacts", draft],
    ["ai-use", { level: "course", value: "allowed" }],
    ["/api/me/artifacts", draft],
  ]);
});

test("shows a conditional AI-use Rule's wording and drafts only once the student confirms its conditions", async () => {
  const sent = serveWriting(refused("ai_use_conditions"), started);
  const sheet = await screen.findByRole("article", { name: "Blatt 3" });
  await userEvent.click(within(sheet).getByRole("button", { name: "Draft" }));

  await within(sheet).findByText("KI ist mit Kennzeichnung erlaubt.");
  await userEvent.click(
    within(sheet).getByRole("button", {
      name: "I will keep to these conditions",
    }),
  );

  await within(sheet).findByRole("link", { name: "Open the draft" });
  expect(sent.map(({ body }) => body)).toEqual([
    { kind: "draft", obligationId: sheetId, instructions: "", from },
    {
      kind: "draft",
      obligationId: sheetId,
      instructions: "",
      from,
      conditionsConfirmed: true,
    },
  ]);
});

test("says why it will not draft when the course forbids AI, and critiques the student's own work when allowed", async () => {
  const sent = serveWriting(refused("ai_use_forbidden"), started);
  const sheet = await screen.findByRole("article", { name: "Blatt 3" });
  await userEvent.click(within(sheet).getByRole("button", { name: "Draft" }));

  expect((await within(sheet).findByRole("alert")).textContent).toBe(
    "Your course does not allow AI for this, so nunio will not write it.",
  );

  await userEvent.type(
    within(sheet).getByLabelText("Your own work"),
    "Aufgabe 1: punktweise genügt.",
  );
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Critique my work" }),
  );
  await within(sheet).findByRole("link", { name: "Open the Critique" });
  expect(sent.at(-1)!.body).toEqual({
    kind: "critique",
    obligationId: sheetId,
    of: { ownWork: "Aufgabe 1: punktweise genügt." },
    from,
  });
});

test("prepares a Handoff with where to hand it in, the rule's conditions and the drafts, and records the student's report", async () => {
  const reports: unknown[] = [];
  let reportedSubmittedAt: string | null = null;
  api.route("GET", "/api/me/review", () => Response.json(review));
  api.route("GET", `/api/me/courses/${courseId}/levels`, () =>
    Response.json([]),
  );
  api.route("GET", `/api/me/obligations/${sheetId}/handoff`, () =>
    Response.json({
      obligation: {
        id: sheetId,
        title: "Blatt 3",
        due: { date: "2026-11-20", time: null, timeZone: null },
        destination: "Moodle",
        reportedSubmittedAt,
      },
      rule: {
        status: "conditional",
        level: "course",
        text: "KI ist mit Kennzeichnung erlaubt.",
        provenance: {
          kind: "source",
          sourceId: "s1",
          title: "Skript",
          page: 1,
        },
      },
      drafts: [
        { id: artifactId, version: 2, createdAt: "2026-11-10T09:00:00.000Z" },
      ],
    }),
  );
  api.route(
    "POST",
    `/api/me/obligations/${sheetId}/reported-submitted`,
    async (request) => {
      const body = (await request.json()) as { reported: boolean };
      reports.push(body);
      reportedSubmittedAt = body.reported ? "2026-11-19T18:00:00.000Z" : null;
      return Response.json({ status: "ok" });
    },
  );
  render(
    <TestProviders>
      <StudyScreen apiOrigin={api.origin} />
    </TestProviders>,
  );
  const sheet = await screen.findByRole("article", { name: "Blatt 3" });
  await userEvent.click(
    within(sheet).getByRole("button", { name: "Prepare the Handoff" }),
  );

  const handoff = await within(sheet).findByRole("region", { name: "Handoff" });
  await within(handoff).findByText(
    "Hand it in at: Moodle (as your Source says; nunio has not checked it).",
  );
  expect(
    within(handoff).getByText("KI ist mit Kennzeichnung erlaubt."),
  ).toBeTruthy();
  expect(
    within(handoff)
      .getByRole("link", { name: "Draft, version 2" })
      .getAttribute("href"),
  ).toBe(`/study/artifacts/${artifactId}`);
  await userEvent.click(
    within(handoff).getByRole("button", { name: "I handed it in" }),
  );
  await within(handoff).findByText(/^You reported it as handed in on /);
  await userEvent.click(
    within(handoff).getByRole("button", { name: "Take that back" }),
  );
  await within(handoff).findByRole("button", { name: "I handed it in" });
  expect(reports).toEqual([{ reported: true }, { reported: false }]);
});
