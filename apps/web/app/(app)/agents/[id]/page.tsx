import { redirect } from "next/navigation";
import { AgentDetailScreen } from "@/features/agents/agent-detail-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function AgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string; tab?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const [{ id }, { run, tab }] = await Promise.all([params, searchParams]);

  return (
    <AgentDetailScreen apiOrigin={apiOrigin()} id={id} run={run} tab={tab} />
  );
}
