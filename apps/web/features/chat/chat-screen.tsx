"use client";

import { useChat } from "@ai-sdk/react";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@nunio/ui/components/message-scroller/message-scroller";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { SidebarOpenButton } from "@/features/shared/components/sidebar-open-button";
import { useAppForm } from "@/lib/form";
import {
  answerError,
  chatTransport,
  createChat,
  failureMessage,
} from "./api/chat-mutations";
import type { ChatUIMessage, Turn } from "./api/chat-queries";
import {
  chatCourseQueries,
  chatQueries,
  messageText,
  toUIMessage,
} from "./api/chat-queries";
import { ChatComposer } from "./components/chat-composer";
import { ChatEmptyState } from "./components/chat-empty-state";
import { ChatHeader } from "./components/chat-header";
import { ChatMessage } from "./components/chat-message";
import { KnowledgeSelector } from "./components/knowledge-selector";
import { ModelSelector } from "./components/model-selector";

/** The messages before the question `questionId`, or all of them when it isn't there. */
function beforeQuestion(messages: ChatUIMessage[], questionId: string) {
  const index = messages.findIndex((message) => message.id === questionId);
  return index === -1 ? messages : messages.slice(0, index);
}

const waitingAnswer: ChatUIMessage = {
  id: "waiting",
  role: "assistant",
  parts: [],
};

/** An answer is keyed by its question, so it keeps one element from waiting to saved. */
function itemKey(messages: ChatUIMessage[], index: number) {
  const message = messages[index]!;
  const before = messages[index - 1];
  return message.role === "assistant" && before?.role === "user"
    ? `answer-to-${before.id}`
    : message.id;
}

// The models of packages/ai; Chat answers use its "explanation" default. Display only until
// students can choose one.
const models = [
  {
    id: "anthropic/claude-haiku-5.5",
    name: "Haiku 5.5",
    provider: "Anthropic",
    description: "Schnell und sparsam für kurze, klare Aufgaben.",
  },
  {
    id: "anthropic/claude-sonnet-5.5",
    name: "Sonnet 5.5",
    provider: "Anthropic",
    description: "Ausgewogen für Erklärungen und alltägliches Lernen.",
  },
  {
    id: "anthropic/claude-opus-5.5",
    name: "Opus 5.5",
    provider: "Anthropic",
    description: "Am gründlichsten für anspruchsvolle, lange Aufgaben.",
  },
];
const chatModel = "anthropic/claude-sonnet-5.5";

const prompts = [
  "Was habe ich heute noch in BWL1 zu tun?",
  "Erstelle mir Flashcards für FOF1",
  "Wie sieht mein Lernplan für heute aus?",
  "Welche Abgaben habe ich diese Woche?",
];

