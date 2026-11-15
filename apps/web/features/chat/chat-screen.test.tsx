import { SidebarProvider } from "@nunio/ui/components/sidebar/sidebar";
import { focusManager } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SourcesScreen } from "@/features/sources/sources-screen";
import { api } from "@/test/api";
import { TestProviders } from "@/test/providers";
import { ChatScreen } from "./chat-screen";

const navigation = vi.hoisted(() => ({
  params: new URLSearchParams(),
  pushed: [] as string[],
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.params,
  usePathname: () => "/chat",
  useRouter: () => ({
    push: (href: string) => navigation.pushed.push(href),
    replace: (href: string) => navigation.pushed.push(href),
  }),
}));
const course = {
  id: "course-1",
  title: "Microeconomics",
  code: "MICD",
  status: "accepted",
  color: "rose",
};
const dataHandling = {
  provider: "OpenRouter",
  upstream: ["Amazon Bedrock", "Google"],
  routing: "international",
  zeroRetention: true,
};
const sonnet = {
  key: "sonnet-5.5",
  name: "Sonnet 5.5",
  provider: "Anthropic",
  description: "Ausgewogen für Erklärungen.",
  dataHandling,
  cost: { relativeToDefault: 1, tier: "medium" },
};
const opus = {
  key: "opus-5.5",
  name: "Opus 5.5",
  provider: "Anthropic",
  description: "Am gründlichsten.",
  dataHandling,
  cost: { relativeToDefault: 2, tier: "high" },
};
const haiku = {
  key: "haiku-5.5",
  name: "Haiku 5.5",
  provider: "Anthropic",
  description: "Schnell und sparsam.",
  dataHandling,
  cost: { relativeToDefault: 0.05, tier: "low" },
};
const catalog = {
  models: [haiku, sonnet, opus],
  default: "sonnet-5.5",
  selected: "sonnet-5.5",
};
beforeEach(() => {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = "nunio_open_chat=; path=/; max-age=0";
  navigation.params = new URLSearchParams();
  navigation.pushed = [];
  window.history.replaceState(null, "", "/chat");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  api.route("GET", "/api/me/courses", () =>
    Response.json({ courses: [course] }),
  );
  api.route("GET", "/api/me/models", () => Response.json(catalog));
  api.route("GET", "/api/me/chats", () =>
    Response.json({ chats: [], nextCursor: null }),
  );
});
afterEach(() => vi.unstubAllGlobals());

/** The student's Chats `chat-1` to `chat-<count>`, most recent first. */
function recentChats(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `chat-${i + 1}`,
    title: `Frage ${i + 1}`,
    lastActivityAt: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
  }));
}
/** Answers the Chat list with `chats`, `limit` at a time. */
function listChats(chats: ReturnType<typeof recentChats>) {
  api.route("GET", "/api/me/chats", (request) => {
    const limit = Number(new URL(request.url).searchParams.get("limit"));
    return Response.json({
      chats: chats.slice(0, limit),
      nextCursor: chats.length > limit ? "next" : null,
    });
  });
}
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
      <SidebarProvider>
        <ChatScreen
          apiOrigin={api.origin}
          userId="student-1"
          userName="Justus Schuhmacher"
        />
      </SidebarProvider>
    </TestProviders>,
  );
}
/** An instant at `hour` o'clock on `day` November 2026, in whatever zone the tests run. */
const at = (day: number, hour: number) =>
  new Date(2026, 10, day, hour).toISOString();
/** A saved proposal of a new block for Übungsblatt 4 on Friday 20 Nov, 10 to 12, numbered `n`. */
function blockProposal(n: string, status: string, decision: string | null) {
  return {
    type: "tool-proposeStudyBlock",
    toolCallId: `call-${n}`,
    input: { work: "O1", start: "2026-11-20T10:00", end: "2026-11-20T12:00" },
    approvalId: `approval-${n}`,
    notes: [],
    action: {
      id: `action-${n}`,
      fingerprint: `fingerprint-${n}`,
      expiresAt: "2099-01-01T00:00:00Z",
      status,
      decision,
      shown: {
        kind: "studyBlock.create",
        work: { title: "Übungsblatt 4", course: "Analysis I" },
        from: null,
        to: { start: at(20, 10), end: at(20, 12) },
        task: null,
      },
    },
  };
}
/** The stream of nunio's report on the student's decisions, saved as `saved`. */
function reportStream(saved: { id: string; text: string }) {
  const report = {
    role: "assistant",
    parts: [{ type: "text", text: saved.text }],
    createdAt: "2026-11-10T09:50:00Z",
    citations: [],
    model: null,
    ...saved,
  };
  return new Response(
    [
      { type: "start", messageId: report.id },
      { type: "start-step" },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: report.text },
      { type: "text-end", id: "text" },
      { type: "finish-step" },
      { type: "data-committed", data: { ...report, question: null } },
      { type: "finish" },
    ]
      .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
}
/** Waits until the reopened Chat has loaded, so it can be sent to. */
async function chatLoaded() {
  await screen.findByRole("textbox", { name: "Nachricht" });
  await waitFor(() => expect(screen.queryByText("Chat laden …")).toBeNull());
}
test("a new Chat lists the student's recent Chats, each linking to it", async () => {
  listChats(recentChats(2));
  mount();

  const recent = await screen.findByRole("list", {
    name: "Deine letzten Chats",
  });

  expect(
    within(recent)
      .getAllByRole("link")
      .map((link) => [link.textContent, link.getAttribute("href")]),
  ).toEqual([
    ["Frage 1", "/chat?id=chat-1"],
    ["Frage 2", "/chat?id=chat-2"],
  ]);
});

test("a new Chat lists four recent Chats and links to all of them only when there are more", async () => {
  listChats(recentChats(4));
  const { unmount } = mount();
  await screen.findByRole("list", { name: "Deine letzten Chats" });
  expect(screen.queryByRole("link", { name: "Alle anzeigen" })).toBeNull();
  unmount();

  listChats(recentChats(5));
  mount();
  const recent = await screen.findByRole("list", {
    name: "Deine letzten Chats",
  });

  expect(within(recent).getAllByRole("link")).toHaveLength(4);
  expect(
    screen.getByRole("link", { name: "Alle anzeigen" }).getAttribute("href"),
  ).toBe("/chat/history");
});

