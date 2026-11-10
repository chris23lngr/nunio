import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { SourcesScreen } from "@/features/sources/sources-screen";
import { api } from "@/test/api";
import { TestProviders } from "@/test/providers";
import { ChatScreen } from "./chat-screen";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const course = {
  id: "course-1",
  title: "Microeconomics",
  code: "MICD",
  status: "accepted",
};
beforeEach(() => {
  replace.mockReset();
  api.route("GET", "/api/me/review", () =>
    Response.json({ courses: [course] }),
  );
});
function mount(chatId: string | null = null) {
  return render(
    <TestProviders>
      <ChatScreen
        apiOrigin={api.origin}
        chatId={chatId}
        userName="Justus Schuhmacher"
      />
    </TestProviders>,
  );
}
test("a suggested prompt populates the composer without sending", async () => {
  mount();
  const user = userEvent.setup();
  const prompt = screen.getByRole("button", {
    name: "Wie sieht mein Lernplan für heute aus?",
  });
  await user.click(prompt);
  expect(
    (screen.getByRole("textbox", { name: "Nachricht" }) as HTMLTextAreaElement)
      .value,
  ).toBe("Wie sieht mein Lernplan für heute aus?");
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: /Justus/ })).toBeTruthy();
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
  api.route("POST", "/api/me/chats/chat-1/messages", async (request) => {
    expect(await request.json()).toEqual({ text: "Erkläre die Grundlagen" });
    return Response.json({ ...answer, question });
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
  expect(screen.queryByRole("button", { name: "Kurs auswählen" })).toBeNull();
  expect(
    (screen.getByRole("textbox", { name: "Nachricht" }) as HTMLTextAreaElement)
      .value,
  ).toBe("");
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith("/chat?id=chat-1", { scroll: false }),
  );
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
  const link = await screen.findByRole("link", {
    name: "Handbuch.pdf, Seite 2",
  });
  expect(link.getAttribute("href")).toBe("/sources/source-1?page=2");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(screen.getByText("Microeconomics")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Kurs auswählen" })).toBeNull();
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
  api.route("POST", "/api/me/chats/chat-1/messages", () => {
    asks++;
    return asks === 1
      ? Response.json({ error: "allowance_exhausted" }, { status: 403 })
      : Response.json({
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
  render(
    <TestProviders>
      <SourcesScreen apiOrigin={api.origin} />
      <ChatScreen apiOrigin={api.origin} chatId="chat-1" userName="Justus" />
    </TestProviders>,
  );
  await screen.findByText("Privater Inhalt aus dem Handbuch.");
  await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
  await screen.findByText(/Diese Antwort wurde entfernt/);
  expect(screen.queryByText("Privater Inhalt aus dem Handbuch.")).toBeNull();
});
