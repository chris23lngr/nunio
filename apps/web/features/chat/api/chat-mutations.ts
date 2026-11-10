import type { paths } from "@nunio/api-client";
import { mutationOptions } from "@tanstack/react-query";
import { DefaultChatTransport } from "ai";
import { ApiError, apiFetch, createApiClient } from "@/lib/api-client";

export function createChat(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async (courseIds: string[]) => {
      const result = await createApiClient(apiOrigin).POST("/api/me/chats", {
        body: { courseIds, sourceIds: [] },
      });
      if (!result.data)
        throw new Error(
          "Der Chat konnte nicht gestartet werden. Prüfe deine Kursauswahl und versuche es erneut.",
        );
      return result.data.id;
    },
  });
}

type Turn =
  paths["/api/me/chats/{id}/messages"]["post"]["responses"][200]["content"]["application/json"];

class ChatStreamError extends Error {}

function answerError(reason?: string) {
  return new ChatStreamError(
    reason === "allowance_exhausted"
      ? "Dein KI-Kontingent ist aufgebraucht. Bitte kontaktiere den Support."
      : reason === "ai_disabled"
        ? "Antworten sind gerade pausiert. Versuche es später erneut."
        : reason === "gone"
          ? "Dieser Chat oder eine verwendete Quelle ist nicht mehr verfügbar."
          : "Die Antwort wurde unterbrochen. Deine Nachricht bleibt erhalten.",
  );
}

export function sendChatMessage(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async ({
      id,
      text,
      signal,
      onText,
    }: {
      id: string;
      text: string;
      signal: AbortSignal;
      onText: (text: string) => void;
    }) => {
      let updateTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const transport = new DefaultChatTransport({
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
          prepareSendMessagesRequest: () => ({ body: { text } }),
        });
        const stream = await transport.sendMessages({
          trigger: "submit-message",
          chatId: id,
          messageId: undefined,
          messages: [],
          abortSignal: signal,
        });
        const reader = stream.getReader();
        let provisional = "";
        let committed: Turn | undefined;
        try {
          for (;;) {
            const next = await reader.read();
            signal.throwIfAborted();
            if (next.done) break;
            const chunk = next.value;
            if (chunk.type === "error") throw answerError();
            if (chunk.type === "data-refused")
              throw answerError((chunk.data as { error: string }).error);
            if (chunk.type === "text-delta") {
              provisional += chunk.delta;
              if (!updateTimer)
                updateTimer = setTimeout(() => {
                  updateTimer = undefined;
                  if (!signal.aborted) onText(provisional);
                }, 50);
            }
            if (chunk.type === "data-committed") committed = chunk.data as Turn;
          }
          if (!committed) throw answerError();
          return committed;
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      } catch (error) {
        if (signal.aborted)
          throw new ChatStreamError(
            "Antwort gestoppt. Deine Nachricht bleibt erhalten.",
          );
        if (error instanceof ApiError || error instanceof ChatStreamError)
          throw error;
        throw answerError();
      } finally {
        clearTimeout(updateTimer);
      }
    },
  });
}
