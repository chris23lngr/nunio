import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type Course =
  paths["/api/me/review"]["get"]["responses"][200]["content"]["application/json"]["courses"][number];
export type Level =
  paths["/api/me/courses/{id}/levels"]["get"]["responses"][200]["content"]["application/json"][number];
export type ArtifactRequest =
  paths["/api/me/artifacts"]["post"]["requestBody"]["content"]["application/json"];

/** The student's Courses with their Topics and Obligations, as review shows them. */
export function coursesQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "review"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/review", {
        signal,
      });
      if (!result.data) throw new Error("Could not load your Courses.");
      return result.data.courses.filter(
        (course) => course.status !== "rejected" && course.status !== "merged",
      );
    },
  });
}

/** Each of a Course's Topics with its Understanding Level. */
export function levelsQueries(apiOrigin: string, courseId: string) {
  return queryOptions({
    queryKey: [apiOrigin, "levels", courseId],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/courses/{id}/levels",
        { params: { path: { id: courseId } }, signal },
      );
      if (!result.data) throw new Error("Could not load your Levels.");
      return result.data;
    },
  });
}
