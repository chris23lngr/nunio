import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type AgentRow =
  paths["/api/me/agents"]["get"]["responses"][200]["content"]["application/json"][number];
export type Agent =
  paths["/api/me/agents/{id}"]["get"]["responses"][200]["content"]["application/json"];

export function agentListQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "agents"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/agents", {
        signal,
      });
      if (!result.data) throw new Error("Could not load what you delegated.");
      return result.data;
    },
  });
}

/** The student's accepted Courses, which an Agent can be scoped to. */
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

export function agentQueries(apiOrigin: string, id: string) {
  return queryOptions({
    queryKey: [apiOrigin, "agents", id],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/agents/{id}",
        {
          params: { path: { id } },
          signal,
        },
      );
      if (!result.data) throw new Error("Could not load this Agent.");
      return result.data;
    },
  });
}
