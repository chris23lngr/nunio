import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type ResponsibilityRow =
  paths["/api/me/responsibilities"]["get"]["responses"][200]["content"]["application/json"][number];
export type Responsibility =
  paths["/api/me/responsibilities/{id}"]["get"]["responses"][200]["content"]["application/json"];

export function responsibilityListQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "responsibilities"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/responsibilities",
        { signal },
      );
      if (!result.data) throw new Error("Could not load what you delegated.");
      return result.data;
    },
  });
}

/** The student's accepted Courses, which a Responsibility can be scoped to. */
export function delegableCourseQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "delegable-courses"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/review", {
        signal,
      });
      if (!result.data) throw new Error("Could not load your Courses.");
      return result.data.courses.filter(
        (course) => course.status === "accepted",
      );
    },
  });
}

export function responsibilityQueries(apiOrigin: string, id: string) {
  return queryOptions({
    queryKey: [apiOrigin, "responsibilities", id],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/responsibilities/{id}",
        {
          params: { path: { id } },
          signal,
        },
      );
      if (!result.data) throw new Error("Could not load this Responsibility.");
      return result.data;
    },
  });
}
