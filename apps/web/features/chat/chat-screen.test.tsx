import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { SourcesScreen } from "@/features/sources/sources-screen";
import { api } from "@/test/api";
import { TestProviders } from "@/test/providers";
import { ChatScreen } from "./chat-screen";

const navigation = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.params,
}));
const course = {
  id: "course-1",
  title: "Microeconomics",
  code: "MICD",
  status: "accepted",
};
beforeEach(() => {
  navigation.params = new URLSearchParams();
  window.history.replaceState(null, "", "/chat");
  api.route("GET", "/api/me/review", () =>
    Response.json({ courses: [course] }),
  );
});
function committedResponse(data: unknown) {
  return new Response(
    `data: ${JSON.stringify({ type: "data-committed", data })}\n\ndata: [DONE]\n\n`,
    { headers: { "content-type": "text/event-stream" } },
  );
}
function mount(chatId: string | null = null) {
  navigation.params = new URLSearchParams(chatId ? { id: chatId } : {});
  return render(
    <TestProviders>
      <ChatScreen apiOrigin={api.origin} userName="Justus Schuhmacher" />
    </TestProviders>,
  );
}
test("a suggested prompt populates the composer without sending", async () => {
  mount();
  expect(screen.getByRole("button", { name: /Modell/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Neuer Chat" })).toBeTruthy();
  const user = userEvent.setup();
  const prompt = screen.getByRole("button", {
    name: "Wie sieht mein Lernplan für heute aus?",
  });
  await user.click(prompt);
  expect(
    (screen.getByRole("textbox", { name: "Nachricht" }) as HTMLTextAreaElement)
      .value,
  ).toBe("Wie sieht mein Lernplan für heute aus?");
  expect(window.location.search).toBe("");
  expect(screen.getByRole("heading", { name: /Justus/ })).toBeTruthy();
});

test("sending clears the composer before the response and restores a failed draft", async () => {
  let release = () => {};
  const response = new Promise<Response>((resolve) => {
    release = () =>
      resolve(Response.json({ error: "ai_disabled" }, { status: 403 }));
  });
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  api.route("POST", "/api/me/chats/chat-1/messages/stream", () => response);
  mount("chat-1");
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Neuer Chat" });
  const textarea = screen.getByRole("textbox", {
    name: "Nachricht",
  }) as HTMLTextAreaElement;
  try {
    await user.type(textarea, "Meine Frage");
    await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
    expect(textarea.value).toBe("");
    expect(screen.getByText("Meine Frage", { selector: "div" })).toBeTruthy();
  } finally {
    release();
  }
  await screen.findByRole("alert");
  expect(textarea.value).toBe("Meine Frage");
});

test("the first question and a waiting status show before the Chat exists", async () => {
  let create = () => {};
  api.route(
    "POST",
    "/api/me/chats",
    () =>
      new Promise<Response>((resolve) => {
        create = () =>
          resolve(Response.json({ id: "chat-1" }, { status: 201 }));
      }),
  );
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  let body: unknown;
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    body = await request.json();
    return Response.json({ error: "ai_disabled" }, { status: 403 });
  });
  mount();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Meine erste Frage",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  try {
    expect(
      await screen.findByText("Meine erste Frage", { selector: "div" }),
    ).toBeTruthy();
    expect(screen.getByText("nunio antwortet …")).toBeTruthy();
  } finally {
    create();
  }
  await screen.findByRole("alert");
  expect(body).toEqual({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    text: "Meine erste Frage",
  });
});

