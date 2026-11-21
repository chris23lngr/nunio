"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AgentFormScreen } from "./agent-form-screen";
import { agentRunListQueries } from "./api/activity-queries";
import { agentQueries } from "./api/agent-queries";

/** A saved Agent: its form, opened on its Aktivität once it ran. */
export function AgentDetailScreen({
  apiOrigin,
  id,
  run,
  tab,
}: {
  apiOrigin: string;
  id: string;
  /** The Run its Aktivität opens on, as from the Inbox. */
  run?: string;
  /** "auftrag" opens it on its Auftrag, as the list's Bearbeiten does, even when it ran. */
  tab?: string;
}) {
  const query = useQuery(agentQueries(apiOrigin, id));
  const agent = query.data;
  // Read before the form opens: an Agent that ran opens on its Aktivität.
  const runs = useInfiniteQuery(agentRunListQueries(apiOrigin, id));
  if (!agent)
    return query.error ? (
      <main className="p-8">
        <p role="alert" className="text-sm text-destructive-600">
          {query.error.message}
        </p>
      </main>
    ) : null;
  if (!runs.data && !runs.error) return null;
  return (
    <AgentFormScreen
      key={agent.id}
      apiOrigin={apiOrigin}
      agent={agent}
      hasRuns={tab !== "auftrag" && Boolean(runs.data?.pages[0]?.runs.length)}
      run={run}
    />
  );
}
