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

export type AgentTemplate =
  paths["/api/me/agents/templates"]["get"]["responses"][200]["content"]["application/json"][number];

/** The curated Agent Templates, each with how many distinct other students saved an Agent from it. */
export function agentTemplatesQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "agent-templates"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/agents/templates",
        { signal },
      );
      if (!result.data)
        throw new Error("Die Templates konnten nicht geladen werden.");
      return result.data;
    },
  });
}