test("first send fixes the selected courses and displays the persisted turn", async () => {
  let selection: unknown;
  api.route("POST", "/api/me/chats", async (request) => {
    selection = await request.json();
    return Response.json({ id: "chat-1" }, { status: 201 });
  });
  const question = {
    id: "question-1",
    role: "student",
    text: "Erkläre die Grundlagen",
    citations: [],
    createdAt: "2026-11-10T09:48:00Z",
  };
  const answer = {
    id: "answer-1",
    role: "assistant",
    text: "## Grundlagen\n\nEine **gute Antwort**.",
    citations: [],
    createdAt: "2026-11-10T09:48:00Z",
  };
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({
      id: "chat-1",
      courses: [course],
      messages: [question, answer],
    }),
  );
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    expect(await request.json()).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      text: "Erkläre die Grundlagen",
    });
    return committedResponse({ ...answer, question });
  });
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Kurs auswählen" }));
  await user.click(
    await screen.findByRole("menuitemcheckbox", { name: /Microeconomics/ }),
  );
  await user.keyboard("{Escape}");
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Erkläre die Grundlagen",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  await screen.findByRole("heading", { name: "Grundlagen" });
  expect(selection).toEqual({ courseIds: ["course-1"], sourceIds: [] });
  expect(
    screen.getByRole("heading", { name: "Erkläre die Grundlagen" }),
  ).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Kurs auswählen",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("textbox", { name: "Nachricht" }) as HTMLTextAreaElement)
      .value,
  ).toBe("");
  await waitFor(() => expect(window.location.search).toBe("?id=chat-1"));
});

test("reopening a Chat restores its locked selection, title, citations and removed answers", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({
      id: "chat-1",
      courses: [course],
      messages: [
        {
          id: "q",
          role: "student",
          text: "Wann ist die Klausur?",
          createdAt: "2026-11-10T09:48:00Z",
          citations: [],
        },
        {
          id: "a",
          role: "assistant",
          text: "Im Februar [S1].",
          reasoning: "Ich habe den Termin im Handbuch geprüft.",
          createdAt: "2026-11-10T09:48:00Z",
          citations: [
            {
              tag: "S1",
              provenance: {
                kind: "source",
                sourceId: "source-1",
                title: "Handbuch.pdf",
                location: { page: 2 },
              },
            },
          ],
        },
        {
          id: "gone",
          role: "assistant",
          text: null,
          createdAt: "2026-11-10T09:48:00Z",
          citations: [{ tag: "S2", provenance: "gone" }],
        },
      ],
    }),
  );
  mount("chat-1");
  await screen.findByRole("heading", { name: "Wann ist die Klausur?" });
  await userEvent.hover(
    await screen.findByRole("button", {
      name: "Quelle S1: Handbuch.pdf, Seite 2",
    }),
  );
  const completedReasoning = screen.getByRole("button", {
    name: "Gedankengang",
  });
  expect(completedReasoning.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(completedReasoning);
  expect(
    screen.getByText("Ich habe den Termin im Handbuch geprüft."),
  ).toBeTruthy();
  const link = await screen.findByRole("link", { name: "Quelle öffnen" });
  expect(link.getAttribute("href")).toBe("/sources/source-1?page=2");

  expect(screen.getByText("Microeconomics")).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Kurs auswählen",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(screen.getByText(/Diese Antwort wurde entfernt/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Antwort bearbeiten" }),
  ).toBeNull();
});

test("an answer failure preserves the draft and retries the existing Chat without creating another", async () => {
  let creates = 0;
  let asks = 0;
  api.route("POST", "/api/me/chats", () => {
    creates++;
    return Response.json({ id: "chat-1" }, { status: 201 });
  });
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  api.route("POST", "/api/me/chats/chat-1/messages/stream", () => {
    asks++;
    return asks === 1
      ? Response.json({ error: "allowance_exhausted" }, { status: 403 })
      : committedResponse({
          id: "answer",
          role: "assistant",
          text: "Hier ist die Antwort.",
          citations: [],
          createdAt: "2026-11-10T09:48:00Z",
          question: {
            id: "question",
            role: "student",
            text: "Meine Frage",
            citations: [],
            createdAt: "2026-11-10T09:48:00Z",
          },
        });
  });
  mount();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Meine Frage",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "KI-Kontingent",
  );
  expect(
    (screen.getByRole("textbox", { name: "Nachricht" }) as HTMLTextAreaElement)
      .value,
  ).toBe("Meine Frage");
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Nachricht senden",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  await screen.findByText("Hier ist die Antwort.");
  expect(creates).toBe(1);
  expect(asks).toBe(2);
});

