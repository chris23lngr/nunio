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
import { readUIMessageStream } from "ai";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveUnconfirmed } from "@/features/approvals/api/approval-mutations";
import { PageHeader } from "@/features/shared/components/page-header";
import { ApiError } from "@/lib/api-client";
import { useAppForm } from "@/lib/form";
import { randomId } from "@/lib/random-id";
import { chatListKey, recentChatQueries } from "./api/chat-list-queries";
import {
  answerError,
  ChatError,
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
import { modelQueries } from "./api/model-queries";
import { chatHistoryHref } from "./chat-routes";
import { ChatComposer } from "./components/chat-composer";
import { ChatEmptyState } from "./components/chat-empty-state";
import { ChatHeaderActions } from "./components/chat-header-actions";
import { ChatMessage } from "./components/chat-message";
import { KnowledgeSelector } from "./components/knowledge-selector";
import { ModelSelector } from "./components/model-selector";
import {
  ProposalCard,
  UnconfirmedActionCard,
} from "./components/proposal-card";
import {
  forgetOpenChat,
  rememberedChat,
  rememberOpenChat,
} from "./open-chat-cookie";
import type { Batch, Decision } from "./proposal-queue";
import { oldestBatch, oldestUnconfirmed } from "./proposal-queue";
import { happenedQuestion, question } from "./proposal-wording";
import { useNewChat } from "./use-new-chat";

/** The messages before the question `questionId`, or all of them when it isn't there. */
function beforeQuestion(messages: ChatUIMessage[], questionId: string) {
  const index = messages.findIndex((message) => message.id === questionId);
  return index === -1 ? messages : messages.slice(0, index);
}

/** Replaces the message with the same ID, or adds it at the end. */
function upsert(messages: ChatUIMessage[], message: ChatUIMessage) {
  const index = messages.findIndex((m) => m.id === message.id);
  return index === -1
    ? [...messages, message]
    : messages.map((m, i) => (i === index ? message : m));
}

const waitingAnswer: ChatUIMessage = {
  id: "waiting",
  role: "assistant",
  parts: [],
};

/** How many of the recent Chats a new Chat lists. */
const emptyStateChatCount = 4;

/** An answer is keyed by its question, so it keeps one element from waiting to saved. */
function itemKey(messages: ChatUIMessage[], index: number) {
  const message = messages[index]!;
  const before = messages[index - 1];
  return message.role === "assistant" && before?.role === "user"
    ? `answer-to-${before.id}`
    : message.id;
}

export function ChatScreen({
  apiOrigin,
  userId,
  userName,
}: {
  apiOrigin: string;
  userId: string;
  userName: string;
}) {
  const routeId = useSearchParams().get("id");
  const router = useRouter();
  const client = useQueryClient();
  // The open Chat; `key` stays the same when a new Chat is created on its first send.
  const [openChat, setOpenChat] = useState(() => ({
    key: routeId ?? randomId(),
    id: routeId,
  }));
  const shownRouteId = useRef(routeId);
  const id = openChat.id;
  const chat = useQuery(chatQueries(apiOrigin, id));
  const courses = useQuery({ ...chatCourseQueries(apiOrigin), enabled: !id });
  // A remembered Chat deleted since is forgotten quietly, and the student gets an empty Chat.
  const rememberedChatGone =
    !!id &&
    chat.error instanceof ApiError &&
    chat.error.status === 404 &&
    rememberedChat(userId) === id;
  useEffect(() => {
    if (!rememberedChatGone) return;
    forgetOpenChat();
    router.replace("/chat");
  }, [rememberedChatGone, router]);
  // Opening a Chat keeps it open on this device; a saved turn does too (`refresh`), but reloading it doesn't.
  const loaded = !!chat.data;
  useEffect(() => {
    if (id && loaded) rememberOpenChat(userId, id);
  }, [id, loaded, userId]);
  const recent = useQuery(recentChatQueries(apiOrigin));
  const startNewChat = useNewChat();
  const create = useMutation(createChat(apiOrigin));
  const models = useQuery(modelQueries(apiOrigin));
  // The student's pick in this visit; the server remembers it once a question is sent.
  const [picked, setPicked] = useState<string | null>(null);
  const model =
    picked && models.data?.models.some(({ key }) => key === picked)
      ? picked
      : models.data?.selected;
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
    if (id) {
      void client.invalidateQueries(chatQueries(apiOrigin, id));
      rememberOpenChat(userId, id);
    }
    // A saved turn changes the Chat's Last Activity.
    void client.invalidateQueries({ queryKey: chatListKey(apiOrigin) });
  };

  // An unavailable model: reload the offered ones and switch to the remembered or default one.
  const switchModel = async (message: string) => {
    setPicked(null);
    const { data } = await models.refetch();
    const next = data?.models.find(({ key }) => key === data.selected);
    if (next)
      setError((current) =>
        current === message
          ? `${message} Wir haben auf ${next.name} gewechselt.`
          : current,
      );
  };

  const fail = (message: string, reason?: string) => {
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
    if (reason === "model_unavailable") void switchModel(message);
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
      onError: (cause) =>
        fail(
          failureMessage(cause),
          cause instanceof ChatError ? cause.reason : undefined,
        ),
      onFinish: ({ isAbort, isError }) => {
        const current = turn.current;
        if (!current || isError) return;
        if (isAbort)
          return fail("Antwort gestoppt. Deine Nachricht bleibt erhalten.");
        if (!current.committed)
          return fail(answerError(current.refused).message, current.refused);
        const { question, ...answer } = current.committed;
        turn.current = null;
        setMessages((messages) => [
          ...beforeQuestion(messages, current.questionId),
          ...(question ? [toUIMessage(question)] : []),
          toUIMessage(answer),
        ]);
        refresh();
      },
    });

  // Deciding on an answer's proposals at the composer (ADR-0019). Each decision before the last is only noted; the last
  // sends them all, and nunio's report on them streams as a new answer, read here rather than through useChat, which
  // would continue the answer the proposals belong to.
  // The answer whose batch is being sent: once the API has it, its card goes and its rows say so until the Chat reloads.
  const [sending, setSending] = useState<{
    answerId: string;
    arrived: boolean;
  } | null>(null);
  const batch = oldestBatch(
    sending?.arrived
      ? messages.filter((message) => message.id !== sending.answerId)
      : messages,
  );
  const [progressed, setProgressed] = useState<{
    answerId: string;
    index: number;
    decisions: Record<string, Decision>;
  } | null>(null);
  const progress =
    batch && progressed?.answerId === batch.answerId
      ? progressed
      : batch && { answerId: batch.answerId, index: 0, decisions: {} };
  // Once the student acts on a card, each card that follows takes focus, so the keyboard follows them through.
  const [stepping, setStepping] = useState(false);
  // An Action nunio could not confirm comes first, and the student's answer is saved at once: it decides nothing new.
  const unconfirmed = oldestUnconfirmed(messages);
  const resolution = useMutation(resolveUnconfirmed(apiOrigin, client));
  const resolve = (resolved: "happened" | "did_not_happen") => {
    if (!unconfirmed?.action) return;
    setError(null);
    setStepping(true);
    resolution.mutate(
      { actionId: unconfirmed.action.id, resolution: resolved },
      {
        onError: () =>
          setError("Deine Antwort konnte nicht gespeichert werden."),
        onSettled: refresh,
      },
    );
  };
  // The Chat open now; a report still streaming when the student opens another one is left to that Chat's reload.
  const openKey = useRef(openChat.key);
  openKey.current = openChat.key;
  const send = async (decided: Batch, decisions: Record<string, Decision>) => {
    const from = openChat.key;
    const here = () => openKey.current === from;
    setError(null);
    setSending({ answerId: decided.answerId, arrived: false });
    let reported: string | undefined;
    try {
      const chunks = await transport.sendMessages({
        chatId: from,
        messages: [],
        abortSignal: undefined,
        trigger: "submit-message",
        messageId: undefined,
        body: {
          model,
          decisions: decided.proposals.map((proposal) =>
            decisions[proposal.approvalId] === "approve"
              ? {
                  approvalId: proposal.approvalId,
                  decision: "approve",
                  fingerprint: proposal.action!.fingerprint,
                }
              : { approvalId: proposal.approvalId, decision: "deny" },
          ),
        },
      });
      // The API decides before it answers, so the decisions have arrived.
      if (here()) setSending({ answerId: decided.answerId, arrived: true });
      const [shown, watched] = chunks.tee();
      let committed: Turn | undefined;
      let refused: string | undefined;
      const watching = (async () => {
        const reader = watched.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value.type === "data-committed") committed = value.data as Turn;
          if (value.type === "data-refused")
            refused = (value.data as { error: string }).error;
        }
      })();
      for await (const message of readUIMessageStream<ChatUIMessage>({
        stream: shown,
      })) {
        if (!here()) continue;
        reported = message.id;
        setMessages((current) => upsert(current, message));
      }
      await watching;
      if (!here()) return;
      if (!committed) throw answerError(refused);
      const { question: _, ...answer } = committed;
      setMessages((current) => upsert(current, toUIMessage(answer)));
      setStepping(false);
      textarea.current?.focus();
    } catch (cause) {
      if (!here()) return;
      if (reported)
        setMessages((current) => current.filter((m) => m.id !== reported));
      setError(failureMessage(cause));
      // Nothing arrived, so the batch is asked again where it stood.
      setSending((current) => (current?.arrived ? current : null));
    } finally {
      if (here()) refresh();
    }
  };
  const decide = (decision: Decision) => {
    if (!batch || !progress) return;
    const decisions = {
      ...progress.decisions,
      [batch.proposals[progress.index]!.approvalId]: decision,
    };
    const last = progress.index === batch.proposals.length - 1;
    setStepping(true);
    setProgressed({
      ...progress,
      index: last ? progress.index : progress.index + 1,
      decisions,
    });
    if (last) void send(batch, decisions);
  };
  const reporting = !!sending && !sending.arrived;
  // What the student is asked now, read out as each card comes while they step through.
  const asking = unconfirmed
    ? happenedQuestion(unconfirmed.action!.shown)
    : batch && progress
      ? question(batch.proposals[progress.index]!.action!.shown)
      : "";

  const form = useAppForm({
    defaultValues: { text: "", courseIds: [] as string[] },
    onSubmit: ({ value }) => {
      const text = value.text.trim();
      if (!text || text.length > 4000 || busy) return;
      const questionId = randomId();
      turn.current = { key: openChat.key, questionId, draft: value.text };
      restored.current = null;
      sendContext.current.courseIds = value.courseIds;
      setError(null);
      create.reset();
      form.setFieldValue("text", "");
      void sendMessage(
        { id: questionId, role: "user", parts: [{ type: "text", text }] },
        { body: { model } },
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

  // The reload after sending shows the batch's new standing, so the sent answer needs no stand-in any more.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Runs when the Chat reloads.
  useEffect(() => {
    setSending((current) => (current?.arrived ? null : current));
  }, [chat.data]);

  useEffect(() => {
    if (shownRouteId.current === routeId) return;
    shownRouteId.current = routeId;
    turn.current = null;
    restored.current = null;
    setOpenChat({ key: routeId ?? randomId(), id: routeId });
    setError(null);
    // Noted decisions stay with the Chat they were made in.
    setProgressed(null);
    setSending(null);
    setStepping(false);
    form.reset();
    create.reset();
  }, [routeId, form, create.reset]);

  const busy = status === "submitted" || status === "streaming";
  const last = messages.at(-1);
  const alertMessage =
    error ?? (rememberedChatGone ? undefined : chat.error?.message);
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
      <PageHeader>
        {/* Hidden until the models load; a question sent meanwhile has no `model`, so the API uses the remembered one. */}
        {models.data && model && (
          <ModelSelector
            models={models.data.models}
            value={model}
            defaultModel={models.data.default}
            onValueChange={setPicked}
          />
        )}
        <ChatHeaderActions
          recent={recent.data}
          openId={id}
          allHref={chatHistoryHref(id)}
          onNewChat={startNewChat}
        />
      </PageHeader>
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
                recent={recent.data?.chats.slice(0, emptyStateChatCount)}
                more={
                  !!recent.data &&
                  (recent.data.more ||
                    recent.data.chats.length > emptyStateChatCount)
                }
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
                      <ChatMessage
                        message={message}
                        sending={message.id === sending?.answerId}
                      />
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
        {writing
          ? "Antwort wird geschrieben …"
          : stepping && !sending
            ? asking
            : ""}
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
              tray={
                unconfirmed ? (
                  <UnconfirmedActionCard
                    key={unconfirmed.approvalId}
                    proposal={unconfirmed}
                    busy={resolution.isPending}
                    focus={stepping}
                    onResolve={resolve}
                  />
                ) : (
                  batch &&
                  progress && (
                    <ProposalCard
                      key={batch.proposals[progress.index]!.approvalId}
                      proposal={batch.proposals[progress.index]!}
                      position={{
                        index: progress.index,
                        total: batch.proposals.length,
                      }}
                      busy={reporting}
                      focus={stepping}
                      onBack={
                        progress.index > 0
                          ? () =>
                              setProgressed({
                                ...progress,
                                index: progress.index - 1,
                              })
                          : undefined
                      }
                      onDecide={decide}
                    />
                  )
                )
              }
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
