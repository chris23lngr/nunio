import type { paths } from "@nunio/api-client";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type ChatSummary =
  paths["/api/me/chats"]["get"]["responses"][200]["content"]["application/json"]["chats"][number];

/** Every query over the student's Chat list, to refresh after a Chat's Last Activity changes. */
export const chatListKey = (apiOrigin: string) => [apiOrigin, "chat-list"];

async function chatPage(
  apiOrigin: string,
  query: { limit: number; cursor?: string },
  signal: AbortSignal,
) {
  const result = await createApiClient(apiOrigin).GET("/api/me/chats", {
    params: { query },
    signal,
  });
  if (!result.data)
    throw new Error("Deine letzten Chats konnten nicht geladen werden.");
  return result.data;
}

/** How many recent Chats the header menu lists; a new Chat lists the first few of them. */
export const recentChatCount = 8;

/** The most recent Chats, and whether there are more. */
export function recentChatQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [...chatListKey(apiOrigin), "recent"],
    queryFn: async ({ signal }) => {
      const page = await chatPage(
        apiOrigin,
        { limit: recentChatCount },
        signal,
      );
      return { chats: page.chats, more: page.nextCursor !== null };
    },
  });
}

/** All of the student's Chats, 30 at a time. */
export function allChatQueries(apiOrigin: string) {
  return infiniteQueryOptions({
    queryKey: [...chatListKey(apiOrigin), "all"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      chatPage(apiOrigin, { limit: 30, cursor: pageParam }, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