test("deleting a Source clears cached Chat answers and reloads their withdrawn state", async () => {
  let deleted = false;
  api.route("GET", "/api/me/sources", () =>
    Response.json(
      deleted
        ? []
        : [
            {
              id: "source-1",
              title: "Handbuch.pdf",
              status: "ready",
              extraction: "done",
              failure: null,
            },
          ],
    ),
  );
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({
      id: "chat-1",
      courses: [],
      messages: [
        {
          id: "answer",
          role: "assistant",
          text: deleted ? null : "Privater Inhalt aus dem Handbuch.",
          citations: [],
          createdAt: "2026-11-10T09:48:00Z",
        },
      ],
    }),
  );
  api.route("DELETE", "/api/me/sources/source-1", () => {
    deleted = true;
    return Response.json({ status: "deleted" });
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
  navigation.params = new URLSearchParams({ id: "chat-1" });
  render(
    <TestProviders>
      <SourcesScreen apiOrigin={api.origin} />
      <ChatScreen apiOrigin={api.origin} userName="Justus" />
    </TestProviders>,
  );
  await screen.findByText("Privater Inhalt aus dem Handbuch.");
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await screen.findByText(/Diese Antwort wurde entfernt/);
  expect(screen.queryByText("Privater Inhalt aus dem Handbuch.")).toBeNull();
});

test("renders partial Markdown before accepting the committed answer", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  let finish = () => {};
  const encoder = new TextEncoder();
  api.route(
    "POST",
    "/api/me/chats/chat-1/messages/stream",
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            const emit = (data: unknown) =>
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
              );
            emit({ type: "start", messageId: "answer-1" });
            emit({ type: "reasoning-start", id: "reasoning" });
            emit({
              type: "reasoning-delta",
              id: "reasoning",
              delta: "Ich prüfe deine Materialien.",
            });
            emit({ type: "text-start", id: "answer" });
            emit({
              type: "text-delta",
              id: "answer",
              delta: "## Schrittweise Antwort\n\nEin Anfang.",
            });
            finish = () => {
              emit({
                type: "data-committed",
                data: {
                  id: "answer-1",
                  role: "assistant",
                  text: "Die gespeicherte Antwort.",
                  reasoning: "Ich prüfe deine Materialien.",
                  createdAt: "2026-11-10T09:48:00Z",
                  citations: [],
                  question: {
                    id: "question-1",
                    role: "student",
                    text: "Meine Frage",
                    createdAt: "2026-11-10T09:48:00Z",
                    citations: [],
                  },
                },
              });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            };
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  mount("chat-1");
  await screen.findByRole("heading", { name: "Neuer Chat" });
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Meine Frage",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  try {
    await screen.findByText("Ich prüfe deine Materialien.");
    await screen.findByRole("heading", { name: "Schrittweise Antwort" });
    expect(screen.queryByText("Die gespeicherte Antwort.")).toBeNull();
  } finally {
    finish();
  }
  await screen.findByText("Die gespeicherte Antwort.");
  const reasoning = screen.getByRole("button", { name: "Gedankengang" });
  expect(reasoning.getAttribute("aria-expanded")).toBe("false");
  await user.click(reasoning);
  expect(screen.getByText("Ich prüfe deine Materialien.")).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: "Schrittweise Antwort" }),
  ).toBeNull();
  expect(
    screen.getAllByRole("article", { name: "Deine Nachricht" }),
  ).toHaveLength(1);
});

