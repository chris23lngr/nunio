import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type Chat =
  paths["/api/me/chats/{id}"]["get"]["responses"][200]["content"]["application/json"];
export type Message = Chat["messages"][number];
export type Course = Chat["courses"][number];

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
