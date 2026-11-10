"use client";

import { Bubble, BubbleContent } from "@nunio/ui/components/bubble/bubble";
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
import { MdxContent } from "@nunio/ui/components/mdx/mdx";
import { Message, MessageContent } from "@nunio/ui/components/message/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@nunio/ui/components/message-scroller/message-scroller";
import { Reasoning } from "@nunio/ui/components/reasoning/reasoning";
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
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAppForm } from "@/lib/form";
import { createChat, sendChatMessage } from "./api/chat-mutations";
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
  chatId,
  userName,
}: {
  apiOrigin: string;
  chatId: string | null;
  userName: string;
}) {
  const router = useRouter();
  const client = useQueryClient();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const id = chatId ?? createdId;
  const chat = useQuery(chatQueries(apiOrigin, id));
  const courses = useQuery({ ...chatCourseQueries(apiOrigin), enabled: !id });
  const create = useMutation(createChat(apiOrigin));
  const send = useMutation(sendChatMessage(apiOrigin));
  const textarea = useRef<HTMLTextAreaElement>(null);
  const route = useRef(chatId);
  const activeRequest = useRef<AbortController | null>(null);
  const [partial, setPartial] = useState("");
  const [reasoning, setReasoning] = useState({ text: "", streaming: false });
  useEffect(
    () => () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    },
    [],
  );
  const form = useAppForm({
    defaultValues: { text: "", courseIds: [] as string[] },
    onSubmit: async ({ value }) => {
      const text = value.text.trim();
      if (!text || text.length > 4000) return;
      const controller = new AbortController();
      activeRequest.current = controller;
      setPartial("");
      setReasoning({ text: "", streaming: false });
      const draft = value.text;
      form.setFieldValue("text", "");
      let activeId = id;
      try {
        if (!activeId) {
          activeId = await create.mutateAsync(value.courseIds);
          if (activeRequest.current !== controller) return;
          client.setQueryData(chatQueries(apiOrigin, activeId).queryKey, {
            id: activeId,
            courses: (courses.data ?? []).filter((course) =>
              value.courseIds.includes(course.id),
            ),
            messages: [],
          });
          setCreatedId(activeId);
          router.replace(`/chat?id=${activeId}`, { scroll: false });
        }
        const { question, ...answer } = await send.mutateAsync({
          id: activeId,
          text,
          signal: controller.signal,
          onReasoning: (text, streaming) => {
            if (
              !controller.signal.aborted &&
              activeRequest.current === controller
            )
              setReasoning({ text, streaming });
          },
          onText: (text) => {
            if (
              !controller.signal.aborted &&
              activeRequest.current === controller
            )
              setPartial(text);
          },
        });
        await client.cancelQueries(chatQueries(apiOrigin, activeId));
        client.setQueryData(
          chatQueries(apiOrigin, activeId).queryKey,
          (current) =>
            current
              ? {
                  ...current,
                  messages: [
                    ...current.messages.filter(
                      (message) =>
                        message.id !== question.id && message.id !== answer.id,
                    ),
                    question,
                    answer,
                  ],
                }
              : current,
        );
      } catch {
        if (activeRequest.current !== controller) return;
        form.setFieldValue("text", draft);
        if (activeId)
          await client.invalidateQueries(chatQueries(apiOrigin, activeId));
      } finally {
        if (activeRequest.current === controller) {
          activeRequest.current = null;
          setPartial("");
          setReasoning({ text: "", streaming: false });
        }
      }
    },
  });

  useEffect(() => {
    if (route.current === chatId) return;
    route.current = chatId;
    if (chatId !== createdId) {
      activeRequest.current?.abort();
      activeRequest.current = null;
      setPartial("");
      setReasoning({ text: "", streaming: false });
      setCreatedId(null);
      form.reset();
      create.reset();
      send.reset();
    }
  }, [chatId, createdId, form, create.reset, send.reset]);

  const messages = chat.data?.messages ?? [];
  const busy = create.isPending || send.isPending;
  const first =
    messages.find((message) => message.role === "student")?.text ??
    send.variables?.text;
  const words = first?.trim().split(/\s+/) ?? [];
  const title = words.length
    ? `${words.slice(0, 6).join(" ")}${words.length > 6 ? " …" : ""}`
    : "Neuer Chat";
  const error = create.error ?? send.error ?? chat.error;

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
        {id ? (
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
        key={id ?? "new"}
        autoScroll
        defaultScrollPosition="end"
      >
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label="Nachrichten" className="px-4">
            {!id ? (
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
                {chat.isPending && <p role="status">Chat laden …</p>}
                {messages.map((message) => (
                  <MessageScrollerItem
                    key={message.id}
                    messageId={message.id}
                    scrollAnchor={message.role === "student"}
                  >
                    <ChatMessage message={message} />
                  </MessageScrollerItem>
                ))}
                {send.isPending && (
                  <>
                    <MessageScrollerItem
                      messageId="pending-question"
                      scrollAnchor
                    >
                      <Message align="end">
                        <MessageContent>
                          <Bubble align="end" variant="tinted">
                            <BubbleContent>{send.variables.text}</BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                    <MessageScrollerItem messageId="pending-answer">
                      <Message aria-label="Laufende Antwort">
                        <MessageContent>
                          {reasoning.text && (
                            <Reasoning streaming={reasoning.streaming}>
                              {reasoning.text}
                            </Reasoning>
                          )}
                          {partial && <MdxContent content={partial} />}
                          <p role="status" className="text-sm text-base-500">
                            {partial
                              ? "Antwort wird geschrieben …"
                              : reasoning.text
                                ? ""
                                : "nunio antwortet …"}
                          </p>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  </>
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
        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive-700">
            {error.message}
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
                    !event.nativeEvent.isComposing &&
                    !busy
                  ) {
                    event.preventDefault();
                    void form.handleSubmit();
                  }
                }}
                placeholder="Frage nunio alles, erwähne Kurse und Dateien mit @"
                className="min-h-12 max-h-64 px-4 py-3 text-base leading-6 font-normal"
                maxLength={4000}
                readOnly={busy}
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
                onClick={() => activeRequest.current?.abort()}
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
