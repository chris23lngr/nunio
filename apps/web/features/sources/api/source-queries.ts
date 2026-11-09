import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type Source =
  paths["/api/me/sources"]["get"]["responses"][200]["content"]["application/json"][number];

export function sourceQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "sources"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/sources", {
        signal,
      });
      if (!result.data) throw new Error("Could not load your Sources.");
      return result.data;
    },
    refetchInterval: (query) =>
      query.state.data?.some(
        (source) =>
          source.status === "queued" ||
          source.status === "processing" ||
          (source.status === "ready" &&
            (source.extraction === "pending" ||
              source.extraction === "running")),
      )
        ? 5_000
        : false,
  });
}
