import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type ChatModels =
  paths["/api/me/models"]["get"]["responses"][200]["content"]["application/json"];
export type ChatModel = ChatModels["models"][number];

export function modelQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "models"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/models", {
        signal,
      });
      if (!result.data)
        throw new Error("Die Modelle konnten nicht geladen werden.");
      return result.data;
    },
  });
}
