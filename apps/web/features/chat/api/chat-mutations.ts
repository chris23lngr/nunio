import { mutationOptions } from "@tanstack/react-query";
import type { ChatTransport } from "ai";
import { DefaultChatTransport } from "ai";
import { ApiError, apiFetch, createApiClient } from "@/lib/api-client";
import type { ChatUIMessage } from "./chat-queries";
import { chatCourseQueries, chatQueries, messageText } from "./chat-queries";

export function createChat(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async ({
      courseIds,
      signal,
    }: {
      courseIds: string[];
      signal?: AbortSignal;
    }) => {
      const result = await createApiClient(apiOrigin).POST("/api/me/chats", {
        body: { courseIds, sourceIds: [] },
        signal,
      });
      if (!result.data)
        throw new ChatError(
          "Der Chat konnte nicht gestartet werden. Prüfe deine Kursauswahl und versuche es erneut.",
        );
      return result.data.id;
    },
    // The new Chat is known to be empty, so opening it needs no request.
    onSuccess: (id, { courseIds }, _, { client }) => {
      client.setQueryData(chatQueries(apiOrigin, id).queryKey, {
        id,
        courses: (
          client.getQueryData(chatCourseQueries(apiOrigin).queryKey) ?? []
        ).filter((course) => courseIds.includes(course.id)),
        messages: [],
      });
    },
  });
}

/** An error whose message is safe to show the student. */
export class ChatError extends Error {}

export function answerError(reason?: string) {
  return new ChatError(
    reason === "allowance_exhausted"
      ? "Dein KI-Kontingent ist aufgebraucht. Bitte kontaktiere den Support."
      : reason === "ai_disabled"
        ? "Antworten sind gerade pausiert. Versuche es später erneut."
        : reason === "gone"
          ? "Dieser Chat oder eine verwendete Quelle ist nicht mehr verfügbar."
          : "Die Antwort wurde unterbrochen. Deine Nachricht bleibt erhalten.",
  );
}

/**
 * Sends only the newest question. `chatId` resolves the Chat, creating it on the first send, and
 * gets the send's abort signal so Stop also cancels the creation.
 */
export function chatTransport(
  apiOrigin: string,
  chatId: (signal: AbortSignal | undefined) => Promise<string>,
): ChatTransport<ChatUIMessage> {
  return {
    sendMessages: async (options) => {
      const id = await chatId(options.abortSignal);
      return new DefaultChatTransport<ChatUIMessage>({
        api: `${apiOrigin}/api/me/chats/${encodeURIComponent(id)}/messages/stream`,
        credentials: "include",
        fetch: async (input, init) => {
          const response = await apiFetch(input, init);
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as {
              error?: string;
            };
            throw answerError(body.error);
          }
          return response;
        },
        prepareSendMessagesRequest: ({ messages }) => {
          const question = messages.at(-1)!;
          return { body: { id: question.id, text: messageText(question) } };
        },
      }).sendMessages(options);
    },
    reconnectToStream: async () => null,
  };
}

/** The message to show for a failed send. */
export function failureMessage(error: unknown) {
  return error instanceof ChatError || error instanceof ApiError
    ? error.message
    : answerError().message;
}