test("the recent-Chats menu lists eight Chats with how long ago each was active, marking the open one", async () => {
  listChats(recentChats(9));
  api.route("GET", "/api/me/chats/chat-2", () =>
    Response.json({ id: "chat-2", courses: [], messages: [] }),
  );
  mount("chat-2");
  const user = userEvent.setup();

  await user.click(await screen.findByRole("button", { name: "Letzte Chats" }));
  const chats = within(
    await screen.findByRole("group", { name: "Letzte Chats" }),
  ).getAllByRole("menuitem");
  // A row reads as the title followed by how long ago.
  const row = (title: string, age: string) => title + age;

  expect(
    chats.map((item) => [
      item.textContent,
      item.getAttribute("href"),
      item.getAttribute("aria-current"),
    ]),
  ).toEqual([
    [row("Frage 1", "1 Tag"), "/chat?id=chat-1", null],
    [row("Frage 2", "2 Tage"), "/chat?id=chat-2", "page"],
    [row("Frage 3", "3 Tage"), "/chat?id=chat-3", null],
    [row("Frage 4", "4 Tage"), "/chat?id=chat-4", null],
    [row("Frage 5", "5 Tage"), "/chat?id=chat-5", null],
    [row("Frage 6", "6 Tage"), "/chat?id=chat-6", null],
    [row("Frage 7", "1 Woche"), "/chat?id=chat-7", null],
    [row("Frage 8", "1 Woche"), "/chat?id=chat-8", null],
  ]);
});

test("the recent-Chats menu links to all Chats only when there are more than it lists", async () => {
  listChats(recentChats(8));
  const { unmount } = mount();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Letzte Chats" }));
  await screen.findByRole("group", { name: "Letzte Chats" });
  expect(screen.queryByRole("menuitem", { name: "Alle anzeigen" })).toBeNull();
  unmount();

  listChats(recentChats(9));
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  mount("chat-1");
  await user.click(await screen.findByRole("button", { name: "Letzte Chats" }));

  // "Zurück" there leads back to the open Chat.
  expect(
    (
      await screen.findByRole("menuitem", { name: "Alle anzeigen" })
    ).getAttribute("href"),
  ).toBe("/chat/history?from=chat-1");
});

test("an opened Chat is remembered on this device for thirty minutes", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-14T12:00:00Z") });
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  mount("chat-1");
  await chatLoaded();

  expect(document.cookie).toBe("nunio_open_chat=student-1%3Achat-1");
  vi.setSystemTime(new Date("2026-11-14T12:31:00Z"));
  expect(document.cookie).toBe("");
});

test("reloading the open Chat doesn't keep it remembered for longer", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-14T12:00:00Z") });
  let loads = 0;
  api.route("GET", "/api/me/chats/chat-1", () => {
    loads += 1;
    return Response.json({ id: "chat-1", courses: [], messages: [] });
  });
  mount("chat-1");
  await chatLoaded();
  vi.setSystemTime(new Date("2026-11-14T12:20:00Z"));

  // Returning to the tab reloads the stale Chat.
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await waitFor(() => expect(loads).toBe(2));
  focusManager.setFocused(undefined);

  vi.setSystemTime(new Date("2026-11-14T12:31:00Z"));
  expect(document.cookie).toBe("");
});

test("a saved answer keeps the Chat remembered for another thirty minutes", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-14T12:00:00Z") });
  let loads = 0;
  api.route("GET", "/api/me/chats/chat-1", () => {
    loads += 1;
    return Response.json({ id: "chat-1", courses: [], messages: [] });
  });
  const question = {
    id: "question-1",
    role: "student",
    text: "Noch eine Frage",
    parts: [{ type: "text", text: "Noch eine Frage" }],
    citations: [],
    createdAt: "2026-11-14T12:20:00Z",
  };
  api.route("POST", "/api/me/chats/chat-1/messages/stream", () =>
    committedResponse({
      ...question,
      id: "answer-1",
      role: "assistant",
      text: "Eine Antwort.",
      parts: [{ type: "text", text: "Eine Antwort." }],
      question,
    }),
  );
  mount("chat-1");
  await chatLoaded();
  vi.setSystemTime(new Date("2026-11-14T12:20:00Z"));
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Noch eine Frage",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  // The saved turn reloads the Chat.
  await waitFor(() => expect(loads).toBe(2));

  // Past the thirty minutes from opening it. Read once: jsdom counts the cookie's age from its last read.
  vi.setSystemTime(new Date("2026-11-14T12:31:00Z"));
  expect(document.cookie).toBe("nunio_open_chat=student-1%3Achat-1");
});

test("a remembered Chat that is gone is forgotten quietly for an empty one", async () => {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = "nunio_open_chat=student-1%3Achat-1; path=/";
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ error: "gone" }, { status: 404 }),
  );
  mount("chat-1");

  // A failed load is retried once after a second.
  await waitFor(() => expect(navigation.pushed).toEqual(["/chat"]), {
    timeout: 3000,
  });
  expect(document.cookie).toBe("");
  expect(
    screen.queryByText("Dieser Chat ist nicht mehr verfügbar."),
  ).toBeNull();
});

test("a gone Chat remembered for another student shows that it is gone", async () => {
  // biome-ignore lint/suspicious/noDocumentCookie: jsdom has no Cookie Store API.
  document.cookie = "nunio_open_chat=someone-else%3Achat-1; path=/";
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ error: "gone" }, { status: 404 }),
  );
  mount("chat-1");

  // A failed load is retried once after a second.
  expect(
    await screen.findByText(
      "Dieser Chat ist nicht mehr verfügbar.",
      {},
      { timeout: 3000 },
    ),
  ).toBeTruthy();
  expect(navigation.pushed).toEqual([]);
});

test("Neuer Chat forgets the open Chat and goes to an empty one", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  mount("chat-1");
  await chatLoaded();

  await userEvent.click(screen.getByRole("button", { name: "Neuer Chat" }));

  expect(navigation.pushed).toEqual(["/chat"]);
  expect(document.cookie).toBe("");
});

test("⌘⇧O or Ctrl+Shift+O starts an empty Chat like Neuer Chat", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  mount("chat-1");
  await chatLoaded();
  const user = userEvent.setup();

  await user.keyboard("{Meta>}{Shift>}o{/Shift}{/Meta}");
  await user.keyboard("{Control>}{Shift>}O{/Shift}{/Control}");

  expect(navigation.pushed).toEqual(["/chat", "/chat"]);
  expect(document.cookie).toBe("");
});

