import { mutationOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

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

export function sendChatMessage(apiOrigin: string) {
  return mutationOptions({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/chats/{id}/messages",
        { params: { path: { id } }, body: { text } },
      );
      if (!result.data) {
        const reason = (result.error as { error?: string } | undefined)?.error;
        throw new Error(
          reason === "allowance_exhausted"
            ? "Dein KI-Kontingent ist aufgebraucht. Bitte kontaktiere den Support."
            : reason === "ai_disabled"
              ? "Antworten sind gerade pausiert. Versuche es später erneut."
              : result.response.status === 404
                ? "Dieser Chat ist nicht mehr verfügbar."
                : "Die Antwort konnte nicht geladen werden. Deine Nachricht bleibt erhalten.",
        );
      }
      return result.data;
    },
  });
}
