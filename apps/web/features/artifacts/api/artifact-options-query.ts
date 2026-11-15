import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type ArtifactOptions =
  paths["/api/me/courses/{id}/artifact-options"]["get"]["responses"][200]["content"]["application/json"];
export type TopicOption = ArtifactOptions["topics"][number];
export type ObligationOption = ArtifactOptions["obligations"][number];

/** What the student can ask an Artifact on in one Course: its Topics, and the Obligations nunio may write for. */
export function artifactOptionsQuery(apiOrigin: string, courseId: string) {
  return queryOptions({
    queryKey: [apiOrigin, "artifact-options", courseId],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/courses/{id}/artifact-options",
        { params: { path: { id: courseId } }, signal },
      );
      if (!result.data)
        throw new Error(
          "Die Themen dieses Kurses konnten nicht geladen werden.",
        );
      return result.data;
    },
  });
}