test("a saved answer puts its Chat at the top of the recent-Chats menu", async () => {
  const listed = [] as ReturnType<typeof recentChats>;
  api.route("GET", "/api/me/chats", () =>
    Response.json({ chats: listed, nextCursor: null }),
  );
  api.route("POST", "/api/me/chats", () =>
    Response.json({ id: "chat-new" }, { status: 201 }),
  );
  const question = {
    id: "question-1",
    role: "student",
    text: "Was ist Elastizität?",
    parts: [{ type: "text", text: "Was ist Elastizität?" }],
    citations: [],
    createdAt: "2026-11-14T09:48:00Z",
  };
  const answer = {
    ...question,
    id: "answer-1",
    role: "assistant",
    text: "Eine Antwort.",
    parts: [{ type: "text", text: "Eine Antwort." }],
  };
  api.route("GET", "/api/me/chats/chat-new", () =>
    Response.json({
      id: "chat-new",
      courses: [],
      messages: [question, answer],
    }),
  );
  api.route("POST", "/api/me/chats/chat-new/messages/stream", () => {
    listed.unshift({
      id: "chat-new",
      title: "Was ist Elastizität?",
      lastActivityAt: new Date().toISOString(),
    });
    return committedResponse({ ...answer, question });
  });
  mount();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Was ist Elastizität?",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  await screen.findByText("Eine Antwort.");

  await user.click(screen.getByRole("button", { name: "Letzte Chats" }));

  expect(
    (
      await screen.findByRole("menuitem", { name: /Was ist Elastizität/ })
    ).getAttribute("aria-current"),
  ).toBe("page");
});

