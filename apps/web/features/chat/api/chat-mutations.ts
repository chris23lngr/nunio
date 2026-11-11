import type { paths } from "@nunio/api-client";
import { mutationOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { ApiError, apiFetch, createApiClient } from "@/lib/api-client";
import type { Message } from "./chat-queries";

export function createChat(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async (courseIds: string[]) => {
      const result = await createApiClient(apiOrigin).POST("/api/me/chats", {
        body: { courseIds, sourceIds: [] },
      });
      if (!result.data)
        throw new ChatError(
          "Der Chat konnte nicht gestartet werden. Prüfe deine Kursauswahl und versuche es erneut.",
        );
      return result.data.id;
    },
  });
}

export type Turn =
  paths["/api/me/chats/{id}/messages"]["post"]["responses"][200]["content"]["application/json"];

/** A Chat message as useChat holds it; metadata arrives once the message is saved. */
export type ChatUIMessage = UIMessage<
  { createdAt: string; citations: Message["citations"]; withdrawn?: true },
  { committed: Turn; refused: { error: string } }
>;

export function toUIMessage(message: Message): ChatUIMessage {
  return {
    id: message.id,
    role: message.role === "student" ? "user" : "assistant",
    metadata: {
      createdAt: message.createdAt,
      citations: message.citations,
      ...(message.text === null ? { withdrawn: true as const } : {}),
    },
    parts: [
      ...(message.reasoning
        ? [
            {
              type: "reasoning" as const,
              text: message.reasoning,
              state: "done" as const,
            },
          ]
        : []),
      ...(message.text !== null
        ? [
            {
              type: "text" as const,
              text: message.text,
              state: "done" as const,
            },
          ]
        : []),
    ],
  };
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

/** Sends only the newest question; `chatId` resolves the Chat, creating it on the first send. */
export function chatTransport(
  apiOrigin: string,
  chatId: () => Promise<string>,
) {
  return new DefaultChatTransport<ChatUIMessage>({
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
    prepareSendMessagesRequest: async ({ messages }) => {
      const id = await chatId();
      const question = messages.at(-1)!;
      return {
        api: `${apiOrigin}/api/me/chats/${encodeURIComponent(id)}/messages/stream`,
        body: {
          id: question.id,
          text: question.parts
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(""),
        },
      };
    },
  });
}

/** The message to show for a failed send. */
export function failureMessage(error: unknown) {
  return error instanceof ChatError || error instanceof ApiError
    ? error.message
    : answerError().message;
}
