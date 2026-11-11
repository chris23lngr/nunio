"use client";

import { useChat } from "@ai-sdk/react";
import { Button, buttonVariants } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@nunio/ui/components/input-group/input-group";
import { Message, MessageContent } from "@nunio/ui/components/message/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@nunio/ui/components/message-scroller/message-scroller";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Blocks,
  ChevronDown,
  Plus,
  Send,
  Sparkles,
  Square,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppForm } from "@/lib/form";
import type { ChatUIMessage, Turn } from "./api/chat-mutations";
import {
  answerError,
  chatTransport,
  createChat,
  failureMessage,
  toUIMessage,
} from "./api/chat-mutations";
import { chatCourseQueries, chatQueries } from "./api/chat-queries";
import { ChatMessage } from "./components/chat-message";
import { CoursePicker } from "./components/course-picker";

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
  // A session is one open Chat; creating a Chat keeps the session it started in.
  const [session, setSession] = useState(() => ({
    key: routeId ?? crypto.randomUUID(),
    id: routeId,
  }));
  const route = useRef(routeId);
  const id = session.id;
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
  const latest = useRef({ session, courseIds: [] as string[] });
  latest.current.session = session;

  const transport = useMemo(
    () =>
      chatTransport(apiOrigin, async () => {
        const { key, id } = latest.current.session;
        if (id) return id;
        const courseIds = latest.current.courseIds;
        const created = await create.mutateAsync(courseIds);
        if (latest.current.session.key !== key)
          throw new DOMException("The Chat was left", "AbortError");
        client.setQueryData(chatQueries(apiOrigin, created).queryKey, {
          id: created,
          courses: (
            client.getQueryData(chatCourseQueries(apiOrigin).queryKey) ?? []
          ).filter((course) => courseIds.includes(course.id)),
          messages: [],
        });
        route.current = created;
        latest.current.session = { key, id: created };
        setSession({ key, id: created });
        window.history.replaceState(null, "", `/chat?id=${created}`);
        return created;
      }),
    [apiOrigin, client, create.mutateAsync],
  );

  const fail = (message: string) => {
    const current = turn.current;
    if (!current || current.key !== latest.current.session.key) return;
    turn.current = null;
    setMessages((messages) => {
      const index = messages.findIndex((m) => m.id === current.questionId);
      return index === -1 ? messages : messages.slice(0, index);
    });
    if (!form.getFieldValue("text")) form.setFieldValue("text", current.draft);
    setError(message);
    if (latest.current.session.id)
      void client.invalidateQueries(
        chatQueries(apiOrigin, latest.current.session.id),
      );
  };

  const { messages, setMessages, sendMessage, status, stop } =
    useChat<ChatUIMessage>({
      id: session.key,
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
        setMessages((messages) => {
          const index = messages.findIndex((m) => m.id === current.questionId);
          return [
            ...messages.slice(0, index === -1 ? messages.length : index),
            toUIMessage(question),
            toUIMessage(answer),
          ];
        });
        if (latest.current.session.id)
          void client.invalidateQueries(
            chatQueries(apiOrigin, latest.current.session.id),
          );
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
  }, [chat.data, setMessages]);

  const form = useAppForm({
    defaultValues: { text: "", courseIds: [] as string[] },
    onSubmit: ({ value }) => {
      const text = value.text.trim();
      if (!text || text.length > 4000 || busy) return;
      const questionId = crypto.randomUUID();
      turn.current = { key: session.key, questionId, draft: value.text };
      latest.current.courseIds = value.courseIds;
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

  useEffect(() => {
    if (route.current === routeId) return;
    route.current = routeId;
    turn.current = null;
    setSession({ key: routeId ?? crypto.randomUUID(), id: routeId });
    setError(null);
    form.reset();
    create.reset();
  }, [routeId, form, create.reset]);

  const busy = status === "submitted" || status === "streaming";
  const last = messages.at(-1);
  const first = messages.find((message) => message.role === "user");
  const words =
    first?.parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim()
      .split(/\s+/) ?? [];
  const title = words.length
    ? `${words.slice(0, 6).join(" ")}${words.length > 6 ? " …" : ""}`
    : "Neuer Chat";
  const shown = error ?? chat.error?.message;
  const started = !!id || messages.length > 0;

  return (
    <main
      className="flex h-dvh min-h-0 flex-col overflow-hidden bg-white font-sans text-base-800"
      aria-label="Chat"
    >
      <header className="grid min-h-16 shrink-0 grid-cols-[32px_minmax(0,1fr)_32px] sm:grid-cols-[132px_minmax(0,1fr)_132px] items-center gap-3 px-4 sm:px-8">
        <Button
          variant="ghost"
          size="sm"
          disabled
          title="Modellauswahl ist noch nicht verfügbar"
          aria-label="Modell auswählen (noch nicht verfügbar)"
        >
          <Sparkles />
          <span className="hidden sm:inline">Modell</span>
          <ChevronDown className="hidden sm:block" />
        </Button>
        {started ? (
          <h1
            className="truncate text-center text-base font-medium"
            title={title}
          >
            {title}
          </h1>
        ) : (
          <span />
        )}
        <Link
          href="/chat"
          aria-label="Neuer Chat"
          className={`${buttonVariants({ variant: "ghost", size: "icon" })} justify-self-end`}
        >
          <Plus className="size-4" aria-hidden="true" />
        </Link>
      </header>
      <MessageScrollerProvider
        key={session.key}
        autoScroll
        defaultScrollPosition="end"
      >
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label="Nachrichten" className="px-4">
            {!started ? (
              <div className="flex min-h-full flex-col items-center pt-[min(20vh,200px)] pb-8">
                <h1 className="max-w-lg text-center text-2xl leading-8 font-medium sm:text-3xl sm:leading-10">
                  Woran möchtest du heute arbeiten, {userName.split(" ")[0]}?
                </h1>
                <div className="mt-16 flex max-w-[640px] flex-wrap justify-center gap-x-4 gap-y-3">
                  {prompts.map((prompt) => (
                    <button
                      type="button"
                      key={prompt}
                      className="rounded-full px-2 text-sm leading-6 text-base-600 outline-1 outline-base-700/15 hover:bg-base-50 focus-visible:ring-2 focus-visible:ring-primary-500"
                      onClick={() => {
                        form.setFieldValue("text", prompt);
                        textarea.current?.focus();
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <MessageScrollerContent className="mx-auto w-full max-w-[832px] gap-10 pt-6 pb-8">
                {id && chat.isPending && <p role="status">Chat laden …</p>}
                {messages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === "user"}
                  >
                    <ChatMessage message={message} />
                  </MessageScrollerItem>
                ))}
                {busy && last?.role === "user" && (
                  <MessageScrollerItem messageId="waiting">
                    <Message aria-label="Laufende Antwort">
                      <MessageContent>
                        <p role="status" className="text-sm text-base-500">
                          nunio antwortet …
                        </p>
                      </MessageContent>
                    </Message>
                  </MessageScrollerItem>
                )}
              </MessageScrollerContent>
            )}
          </MessageScrollerViewport>
          <MessageScrollerButton aria-label="Zur neuesten Nachricht" />
        </MessageScroller>
      </MessageScrollerProvider>
      <form
        className="mx-auto w-full max-w-[688px] shrink-0 px-4 pt-4 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6 sm:pb-[max(24px,env(safe-area-inset-bottom))]"
        aria-label="Nachricht verfassen"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        {shown && (
          <p role="alert" className="mb-3 text-sm text-destructive-700">
            {shown}
          </p>
        )}
        <form.Subscribe selector={(state) => state.values.courseIds}>
          {(selected) => (
            <CoursePicker
              courses={courses.data ?? []}
              selected={
                id
                  ? (chat.data?.courses ?? [])
                  : (courses.data ?? []).filter((course) =>
                      selected.includes(course.id),
                    )
              }
              locked={!!id || busy}
              loading={courses.isPending}
              error={courses.error?.message}
              onToggle={(courseId) => {
                if (!id && !busy)
                  form.setFieldValue(
                    "courseIds",
                    selected.includes(courseId)
                      ? selected.filter((value) => value !== courseId)
                      : [...selected, courseId],
                  );
              }}
            />
          )}
        </form.Subscribe>
        <p id="chat-scope-description" className="sr-only">
          Nur ausgewählte Kursmaterialien werden gelesen. Die Kursauswahl bleibt
          nach dem Start unveränderlich.
        </p>
        <InputGroup className="rounded-lg">
          <form.Field name="text">
            {(field) => (
              <InputGroupTextarea
                ref={textarea}
                aria-label="Nachricht"
                aria-describedby="chat-scope-description"
                name={field.name}
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    if (!busy) void form.handleSubmit();
                  }
                }}
                placeholder="Frage nunio alles, erwähne Kurse und Dateien mit @"
                className="min-h-12 max-h-64 px-4 py-3 text-base leading-6 font-normal"
                maxLength={4000}
              />
            )}
          </form.Field>
          <InputGroupAddon align="block-end" className="h-14 px-3 py-3">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <InputGroupButton aria-label="Weitere Optionen" size="icon" />
                }
              >
                <Plus className="size-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top">
                <DropdownMenuGroup>
                  <DropdownMenuItem disabled>
                    <Upload />
                    Datei hochladen
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled>
                    <Blocks />
                    Konnektoren verwalten
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {busy && (
              <InputGroupButton
                aria-label="Antwort stoppen"
                onClick={() => void stop()}
                size="icon"
              >
                <Square />
              </InputGroupButton>
            )}
            <form.Subscribe
              selector={(state) =>
                [state.values.text, state.isSubmitting] as const
              }
            >
              {([text, submitting]) => (
                <InputGroupButton
                  aria-label="Nachricht senden"
                  type="submit"
                  variant="primary"
                  size="icon"
                  className="ml-auto"
                  disabled={
                    busy || submitting || !text.trim() || (!!id && !chat.data)
                  }
                >
                  <Send />
                </InputGroupButton>
              )}
            </form.Subscribe>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </main>
  );
}