test("a student with no Chats yet sees only the greeting", async () => {
  mount();

  expect(await screen.findByRole("heading", { name: /Justus/ })).toBeTruthy();
  await screen.findByRole("button", { name: "Modell: Sonnet 5.5" });
  expect(
    screen.queryByRole("list", { name: "Deine letzten Chats" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: /Lernplan/ })).toBeNull();
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
  await chatLoaded();
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
    expect(
      screen.getByText("Denkt nach …").closest('[role="status"]'),
    ).not.toBeNull();
  } finally {
    create();
  }
  await screen.findByRole("alert");
  expect(body).toEqual({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    text: "Meine erste Frage",
    model: "sonnet-5.5",
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
    parts: [{ type: "text", text: "Erkläre die Grundlagen" }],
    citations: [],
    createdAt: "2026-11-10T09:48:00Z",
  };
  const answer = {
    id: "answer-1",
    role: "assistant",
    text: "## Grundlagen\n\nEine **gute Antwort**.",
    parts: [{ type: "text", text: "## Grundlagen\n\nEine **gute Antwort**." }],
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
      model: "sonnet-5.5",
    });
    return committedResponse({ ...answer, question });
  });
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Wissen verwalten" }));
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
  expect(screen.getByText("Erkläre die Grundlagen")).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Wissen verwalten, 1 Quelle ausgewählt",
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
          parts: [{ type: "text", text: "Wann ist die Klausur?" }],
          createdAt: "2026-11-10T09:48:00Z",
          citations: [],
        },
        {
          id: "a",
          role: "assistant",
          text: "Im Februar [S1].",
          reasoning: "Ich habe den Termin im Handbuch geprüft.",
          parts: [
            {
              type: "reasoning",
              text: "Ich habe den Termin im Handbuch geprüft.",
            },
            { type: "text", text: "Im Februar [S1]." },
          ],
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
          parts: [],
          createdAt: "2026-11-10T09:48:00Z",
          citations: [{ tag: "S2", provenance: "gone" }],
        },
      ],
    }),
  );
  mount("chat-1");
  await screen.findByText("Wann ist die Klausur?");
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

  expect(
    (
      screen.getByRole("button", {
        name: "Wissen verwalten, 1 Quelle ausgewählt",
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
          parts: [{ type: "text", text: "Hier ist die Antwort." }],
          citations: [],
          createdAt: "2026-11-10T09:48:00Z",
          question: {
            id: "question",
            role: "student",
            text: "Meine Frage",
            parts: [{ type: "text", text: "Meine Frage" }],
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

test("the remembered model is preselected and the chosen one is sent with the question", async () => {
  api.route("GET", "/api/me/models", () =>
    Response.json({ ...catalog, selected: "haiku-5.5" }),
  );
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  let body: unknown;
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    body = await request.json();
    return Response.json({ error: "ai_disabled" }, { status: 403 });
  });
  mount("chat-1");
  const user = userEvent.setup();
  await chatLoaded();
  await user.click(
    await screen.findByRole("button", { name: "Modell: Haiku 5.5" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Opus 5.5" }));
  await screen.findByRole("button", { name: "Modell: Opus 5.5" });
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Meine Frage",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  await screen.findByRole("alert");
  expect(body).toEqual({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    text: "Meine Frage",
    model: "opus-5.5",
  });
});

test("a model that is no longer offered restores the draft and switches to the offered one", async () => {
  let catalogs = 0;
  api.route("GET", "/api/me/models", () => {
    catalogs++;
    return Response.json(
      catalogs === 1
        ? catalog
        : { ...catalog, models: [haiku, sonnet], selected: "sonnet-5.5" },
    );
  });
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  api.route(
    "POST",
    "/api/me/chats/chat-1/messages/stream",
    () =>
      new Response(
        `data: ${JSON.stringify({ type: "data-refused", data: { error: "model_unavailable" } })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  mount("chat-1");
  const user = userEvent.setup();
  await chatLoaded();
  await user.click(
    await screen.findByRole("button", { name: "Modell: Sonnet 5.5" }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Opus 5.5" }));
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Meine Frage",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Dieses Modell ist nicht mehr verfügbar. Wir haben auf Sonnet 5.5 gewechselt.",
    ),
  );
  expect(
    (screen.getByRole("textbox", { name: "Nachricht" }) as HTMLTextAreaElement)
      .value,
  ).toBe("Meine Frage");
  expect(
    screen.getByRole("button", { name: "Modell: Sonnet 5.5" }),
  ).toBeTruthy();
  expect(catalogs).toBe(2);
  await user.click(screen.getByRole("button", { name: "Modell: Sonnet 5.5" }));
  const rows = await screen.findAllByRole("menuitem");
  expect(rows.map((row) => row.textContent)).toEqual([
    "Haiku 5.5",
    "Sonnet 5.5",
  ]);
});

test("a saved answer names the model that wrote it", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({
      id: "chat-1",
      courses: [],
      messages: [
        {
          id: "q",
          role: "student",
          text: "Frage",
          parts: [{ type: "text", text: "Frage" }],
          createdAt: "2026-11-10T09:48:00Z",
          citations: [],
        },
        {
          id: "old",
          role: "assistant",
          text: "Alte Antwort",
          parts: [{ type: "text", text: "Alte Antwort" }],
          createdAt: "2026-11-10T09:48:00Z",
          citations: [],
          model: null,
        },
        {
          id: "new",
          role: "assistant",
          text: "Neue Antwort",
          parts: [{ type: "text", text: "Neue Antwort" }],
          createdAt: "2026-11-10T09:48:00Z",
          citations: [],
          model: { key: "opus-5.5", name: "Opus 5.5" },
        },
      ],
    }),
  );
  mount("chat-1");
  const answers = async (text: string) =>
    (await screen.findByText(text)).closest("[role=article]") as HTMLElement;
  expect((await answers("Neue Antwort")).textContent).toContain("Opus 5.5");
  const old = await answers("Alte Antwort");
  expect(old.textContent).not.toMatch(/5\.5/);
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
          parts: deleted
            ? []
            : [{ type: "text", text: "Privater Inhalt aus dem Handbuch." }],
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
      <SidebarProvider>
        <ChatScreen
          apiOrigin={api.origin}
          userId="student-1"
          userName="Justus"
        />
      </SidebarProvider>
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
                  parts: [
                    { type: "reasoning", text: "Ich prüfe deine Materialien." },
                    { type: "text", text: "Die gespeicherte Antwort." },
                  ],
                  createdAt: "2026-11-10T09:48:00Z",
                  citations: [],
                  question: {
                    id: "question-1",
                    role: "student",
                    text: "Meine Frage",
                    parts: [{ type: "text", text: "Meine Frage" }],
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
  await chatLoaded();
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
                parts: [{ type: "text", text: "Eine Antwort." }],
                createdAt: "2026-11-10T09:48:00Z",
                citations: [],
                question: {
                  id,
                  role: "student",
                  text: "Meine Frage",
                  parts: [{ type: "text", text: "Meine Frage" }],
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
  await chatLoaded();
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
      screen.queryByRole("button", { name: "Nachricht senden" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Antwort stoppen" }),
    ).toBeTruthy();
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
  expect(streamed.getAttribute("aria-busy")).toBeNull();
  expect(textarea.value).toBe("Nächste Frage");
});

test("shows each search as a step while answering, in the same element once saved, and again when reopened", async () => {
  const search = {
    type: "tool-searchMaterial",
    toolCallId: "call-1",
    input: { query: "Klausur Termin" },
    output: { found: 2, sources: ["Modulhandbuch.pdf"] },
  };
  const answer = {
    id: "answer-1",
    role: "assistant",
    text: "Am 10. Februar [S1].",
    parts: [search, { type: "text", text: "Am 10. Februar [S1]." }],
    createdAt: "2026-11-10T09:48:00Z",
    citations: [],
    model: null,
  };
  const saved: unknown[] = [];
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: saved }),
  );
  let finish = () => {};
  const encoder = new TextEncoder();
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    const { id } = (await request.json()) as { id: string };
    const question = {
      id,
      role: "student",
      text: "Wann ist die Klausur?",
      parts: [{ type: "text", text: "Wann ist die Klausur?" }],
      createdAt: "2026-11-10T09:48:00Z",
      citations: [],
      model: null,
    };
    return new Response(
      new ReadableStream({
        start(controller) {
          const emit = (data: unknown) =>
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          emit({ type: "start", messageId: "answer-1" });
          emit({ type: "start-step" });
          emit({
            type: "tool-input-available",
            toolCallId: "call-1",
            toolName: "searchMaterial",
            input: search.input,
          });
          emit({
            type: "tool-output-available",
            toolCallId: "call-1",
            output: search.output,
          });
          emit({ type: "finish-step" });
          emit({ type: "start-step" });
          emit({ type: "text-start", id: "text" });
          emit({ type: "text-delta", id: "text", delta: answer.text });
          finish = () => {
            emit({ type: "text-end", id: "text" });
            emit({ type: "finish-step" });
            saved.push(question, answer);
            emit({ type: "data-committed", data: { ...answer, question } });
            emit({ type: "finish" });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          };
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const { unmount } = mount("chat-1");
  await chatLoaded();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Wann ist die Klausur?",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  let step: HTMLElement;
  try {
    step = await screen.findByText("Durchsucht: „Klausur Termin“");
    expect(screen.getByText("2 Treffer in Modulhandbuch.pdf")).toBeTruthy();
  } finally {
    finish();
  }
  await screen.findByRole("article", { name: "Antwort von nunio" });
  expect(screen.getByText("Durchsucht: „Klausur Termin“")).toBe(step);
  unmount();

  mount("chat-1");
  expect(await screen.findByText("Durchsucht: „Klausur Termin“")).toBeTruthy();
  expect(screen.getByText("2 Treffer in Modulhandbuch.pdf")).toBeTruthy();
});

test("shows reading the Plan and a Course's Facts as steps, while answering and when reopened", async () => {
  const agenda = {
    type: "tool-agenda",
    toolCallId: "call-agenda",
    input: { from: "2026-11-16", to: "2026-11-22" },
    output: {
      from: "2026-11-16",
      to: "2026-11-22",
      obligations: 1,
      studyBlocks: 2,
      fixedEvents: 0,
    },
  };
  const facts = {
    type: "tool-courseFacts",
    toolCallId: "call-facts",
    input: { course: "K1" },
    output: { course: "Analysis I", facts: 9 },
  };
  const answer = {
    id: "answer-1",
    role: "assistant",
    text: "Blatt 3 ist fällig.",
    parts: [agenda, facts, { type: "text", text: "Blatt 3 ist fällig." }],
    createdAt: "2026-11-10T09:48:00Z",
    citations: [],
    model: null,
  };
  const saved: unknown[] = [];
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: saved }),
  );
  let finish = () => {};
  const encoder = new TextEncoder();
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    const { id } = (await request.json()) as { id: string };
    const question = {
      id,
      role: "student",
      text: "Was steht an?",
      parts: [{ type: "text", text: "Was steht an?" }],
      createdAt: "2026-11-10T09:48:00Z",
      citations: [],
      model: null,
    };
    return new Response(
      new ReadableStream({
        start(controller) {
          const emit = (data: unknown) =>
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
            );
          emit({ type: "start", messageId: "answer-1" });
          emit({ type: "start-step" });
          for (const part of [agenda, facts]) {
            emit({
              type: "tool-input-available",
              toolCallId: part.toolCallId,
              toolName: part.type.slice(5),
              input: part.input,
            });
            emit({
              type: "tool-output-available",
              toolCallId: part.toolCallId,
              output: part.output,
            });
          }
          emit({ type: "finish-step" });
          finish = () => {
            saved.push(question, answer);
            emit({ type: "data-committed", data: { ...answer, question } });
            emit({ type: "finish" });
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          };
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  const { unmount } = mount("chat-1");
  await chatLoaded();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Was steht an?",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  try {
    expect(await screen.findByText("Plan gelesen: 16.11.–22.11.")).toBeTruthy();
    expect(screen.getByText("1 Frist, 2 Lernblöcke, 0 Termine")).toBeTruthy();
    expect(screen.getByText("Kursinfos gelesen: Analysis I")).toBeTruthy();
    expect(screen.getByText("9 Einträge")).toBeTruthy();
  } finally {
    finish();
  }
  await screen.findByRole("article", { name: "Antwort von nunio" });
  unmount();

  mount("chat-1");
  expect(await screen.findByText("Plan gelesen: 16.11.–22.11.")).toBeTruthy();
  expect(screen.getByText("Kursinfos gelesen: Analysis I")).toBeTruthy();
});

test("a saved proposal asks at the composer, and approving it there streams nunio's report", async () => {
  const question = {
    id: "question-1",
    role: "student",
    text: "Plane Blatt 4 ein.",
    parts: [{ type: "text", text: "Plane Blatt 4 ein." }],
    createdAt: "2026-11-10T09:48:00Z",
    citations: [],
    model: null,
  };
  const answer = (status: string, decision: string | null) => ({
    id: "answer-1",
    role: "assistant",
    text: "Hier ist mein Vorschlag.",
    parts: [
      { type: "text", text: "Hier ist mein Vorschlag." },
      blockProposal("1", status, decision),
    ],
    createdAt: "2026-11-10T09:48:00Z",
    citations: [],
    model: null,
  });
  const report = {
    id: "report-1",
    role: "assistant",
    text: "Erledigt, der Block steht.",
    parts: [{ type: "text", text: "Erledigt, der Block steht." }],
    createdAt: "2026-11-10T09:50:00Z",
    citations: [],
    model: null,
  };
  let saved: unknown[] = [question, answer("awaiting_approval", null)];
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: saved }),
  );
  const sent: unknown[] = [];
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    sent.push(await request.json());
    saved = [question, answer("done", "approved"), report];
    return reportStream(report);
  });
  mount("chat-1");
  await chatLoaded();
  const tray = await screen.findByRole("region", { name: "Vorschlag prüfen" });
  expect(
    within(tray).getByRole("heading", {
      name: "Neuen Lernblock am Freitag von 10 bis 12 Uhr hinzufügen?",
    }),
  ).toBeTruthy();
  expect(within(tray).getByText("1 / 1")).toBeTruthy();
  expect(screen.getByText("Wartet auf dich")).toBeTruthy();

  await userEvent
    .setup()
    .click(within(tray).getByRole("button", { name: "Annehmen" }));

  expect(await screen.findByText("Erledigt, der Block steht.")).toBeTruthy();
  expect(sent).toEqual([
    {
      decisions: [
        {
          approvalId: "approval-1",
          decision: "approve",
          fingerprint: "fingerprint-1",
        },
      ],
      model: "sonnet-5.5",
    },
  ]);
  expect(await screen.findByText("Angelegt")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Vorschlag prüfen" })).toBeNull();
});

test("an answer's proposals are decided one by one, and only the last decision sends them all", async () => {
  const answer = {
    id: "answer-1",
    role: "assistant",
    text: "Zwei Vorschläge.",
    parts: [
      { type: "text", text: "Zwei Vorschläge." },
      blockProposal("1", "awaiting_approval", null),
      blockProposal("2", "awaiting_approval", null),
    ],
    createdAt: "2026-11-10T09:48:00Z",
    citations: [],
    model: null,
  };
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [answer] }),
  );
  const sent: unknown[] = [];
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    sent.push(await request.json());
    return reportStream({
      id: "report-1",
      text: "Einen habe ich eingetragen.",
    });
  });
  mount("chat-1");
  await chatLoaded();
  const user = userEvent.setup();
  const tray = () => screen.getByRole("region", { name: "Vorschläge prüfen" });
  await screen.findByRole("region", { name: "Vorschläge prüfen" });
  expect(within(tray()).getByText("1 / 2")).toBeTruthy();
  expect(within(tray()).queryByRole("button", { name: "Zurück" })).toBeNull();

  await user.click(within(tray()).getByRole("button", { name: "Annehmen" }));
  expect(within(tray()).getByText("2 / 2")).toBeTruthy();
  expect(sent).toEqual([]);
  await user.click(within(tray()).getByRole("button", { name: "Zurück" }));
  expect(within(tray()).getByText("1 / 2")).toBeTruthy();
  await user.click(within(tray()).getByRole("button", { name: "Ablehnen" }));
  await user.click(within(tray()).getByRole("button", { name: "Annehmen" }));

  expect(await screen.findByText("Einen habe ich eingetragen.")).toBeTruthy();
  expect(sent).toEqual([
    {
      decisions: [
        { approvalId: "approval-1", decision: "deny" },
        {
          approvalId: "approval-2",
          decision: "approve",
          fingerprint: "fingerprint-2",
        },
      ],
      model: "sonnet-5.5",
    },
  ]);
});

test("when sending the decisions fails, they stay noted and the last card sends them again", async () => {
  const answer = {
    id: "answer-1",
    role: "assistant",
    text: "Zwei Vorschläge.",
    parts: [
      { type: "text", text: "Zwei Vorschläge." },
      blockProposal("1", "awaiting_approval", null),
      blockProposal("2", "awaiting_approval", null),
    ],
    createdAt: "2026-11-10T09:48:00Z",
    citations: [],
    model: null,
  };
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [answer] }),
  );
  const sent: unknown[] = [];
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    sent.push(await request.json());
    return sent.length === 1
      ? Response.json({ error: "unavailable" }, { status: 503 })
      : reportStream({ id: "report-1", text: "Beide eingetragen." });
  });
  mount("chat-1");
  await chatLoaded();
  const user = userEvent.setup();
  const tray = () => screen.getByRole("region", { name: "Vorschläge prüfen" });
  await screen.findByRole("region", { name: "Vorschläge prüfen" });
  await user.click(within(tray()).getByRole("button", { name: "Annehmen" }));
  await user.click(within(tray()).getByRole("button", { name: "Annehmen" }));

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(within(tray()).getByText("2 / 2")).toBeTruthy();
  await user.click(within(tray()).getByRole("button", { name: "Annehmen" }));

  expect(await screen.findByText("Beide eingetragen.")).toBeTruthy();
  expect(sent).toHaveLength(2);
  expect(sent[1]).toEqual(sent[0]);
  expect((sent[1] as { decisions: unknown[] }).decisions).toHaveLength(2);
});

test("an Action nunio could not confirm is asked about first, and the answer is saved at once", async () => {
  const answer = (id: string, proposal: unknown) => ({
    id,
    role: "assistant",
    text: "Vorschlag.",
    parts: [{ type: "text", text: "Vorschlag." }, proposal],
    createdAt: "2026-11-10T09:48:00Z",
    citations: [],
    model: null,
  });
  let unconfirmed = "unconfirmed";
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({
      id: "chat-1",
      courses: [],
      messages: [
        answer("answer-1", blockProposal("1", unconfirmed, "approved")),
        answer("answer-2", blockProposal("2", "awaiting_approval", null)),
      ],
    }),
  );
  const resolved: unknown[] = [];
  api.route("POST", "/api/me/actions/action-1/resolve", async (request) => {
    resolved.push(await request.json());
    unconfirmed = "done";
    return Response.json({});
  });
  const streamed: unknown[] = [];
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    streamed.push(await request.json());
    return Response.json({ error: "unexpected" }, { status: 500 });
  });
  mount("chat-1");
  await chatLoaded();
  const asked = await screen.findByRole("region", { name: "Nicht bestätigt" });
  expect(
    within(asked).getByRole("heading", {
      name: "Wurde dein Lernblock am Freitag angelegt?",
    }),
  ).toBeTruthy();
  expect(within(asked).getByText("1 / 1")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Vorschlag prüfen" })).toBeNull();

  await userEvent
    .setup()
    .click(within(asked).getByRole("button", { name: "Ist passiert" }));

  expect(
    await screen.findByRole("region", { name: "Vorschlag prüfen" }),
  ).toBeTruthy();
  expect(resolved).toEqual([{ resolution: "happened" }]);
  expect(streamed).toEqual([]);
  expect(screen.queryByRole("region", { name: "Nicht bestätigt" })).toBeNull();
});

test("the keyboard follows the cards: each new card focuses its first button, and sending returns to the composer", async () => {
  const answer = {
    id: "answer-1",
    role: "assistant",
    text: "Zwei Vorschläge.",
    parts: [
      { type: "text", text: "Zwei Vorschläge." },
      blockProposal("1", "awaiting_approval", null),
      blockProposal("2", "awaiting_approval", null),
    ],
    createdAt: "2026-11-10T09:48:00Z",
    citations: [],
    model: null,
  };
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [answer] }),
  );
  api.route("POST", "/api/me/chats/chat-1/messages/stream", () =>
    reportStream({ id: "report-1", text: "Erledigt." }),
  );
  mount("chat-1");
  await chatLoaded();
  const user = userEvent.setup();
  const tray = await screen.findByRole("region", { name: "Vorschläge prüfen" });

  await user.click(within(tray).getByRole("button", { name: "Annehmen" }));
  expect(document.activeElement).toBe(
    within(screen.getByRole("region", { name: "Vorschläge prüfen" })).getByRole(
      "button",
      { name: "Ablehnen" },
    ),
  );
  await user.keyboard("{Enter}");

  expect(await screen.findByText("Erledigt.")).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Nachricht" }),
    ),
  );
});

test("with two answers' proposals waiting, the older answer's are asked first and counted alone", async () => {
  const later = {
    ...blockProposal("2", "awaiting_approval", null),
  };
  later.action.shown = {
    ...later.action.shown,
    to: { start: at(23, 10), end: at(23, 12) },
  };
  const answer = (id: string, proposal: unknown) => ({
    id,
    role: "assistant",
    text: "Vorschlag.",
    parts: [{ type: "text", text: "Vorschlag." }, proposal],
    createdAt: "2026-11-10T09:48:00Z",
    citations: [],
    model: null,
  });
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({
      id: "chat-1",
      courses: [],
      messages: [
        answer("answer-1", blockProposal("1", "awaiting_approval", null)),
        answer("answer-2", later),
      ],
    }),
  );
  mount("chat-1");
  await chatLoaded();

  const tray = await screen.findByRole("region", { name: "Vorschlag prüfen" });

  expect(within(tray).getByText("1 / 1")).toBeTruthy();
  expect(
    within(tray).getByRole("heading", {
      name: "Neuen Lernblock am Freitag von 10 bis 12 Uhr hinzufügen?",
    }),
  ).toBeTruthy();
});

test("once the decisions arrive the card goes, and the rows read as being saved until nunio has answered", async () => {
  const answer = {
    id: "answer-1",
    role: "assistant",
    text: "Zwei Vorschläge.",
    parts: [
      { type: "text", text: "Zwei Vorschläge." },
      blockProposal("1", "awaiting_approval", null),
      blockProposal("2", "awaiting_approval", null),
    ],
    createdAt: "2026-11-10T09:48:00Z",
    citations: [],
    model: null,
  };
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [answer] }),
  );
  let finish = () => {};
  api.route("POST", "/api/me/chats/chat-1/messages/stream", () => {
    const report = reportStream({ id: "report-1", text: "Fertig." }).body!;
    return new Response(
      new ReadableStream({
        async start(controller) {
          const reader = report.getReader();
          const first = await reader.read();
          controller.enqueue(first.value);
          finish = async () => {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            controller.close();
          };
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  mount("chat-1");
  await chatLoaded();
  const user = userEvent.setup();
  const tray = await screen.findByRole("region", { name: "Vorschläge prüfen" });
  await user.click(within(tray).getByRole("button", { name: "Annehmen" }));
  await user.click(
    within(screen.getByRole("region", { name: "Vorschläge prüfen" })).getByRole(
      "button",
      { name: "Ablehnen" },
    ),
  );

  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Vorschläge prüfen" }),
    ).toBeNull(),
  );
  expect(screen.getAllByText("Wird gespeichert")).toHaveLength(2);
  expect(screen.queryByText("Wartet auf dich")).toBeNull();
  finish();
  expect(await screen.findByText("Fertig.")).toBeTruthy();
});

test("after the student says whether an unconfirmed Action happened, the next card takes focus", async () => {
  let unconfirmed = "unconfirmed";
  const answer = (id: string, proposal: unknown) => ({
    id,
    role: "assistant",
    text: "Vorschlag.",
    parts: [{ type: "text", text: "Vorschlag." }, proposal],
    createdAt: "2026-11-10T09:48:00Z",
    citations: [],
    model: null,
  });
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({
      id: "chat-1",
      courses: [],
      messages: [
        answer("answer-1", blockProposal("1", unconfirmed, "approved")),
        answer("answer-2", blockProposal("2", "awaiting_approval", null)),
      ],
    }),
  );
  api.route("POST", "/api/me/actions/action-1/resolve", () => {
    unconfirmed = "failed";
    return Response.json({});
  });
  mount("chat-1");
  await chatLoaded();
  const asked = await screen.findByRole("region", { name: "Nicht bestätigt" });

  await userEvent
    .setup()
    .click(within(asked).getByRole("button", { name: "Ist nicht passiert" }));

  const tray = await screen.findByRole("region", { name: "Vorschlag prüfen" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      within(tray).getByRole("button", { name: "Ablehnen" }),
    ),
  );
  expect(screen.getByText("Nicht passiert")).toBeTruthy();
});

test("shows a removal the student approved as removed (ADR-0021)", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({
      id: "chat-1",
      courses: [],
      messages: [
        {
          id: "answer-1",
          role: "assistant",
          text: "Soll ich ihn entfernen?",
          parts: [
            { type: "text", text: "Soll ich ihn entfernen?" },
            {
              type: "tool-proposeStudyBlockRemove",
              toolCallId: "call-1",
              input: { block: "B1" },
              approvalId: "approval-1",
              notes: [],
              action: {
                id: "action-1",
                fingerprint: null,
                expiresAt: null,
                status: "done",
                decision: "approved",
                shown: {
                  kind: "studyBlock.remove",
                  work: { title: "Übungsblatt 4", course: "Analysis I" },
                  from: {
                    start: "2026-11-20T09:00:00Z",
                    end: "2026-11-20T11:00:00Z",
                  },
                  to: null,
                },
              },
            },
          ],
          createdAt: "2026-11-10T09:48:00Z",
          citations: [],
          model: null,
        },
      ],
    }),
  );
  mount("chat-1");
  await chatLoaded();

  expect(await screen.findByText("Entfernt")).toBeTruthy();
});

test("a proposal streams as a line until its answer is saved, then asks once at the composer", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  const input = {
    work: "O1",
    start: "2026-11-20T10:00",
    end: "2026-11-20T12:00",
  };
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
          emit({ type: "start-step" });
          emit({
            type: "tool-input-available",
            toolCallId: "call-1",
            toolName: "proposeStudyBlock",
            input,
          });
          emit({
            type: "tool-approval-request",
            approvalId: "approval-1",
            toolCallId: "call-1",
          });
          emit({ type: "finish-step" });
          finish = () => {
            emit({
              type: "data-committed",
              data: {
                id: "answer-1",
                role: "assistant",
                text: "",
                parts: [blockProposal("1", "awaiting_approval", null)],
                createdAt: "2026-11-10T09:48:00Z",
                citations: [],
                model: null,
                question: {
                  id,
                  role: "student",
                  text: "Plane Blatt 4 ein.",
                  parts: [{ type: "text", text: "Plane Blatt 4 ein." }],
                  createdAt: "2026-11-10T09:48:00Z",
                  citations: [],
                  model: null,
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
  await chatLoaded();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Plane Blatt 4 ein.",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  try {
    expect(
      await screen.findByText("Vorschlag wird gespeichert …"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: "Vorschlag prüfen" }),
    ).toBeNull();
  } finally {
    finish();
  }
  expect(
    await screen.findByRole("region", { name: "Vorschlag prüfen" }),
  ).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Annehmen" })).toHaveLength(1);
  expect(screen.getByText("Wartet auf dich")).toBeTruthy();
  expect(screen.queryByText("Vorschlag wird gespeichert …")).toBeNull();
});

test("shows a practice set started in an answer as a step and a card linking to it", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({
      id: "chat-1",
      courses: [],
      messages: [
        {
          id: "question-1",
          role: "student",
          text: "Gib mir Übungsaufgaben.",
          parts: [{ type: "text", text: "Gib mir Übungsaufgaben." }],
          createdAt: "2026-11-10T09:48:00Z",
          citations: [],
          model: null,
        },
        {
          id: "answer-1",
          role: "assistant",
          text: "Ich erstelle dir ein Practice Set.",
          parts: [
            {
              type: "tool-startPracticeSet",
              toolCallId: "call-1",
              input: { topics: ["S2", "S3"] },
              output: { kind: "practice_set", topics: 2, artifactId: "art-1" },
              artifact: { status: "ready" },
            },
            { type: "text", text: "Ich erstelle dir ein Practice Set." },
          ],
          createdAt: "2026-11-10T09:48:00Z",
          citations: [],
          model: null,
        },
      ],
    }),
  );
  mount("chat-1");

  expect(await screen.findByText("Practice Set gestartet")).toBeTruthy();
  expect(screen.getByText("2 Topics")).toBeTruthy();
  expect(screen.getByText("fertig")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "Practice Set öffnen" })
      .getAttribute("href"),
  ).toBe("/study/artifacts/art-1");
});

test("the waiting status stays until the first word when nunio does not reason", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  let write = () => {};
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
            write = () => {
              emit({ type: "text-start", id: "answer" });
              emit({
                type: "text-delta",
                id: "answer",
                delta: "Das erste Wort.",
              });
            };
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  mount("chat-1");
  await chatLoaded();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Meine Frage",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  await waitFor(() =>
    expect(
      screen.getByRole("article", { name: "Laufende Antwort" }).textContent,
    ).toContain("Denkt nach …"),
  );
  write();
  await screen.findByText("Das erste Wort.");
  await waitFor(() => expect(screen.queryByText("Denkt nach …")).toBeNull());
  expect(screen.queryByRole("button", { name: /Gedankengang/ })).toBeNull();
  expect(
    screen
      .getByRole("article", { name: "Laufende Antwort" })
      .getAttribute("aria-busy"),
  ).toBe("true");
});

test("one answer element carries the waiting line, open reasoning and text until the turn is saved", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  const steps: (() => void)[] = [];
  const encoder = new TextEncoder();
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    const { id } = (await request.json()) as { id: string };
    return new Response(
      new ReadableStream({
        start(controller) {
          const emit = (...chunks: unknown[]) => {
            for (const chunk of chunks)
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
              );
          };
          steps.push(
            () => emit({ type: "start", messageId: "answer-1" }),
            () =>
              emit(
                { type: "reasoning-start", id: "reasoning" },
                {
                  type: "reasoning-delta",
                  id: "reasoning",
                  delta: "Ich prüfe.",
                },
              ),
            () =>
              emit(
                { type: "reasoning-end", id: "reasoning" },
                { type: "text-start", id: "answer" },
                { type: "text-delta", id: "answer", delta: "Die Antwort." },
              ),
            () => {
              emit(
                { type: "text-end", id: "answer" },
                {
                  type: "data-committed",
                  data: {
                    id: "answer-1",
                    role: "assistant",
                    text: "Die Antwort.",
                    reasoning: "Ich prüfe.",
                    parts: [
                      { type: "reasoning", text: "Ich prüfe." },
                      { type: "text", text: "Die Antwort." },
                    ],
                    createdAt: "2026-11-10T09:48:00Z",
                    citations: [],
                    question: {
                      id,
                      role: "student",
                      text: "Meine Frage",
                      parts: [{ type: "text", text: "Meine Frage" }],
                      createdAt: "2026-11-10T09:48:00Z",
                      citations: [],
                    },
                  },
                },
                { type: "finish" },
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          );
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  });
  mount("chat-1");
  await chatLoaded();
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Nachricht" }),
    "Meine Frage",
  );
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  const answer = await screen.findByRole("article", {
    name: "Laufende Antwort",
  });
  try {
    expect(answer.getAttribute("aria-busy")).toBe("true");
    expect(
      screen.getByText("Denkt nach …").closest('[role="status"]'),
    ).not.toBeNull();
    await waitFor(() => expect(steps).toHaveLength(4));
    steps.shift()!();
    steps.shift()!();
    const reasoning = await screen.findByRole("button", {
      name: "Denkt nach …",
    });
    expect(reasoning.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("article", { name: "Laufende Antwort" })).toBe(
      answer,
    );
    steps.shift()!();
    await screen.findByText("Die Antwort.");
    expect(
      screen
        .getByRole("button", { name: "Gedankengang" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    const writing = screen.getByText("Antwort wird geschrieben …");
    expect(writing.getAttribute("role")).toBe("status");
    expect(answer.contains(writing)).toBe(false);
  } finally {
    for (const step of steps.splice(0)) step();
  }
  await waitFor(() =>
    expect(screen.getByRole("article", { name: "Antwort von nunio" })).toBe(
      answer,
    ),
  );
  expect(
    screen
      .getByRole("button", { name: "Gedankengang" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
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
  await chatLoaded();
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
  await chatLoaded();
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

/** A stream that sends `chunks` and stays open until `close` is called. */
function heldStream(chunks: unknown[]) {
  let close = () => {};
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            chunks
              .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
              .join(""),
          ),
        );
        close = () => controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
  return { response, close: () => close() };
}
const started = [
  { type: "start", messageId: "answer-1" },
  { type: "text-start", id: "answer" },
  { type: "text-delta", id: "answer", delta: "Ein Anfang" },
];

test("Stop keeps what was typed meanwhile, after the stopped question", async () => {
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: [] }),
  );
  const stream = heldStream(started);
  api.route(
    "POST",
    "/api/me/chats/chat-1/messages/stream",
    () => stream.response,
  );
  mount("chat-1");
  await chatLoaded();
  const user = userEvent.setup();
  const textarea = screen.getByRole("textbox", {
    name: "Nachricht",
  }) as HTMLTextAreaElement;
  try {
    await user.type(textarea, "Meine Frage");
    await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
    await screen.findByText("Ein Anfang");
    await user.type(textarea, "Nachtrag");
    await user.click(screen.getByRole("button", { name: "Antwort stoppen" }));
    await screen.findByRole("alert");
    expect(textarea.value).toBe("Meine Frage\n\nNachtrag");
  } finally {
    stream.close();
  }
});

test("Stop while the Chat is being created doesn't open it", async () => {
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
  mount();
  const user = userEvent.setup();
  const textarea = screen.getByRole("textbox", {
    name: "Nachricht",
  }) as HTMLTextAreaElement;
  await user.type(textarea, "Meine Frage");
  await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
  try {
    await user.click(
      await screen.findByRole("button", { name: "Antwort stoppen" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "gestoppt",
    );
    expect(textarea.value).toBe("Meine Frage");
  } finally {
    create();
  }
  // No stream route is registered: a send after creation would fail the test.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(window.location.search).toBe("");
  expect(screen.getByRole("heading", { name: /Justus/ })).toBeTruthy();
});

test("a turn saved before Stop took effect stays in the Chat, not in the composer", async () => {
  let saved: unknown[] = [];
  api.route("GET", "/api/me/chats/chat-1", () =>
    Response.json({ id: "chat-1", courses: [], messages: saved }),
  );
  const stream = heldStream(started);
  api.route("POST", "/api/me/chats/chat-1/messages/stream", async (request) => {
    const { id } = (await request.json()) as { id: string };
    const createdAt = "2026-11-10T09:48:00Z";
    saved = [
      {
        id,
        role: "student",
        text: "Meine Frage",
        parts: [{ type: "text", text: "Meine Frage" }],
        citations: [],
        createdAt,
      },
      {
        id: "answer-1",
        role: "assistant",
        text: "Ein Anfang und mehr.",
        parts: [{ type: "text", text: "Ein Anfang und mehr." }],
        citations: [],
        createdAt,
      },
    ];
    return stream.response;
  });
  mount("chat-1");
  await chatLoaded();
  const user = userEvent.setup();
  const textarea = screen.getByRole("textbox", {
    name: "Nachricht",
  }) as HTMLTextAreaElement;
  try {
    await user.type(textarea, "Meine Frage");
    await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
    await screen.findByText("Ein Anfang");
    await user.click(screen.getByRole("button", { name: "Antwort stoppen" }));
    await screen.findByText("Ein Anfang und mehr.");
    await waitFor(() => expect(textarea.value).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getAllByRole("article", { name: "Deine Nachricht" }),
    ).toHaveLength(1);
  } finally {
    stream.close();
  }
});

test("deleting a Source while an answer streams withdraws earlier answers and keeps the stream", async () => {
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
          parts: deleted
            ? []
            : [{ type: "text", text: "Privater Inhalt aus dem Handbuch." }],
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
  const stream = heldStream(started);
  api.route(
    "POST",
    "/api/me/chats/chat-1/messages/stream",
    () => stream.response,
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  navigation.params = new URLSearchParams({ id: "chat-1" });
  render(
    <TestProviders>
      <SourcesScreen apiOrigin={api.origin} />
      <SidebarProvider>
        <ChatScreen
          apiOrigin={api.origin}
          userId="student-1"
          userName="Justus"
        />
      </SidebarProvider>
    </TestProviders>,
  );
  await screen.findByText("Privater Inhalt aus dem Handbuch.");
  const user = userEvent.setup();
  try {
    await user.type(
      screen.getByRole("textbox", { name: "Nachricht" }),
      "Meine Frage",
    );
    await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
    await screen.findByText("Ein Anfang");
    const streaming = screen.getByRole("article", { name: "Laufende Antwort" });
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await screen.findByText(/Diese Antwort wurde entfernt/);
    expect(screen.queryByText("Privater Inhalt aus dem Handbuch.")).toBeNull();
    expect(screen.getByRole("article", { name: "Laufende Antwort" })).toBe(
      streaming,
    );
    expect(screen.getByText("Ein Anfang")).toBeTruthy();
  } finally {
    stream.close();
  }
});
