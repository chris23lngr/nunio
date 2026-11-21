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
    // A Run under way ends within minutes; reading the Agent again shows when.
    refetchInterval: (query) => (query.state.data?.running ? 2_000 : false),
  });
}

export type AgentCourse = Agent["courses"][number];

/** The Courses an Agent can be given: the student's accepted, unarchived ones, with their Topic and Source counts. */
export function agentCourseQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "agent-courses"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/agents/courses",
        { signal },
      );
      if (!result.data)
        throw new Error("Deine Kurse konnten nicht geladen werden.");
      return result.data;
    },
  });
}

export type Capability =
  paths["/api/me/agents/capabilities"]["get"]["responses"][200]["content"]["application/json"][number];
export type AgentCapability = Agent["capabilities"][number];
export type ApprovalMode = NonNullable<AgentCapability["mode"]>;

/** Every Capability an Agent can have, in drawer order, with the modes each allows. */
export function capabilityQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "agent-capabilities"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/agents/capabilities",
        { signal },
      );
      if (!result.data)
        throw new Error("Die Fähigkeiten konnten nicht geladen werden.");
      return result.data;
    },
  });
}

export type AgentModels =
  paths["/api/me/models"]["get"]["responses"][200]["content"]["application/json"];
export type AgentModel = AgentModels["models"][number];

/** The Models Chat offers, which an Agent's Model is picked from, and the Chat default a new Agent starts on. */
export function agentModelQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "agent-models"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/models", {
        signal,
      });
      if (!result.data)
        throw new Error("Die Modelle konnten nicht geladen werden.");
      return result.data;
    },
  });
}
