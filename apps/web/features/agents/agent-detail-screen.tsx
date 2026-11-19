"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AgentFormScreen } from "./agent-form-screen";
import { AgentScreen } from "./agent-screen";
import { agentQueries } from "./api/agent-queries";

/** A saved Agent: a free-text one opens its form; a pilot preset keeps its own screen until the Agents cutover. */
export function AgentDetailScreen({
  apiOrigin,
  id,
}: {
  apiOrigin: string;
  id: string;
}) {
  const query = useQuery(agentQueries(apiOrigin, id));
  const agent = query.data;
  if (!agent)
    return query.error ? (
      <main className="p-8">
        <p role="alert" className="text-sm text-destructive-600">
          {query.error.message}
        </p>
      </main>
    ) : null;
  if (!agent.preset)
    return (
      <AgentFormScreen key={agent.id} apiOrigin={apiOrigin} agent={agent} />
    );
  return (
    <main>
      <Link href="/agents">All Agents</Link>
      <AgentScreen apiOrigin={apiOrigin} id={id} />
    </main>
  );
}
