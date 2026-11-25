import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type Course =
  paths["/api/me/review"]["get"]["responses"][200]["content"]["application/json"]["courses"][number];
export type Level =
  paths["/api/me/courses/{id}/levels"]["get"]["responses"][200]["content"]["application/json"][number];
export type ArtifactRequest =
  paths["/api/me/artifacts"]["post"]["requestBody"]["content"]["application/json"];
export type Attempt =
  paths["/api/me/artifacts/{id}/attempts"]["get"]["responses"][200]["content"]["application/json"][number];
export type Handoff =
  paths["/api/me/obligations/{id}/handoff"]["get"]["responses"][200]["content"]["application/json"];
export type AiUse = Handoff["rule"];

class HandoffUnavailable extends Error {}

/** The latest Attempt on each Practice Item of a practice set the student answered. */
export function attemptsQueries(apiOrigin: string, artifactId: string) {
  return queryOptions({
    queryKey: [apiOrigin, "attempts", artifactId],
    queryFn: async ({ signal }): Promise<Attempt[]> => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/artifacts/{id}/attempts",
        { params: { path: { id: artifactId } }, signal },
      );
      if (!result.data)
        throw new Error("Deine Antworten konnten nicht geladen werden.");
      return result.data;
    },
  });
}

/** The student's Courses with their Topics and Obligations, as review shows them. */
export function coursesQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "review"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/review", {
        signal,
      });
      if (!result.data)
        throw new Error("Deine Kurse konnten nicht geladen werden.");
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
      if (!result.data)
        throw new Error("Dein Lernstand konnte nicht geladen werden.");
      return result.data;
    },
  });
}

/** One Obligation's Handoff: its Destination wording, AI-use Rule, drafts and submission state. */
export function handoffQuery(apiOrigin: string, obligationId: string) {
  return queryOptions({
    queryKey: [apiOrigin, "handoff", obligationId],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/obligations/{id}/handoff",
        { params: { path: { id: obligationId } }, signal },
      );
      if (result.response.status === 404)
        throw new HandoffUnavailable("Diese Abgabe gibt es nicht mehr.");
      if (result.response.status === 409)
        throw new HandoffUnavailable(
          "Für diese Verpflichtung wird nichts abgegeben.",
        );
      if (!result.data)
        throw new Error("Die Abgabe konnte nicht geladen werden.");
      return result.data;
    },
    retry: (failures, error) =>
      !(error instanceof HandoffUnavailable) && failures < 1,
  });
}
