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

export function sourceDocumentQueries(apiOrigin: string, id: string) {
  return queryOptions({
    queryKey: [apiOrigin, "source-document", id],
    staleTime: 0,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/sources/{id}/download",
        { params: { path: { id } }, signal },
      );
      if (!result.data)
        throw new Error(
          result.response.status === 404
            ? "Diese Quelle ist nicht mehr verfügbar."
            : "Das PDF konnte nicht geladen werden.",
        );
      const response = await fetch(result.data.url, {
        headers: result.data.headers,
        signal,
        credentials: "omit",
      });
      if (!response.ok)
        throw new Error(
          "Das PDF konnte nicht geladen werden. Bitte versuche es erneut.",
        );
      return {
        title: result.data.title,
        blob: new Blob([await response.arrayBuffer()], {
          type: "application/pdf",
        }),
      };
    },
  });
}