test("a saved answer keeps the element it streamed into, and the composer stays editable meanwhile", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  let finish = () => {};
  const encoder = new TextEncoder();
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    const { id } = (await request.json()) as { id: string };
    return new Response(
      new ReadableStream({
        start(controller) {
          const emit = (data: unknown) =>
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          emit({ type: "start", messageId: "answer-1" });
          emit({ type: "text-start", id: "answer" });
          emit({ type: "text-delta", id: "answer", delta: "Eine Antwort." });
          finish = () => {
            emit({ type: "text-end", id: "answer" });
            emit({
              type: "data-committed",
              data: {
                id: "answer-1",
                role: "assistant",
                text: "Eine Antwort.",
                createdAt: "2026-11-10T09:48:00Z",
                citations: [],
                question: {
                  id,
                  role: "student",
                  text: "Meine Frage",
                  createdAt: "2026-11-10T09:48:00Z",
                  citations: [],
                },
              },
            });
            emit({ type: "finish" });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          };
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  mount("chat-1");
  await screen.findByRole("heading", { name: "Neuer Chat" });
  const user = userEvent.setup();
  const textarea = screen.getByRole("textbox", {
    name: "Nachricht",
  }) as HTMLTextAreaElement;
  await user.type(textarea, "Meine Frage");
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  let streamed: HTMLElement;
  let question: HTMLElement;
  try {
    await screen.findByText("Eine Antwort.");
    streamed = screen.getByRole("article", { name: "Laufende Antwort" });
    question = screen.getByRole("article", { name: "Deine Nachricht" });
    await user.type(textarea, "Nächste Frage{Enter}");
    expect(textarea.value).toBe("Nächste Frage");
    expect(
      (
        screen.getByRole("button", {
          name: "Nachricht senden",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  } finally {
    finish();
  }
  await waitFor(() =>
    expect(screen.getByRole("article", { name: "Antwort von nunio" })).toBe(
      streamed,
    ),
  );
  expect(screen.getByRole("article", { name: "Deine Nachricht" })).toBe(
    question,
  );
  expect(textarea.value).toBe("Nächste Frage");
});

test("an interrupted stream restores the draft and does not save partial text", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  api.route(
    "POST",
    "/api/me/chats/chat-1/messages/stream",
    () =>
      new Response(
        `data: ${JSON.stringify({ type: "text-start", id: "answer" })}\n\ndata: ${JSON.stringify({ type: "text-delta", id: "answer", delta: "Nur ein Anfang" })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  mount("chat-1");
  await screen.findByRole("heading", { name: "Neuer Chat" });
  const user = userEvent.setup();
  const textarea = screen.getByRole("textbox", {
    name: "Nachricht",
  }) as HTMLTextAreaElement;
  await user.type(textarea, "Meine Frage");
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  expect((await screen.findByRole("alert")).textContent).toContain(
    "unterbrochen",
  );
  expect(textarea.value).toBe("Meine Frage");
  await waitFor(() => expect(screen.queryByText("Nur ein Anfang")).toBeNull());
});

test("Stop cancels a pending answer and restores the submitted draft", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  let close = () => {};
  api.route(
    "POST",
    "/api/me/chats/chat-1/messages/stream",
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                [
                  { type: "start", messageId: "answer-1" },
                  { type: "reasoning-start", id: "reasoning" },
                  {
                    type: "reasoning-delta",
                    id: "reasoning",
                    delta: "Ich denke nach.",
                  },
                  { type: "text-start", id: "answer" },
                  { type: "text-delta", id: "answer", delta: "Ein Anfang" },
                ]
                  .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
                  .join(""),
              ),
            );
            close = () => controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  mount("chat-1");
  await screen.findByRole("heading", { name: "Neuer Chat" });
  const user = userEvent.setup();
  const textarea = screen.getByRole("textbox", {
    name: "Nachricht",
  }) as HTMLTextAreaElement;
  try {
    await user.type(textarea, "Meine Frage");
    await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
    await screen.findByText("Ein Anfang");
    await screen.findByText("Ich denke nach.");
    await user.click(screen.getByRole("button", { name: "Antwort stoppen" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "gestoppt",
    );
    expect(textarea.value).toBe("Meine Frage");
    await waitFor(() => {
      expect(screen.queryByText("Ein Anfang")).toBeNull();
      expect(screen.queryByText("Ich denke nach.")).toBeNull();
    });
  } finally {
    close();
  }
});
