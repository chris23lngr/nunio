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
