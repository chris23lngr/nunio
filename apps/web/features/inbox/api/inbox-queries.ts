import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type Intervention =
  paths["/api/me/inbox"]["get"]["responses"][200]["content"]["application/json"]["interventions"][number];

export function inboxQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "inbox"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/inbox", {
        signal,
      });
      if (!result.data) throw new Error("Could not load your Inbox.");
      return result.data;
    },
  });
}
