import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { createApiClient } from "@/lib/api-client";

export type Chat =
  paths["/api/me/chats/{id}"]["get"]["responses"][200]["content"]["application/json"];
export type Message = Chat["messages"][number];
export type Course = Chat["courses"][number];

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

/** The text a message shows, joined from its text parts. */
export function messageText(message: ChatUIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

export function chatQueries(apiOrigin: string, id: string | null) {
  return queryOptions({
    queryKey: [apiOrigin, "chats", id],
    enabled: !!id,
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/chats/{id}",
        { params: { path: { id: id! } }, signal },
      );
      if (!result.data)
        throw new Error(
          result.response.status === 404
            ? "Dieser Chat ist nicht mehr verfügbar."
            : "Der Chat konnte nicht geladen werden.",
        );
      return result.data;
    },
  });
}

export function chatCourseQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "chat-courses"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/review", {
        signal,
      });
      if (!result.data)
        throw new Error("Deine Kurse konnten nicht geladen werden.");
      return result.data.courses
        .filter((course) => course.status === "accepted")
        .map(({ id, title, code }) => ({ id, title, code }));
    },
  });
}
