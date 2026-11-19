import type { paths } from "@nunio/api-client";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { createApiClient } from "@/lib/api-client";

export type ActivityRun =
  paths["/api/me/agents/{id}/runs"]["get"]["responses"][200]["content"]["application/json"]["runs"][number];
export type ActivityRunDetail =
  paths["/api/me/agents/{id}/runs/{runId}"]["get"]["responses"][200]["content"]["application/json"];
export type VerlaufEntry = ActivityRunDetail["verlauf"][number];

/** Under the Agent's own key, so whatever refreshes the Agent, such as "Jetzt starten", refreshes its Runs too. */
const runsKey = (apiOrigin: string, agentId: string) => [
  apiOrigin,
  "agents",
  agentId,
  "runs",
];

/** A Run under way changes within seconds; reading it again shows how it goes on. */
const whileRunning = 2_000;

/** The Agent's Runs, newest first, 20 at a time. */
export function agentRunListQueries(apiOrigin: string, agentId: string) {
  return infiniteQueryOptions({
    queryKey: runsKey(apiOrigin, agentId),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/agents/{id}/runs",
        {
          params: {
            path: { id: agentId },
            query: { limit: 20, cursor: pageParam },
          },
          signal,
        },
      );
      if (!result.data)
        throw new Error(
          "Die Läufe deines Agenten konnten nicht geladen werden.",
        );
      return result.data;
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.runs.some((run) => run.status === "running"),
      )
        ? whileRunning
        : false,
  });
}

/** One Run with its cost, summary and Verlauf. */
export function agentRunQueries(
  apiOrigin: string,
  agentId: string,
  runId: string,
) {
  return queryOptions({
    queryKey: [...runsKey(apiOrigin, agentId), runId],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/agents/{id}/runs/{runId}",
        { params: { path: { id: agentId, runId } }, signal },
      );
      if (!result.data)
        throw new Error("Dieser Lauf konnte nicht geladen werden.");
      return result.data;
    },
    refetchInterval: (query) =>
      query.state.data?.status === "running" ? whileRunning : false,
  });
}
