import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type CourseList =
  paths["/api/me/courses"]["get"]["responses"][200]["content"]["application/json"];
export type CourseSummary = CourseList["courses"][number];
export type CourseColor = CourseSummary["color"];
export type CourseImpact =
  paths["/api/me/courses/{id}/impact"]["get"]["responses"][200]["content"]["application/json"];

/** The student's proposed and accepted Courses, with the current Semester and those a Course can be given. */
export function courseListQuery(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "courses"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/courses", {
        signal,
      });
      if (!result.data)
        throw new Error("Deine Kurse konnten nicht geladen werden.");
      return result.data;
    },
  });
}

/** What archiving or deleting a Course touches, for the student to confirm. */
export function courseImpactQuery(apiOrigin: string, courseId: string) {
  return queryOptions({
    queryKey: [apiOrigin, "course-impact", courseId],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/courses/{id}/impact",
        { params: { path: { id: courseId } }, signal },
      );
      if (!result.data) throw new Error("Das konnte nicht geladen werden.");
      return result.data;
    },
    staleTime: 0,
  });
}

export type CoursePage =
  paths["/api/me/courses/{id}"]["get"]["responses"][200]["content"]["application/json"];
export type CourseTopic = CoursePage["topics"][number];
export type TopicLevel = CourseTopic["level"];

/** Everything a Course's page shows; gone once the Course is rejected, merged or deleted. */
export function coursePageQuery(apiOrigin: string, courseId: string) {
  return queryOptions({
    queryKey: [apiOrigin, "course-page", courseId],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/courses/{id}",
        {
          params: { path: { id: courseId } },
          signal,
        },
      );
      if (result.response.status === 404) throw new CourseGone();
      if (!result.data)
        throw new Error("Der Kurs konnte nicht geladen werden.");
      return result.data;
    },
    // Asking again does not bring a gone Course back.
    retry: (failures, error) => !(error instanceof CourseGone) && failures < 1,
  });
}

export type CourseTopicAreas =
  paths["/api/me/courses/{id}/topic-areas"]["get"]["responses"][200]["content"]["application/json"];

/** The Course's Topic Areas (ADR-0024) and the Topics in none, each in order. */
export function topicAreasQuery(apiOrigin: string, courseId: string) {
  return queryOptions({
    queryKey: [apiOrigin, "course-page", courseId, "topic-areas"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/courses/{id}/topic-areas",
        { params: { path: { id: courseId } }, signal },
      );
      if (!result.data)
        throw new Error("Die Themenbereiche konnten nicht geladen werden.");
      return result.data;
    },
  });
}

class CourseGone extends Error {
  constructor() {
    super("Diesen Kurs gibt es nicht mehr.");
  }
}
