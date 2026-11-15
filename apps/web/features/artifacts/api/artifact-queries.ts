import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type ArtifactSummary =
  paths["/api/me/artifacts"]["get"]["responses"][200]["content"]["application/json"][number];
export type ArtifactKind = ArtifactSummary["kind"];

/** The student's Artifacts, newest first. */
export function artifactsQuery(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "artifacts"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/artifacts", {
        signal,
      });
      if (!result.data)
        throw new Error("Deine Artefakte konnten nicht geladen werden.");
      return result.data;
    },
  });
}