export function ChatScreen({
  apiOrigin,
  userName,
}: {
  apiOrigin: string;
  userName: string;
}) {
  const routeId = useSearchParams().get("id");
  const client = useQueryClient();
  // The open Chat; `key` stays the same when a new Chat is created on its first send.
  const [openChat, setOpenChat] = useState(() => ({
    key: routeId ?? crypto.randomUUID(),
    id: routeId,
  }));
  const shownRouteId = useRef(routeId);
  const id = openChat.id;
  const chat = useQuery(chatQueries(apiOrigin, id));
  const courses = useQuery({ ...chatCourseQueries(apiOrigin), enabled: !id });
  const create = useMutation(createChat(apiOrigin));
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The turn being answered: its question, draft, and outcome once known.
  const turn = useRef<{
    key: string;
    questionId: string;
    draft: string;
    committed?: Turn;
    refused?: string;
  } | null>(null);
  // A draft put back after a failed turn, undone if a refetch shows the turn was saved after all.
  const restored = useRef<{
    questionId: string;
    composer: string;
    before: string;
  } | null>(null);
  // Read by the transport, which outlives renders.
  const sendContext = useRef({ openChat, courseIds: [] as string[] });
  sendContext.current.openChat = openChat;

  const transport = useMemo(
    () =>
      chatTransport(apiOrigin, async (signal) => {
        const { key, id } = sendContext.current.openChat;
        if (id) return id;
        const courseIds = sendContext.current.courseIds;
        const created = await create.mutateAsync({ courseIds, signal });
        if (signal?.aborted || sendContext.current.openChat.key !== key)
          throw new DOMException("The Chat was left", "AbortError");
        shownRouteId.current = created;
        sendContext.current.openChat = { key, id: created };
        setOpenChat({ key, id: created });
        window.history.replaceState(null, "", `/chat?id=${created}`);
        return created;
      }),
    [apiOrigin, create.mutateAsync],
  );

  const refresh = () => {
    const { id } = sendContext.current.openChat;
    if (id) void client.invalidateQueries(chatQueries(apiOrigin, id));
  };

  const fail = (message: string) => {
    const current = turn.current;
    if (!current || current.key !== sendContext.current.openChat.key) return;
    turn.current = null;
    setMessages((messages) => beforeQuestion(messages, current.questionId));
    // Keep what was typed meanwhile, after the question that didn't get an answer.
    const before = form.getFieldValue("text");
    const composer = before ? `${current.draft}\n\n${before}` : current.draft;
    form.setFieldValue("text", composer);
    restored.current = { questionId: current.questionId, composer, before };
    setError(message);
    refresh();
  };

  const { messages, setMessages, sendMessage, status, stop } =
    useChat<ChatUIMessage>({
      id: openChat.key,
      transport,
      throttle: 50,
      onData: (part) => {
        if (!turn.current) return;
        if (part.type === "data-committed") turn.current.committed = part.data;
        if (part.type === "data-refused")
          turn.current.refused = part.data.error;
      },
      onError: (cause) => fail(failureMessage(cause)),
      onFinish: ({ isAbort, isError }) => {
        const current = turn.current;
        if (!current || isError) return;
        if (isAbort)
          return fail("Antwort gestoppt. Deine Nachricht bleibt erhalten.");
        if (!current.committed)
          return fail(answerError(current.refused).message);
        const { question, ...answer } = current.committed;
        turn.current = null;
        setMessages((messages) => [
          ...beforeQuestion(messages, current.questionId),
          toUIMessage(question),
          toUIMessage(answer),
        ]);
        refresh();
      },
    });

  const form = useAppForm({
    defaultValues: { text: "", courseIds: [] as string[] },
    onSubmit: ({ value }) => {
      const text = value.text.trim();
      if (!text || text.length > 4000 || busy) return;
      const questionId = crypto.randomUUID();
      turn.current = { key: openChat.key, questionId, draft: value.text };
      restored.current = null;
      sendContext.current.courseIds = value.courseIds;
      setError(null);
      create.reset();
      form.setFieldValue("text", "");
      void sendMessage({
        id: questionId,
        role: "user",
        parts: [{ type: "text", text }],
      });
    },
  });

  // Saved history comes from the query; a refetch, such as after a Source is deleted, replaces
  // the saved messages and keeps any turn still being answered after them.
  useEffect(() => {
    if (!chat.data) return;
    const saved = chat.data.messages.map(toUIMessage);
    const ids = new Set(saved.map((message) => message.id));
    setMessages((current) => [
      ...saved,
      ...current.filter((message) => !ids.has(message.id)),
    ]);
    // Stop can arrive after the turn was saved; then it's in the history and not a draft.
    const draft = restored.current;
    if (draft && ids.has(draft.questionId)) {
      restored.current = null;
      if (form.getFieldValue("text") === draft.composer) {
        form.setFieldValue("text", draft.before);
        setError(null);
      }
    }
  }, [chat.data, setMessages, form]);

  useEffect(() => {
    if (shownRouteId.current === routeId) return;
    shownRouteId.current = routeId;
    turn.current = null;
    restored.current = null;
    setOpenChat({ key: routeId ?? crypto.randomUUID(), id: routeId });
    setError(null);
    form.reset();
    create.reset();
  }, [routeId, form, create.reset]);

  const busy = status === "submitted" || status === "streaming";
  const last = messages.at(-1);
  const alertMessage = error ?? chat.error?.message;
  const started = !!id || messages.length > 0;
  // Until the stream starts the answer, a waiting answer stands in under the same key.
  const shown =
    busy && last?.role === "user" ? [...messages, waitingAnswer] : messages;
  const writing =
    busy && last?.role === "assistant" && messageText(last) !== "";

  return (
    <main
      className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-white font-sans text-base-800"
      aria-label="Chat"
    >
      <ChatHeader>
        <SidebarOpenButton inline />
        <ModelSelector models={models} value={chatModel} />
      </ChatHeader>
      <MessageScrollerProvider
        key={openChat.key}
        autoScroll
        defaultScrollPosition="end"
      >
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport
            aria-label="Nachrichten"
            className="px-4 pt-16"
          >
            {!started ? (
              <ChatEmptyState
                firstName={userName.split(" ")[0] ?? ""}
                prompts={prompts}
                onPrompt={(prompt) => {
                  form.setFieldValue("text", prompt);
                  textarea.current?.focus();
                }}
              />
            ) : (
              // The bottom space keeps the last message clear of the composer that overlaps the list.
              <MessageScrollerContent className="mx-auto w-full max-w-[832px] gap-10 pt-6 pb-24">
                {id && chat.isPending && <p role="status">Chat laden …</p>}
                {shown.map((message, index) => {
                  const key = itemKey(shown, index);
                  return (
                    <MessageScrollerItem
                      key={key}
                      messageId={key}
                      scrollAnchor={message.role === "user"}
                    >
                      <ChatMessage message={message} />
                    </MessageScrollerItem>
                  );
                })}
              </MessageScrollerContent>
            )}
          </MessageScrollerViewport>
          <MessageScrollerButton
            aria-label="Zur neuesten Nachricht"
            className="data-[direction=end]:bottom-20"
          />
        </MessageScroller>
      </MessageScrollerProvider>
      <p role="status" className="sr-only">
        {writing ? "Antwort wird geschrieben …" : ""}
      </p>
      <p id="chat-scope-description" className="sr-only">
        Nur ausgewählte Kursmaterialien werden gelesen. Die Kursauswahl bleibt
        nach dem Start unveränderlich.
      </p>
      <form.Subscribe
        selector={(state) =>
          [
            state.values.text,
            state.values.courseIds,
            state.isSubmitting,
          ] as const
        }
      >
        {([text, selected, submitting]) => {
          const canSend = !submitting && !!text.trim() && !(!!id && !chat.data);
          return (
            // Overlaps the list's last 64px so messages fade out behind the band;
            // only the box itself takes pointer input.
            <ChatComposer
              className="pointer-events-none relative z-10 -mt-16 *:pointer-events-auto"
              value={text}
              onValueChange={(value) => form.setFieldValue("text", value)}
              onSubmit={() => {
                if (canSend) void form.handleSubmit();
              }}
              busy={busy}
              canSend={canSend}
              onStop={() => void stop()}
              textareaRef={textarea}
              alert={alertMessage}
              aria-describedby="chat-scope-description"
              knowledge={
                <KnowledgeSelector
                  courses={courses.data ?? []}
                  selected={
                    id
                      ? (chat.data?.courses ?? [])
                      : (courses.data ?? []).filter((course) =>
                          selected.includes(course.id),
                        )
                  }
                  // The API fixes a Chat's courses when it is created, so they lock with the first message.
                  locked={started || busy}
                  loading={courses.isPending}
                  error={courses.error?.message}
                  onToggle={(courseId) => {
                    if (!started && !busy)
                      form.setFieldValue(
                        "courseIds",
                        selected.includes(courseId)
                          ? selected.filter((value) => value !== courseId)
                          : [...selected, courseId],
                      );
                  }}
                />
              }
            />
          );
        }}
      </form.Subscribe>
    </main>
  );
}
