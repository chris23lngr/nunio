import { redirect } from "next/navigation";
import { AgentDetailScreen } from "@/features/agents/agent-detail-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;

  return <AgentDetailScreen apiOrigin={apiOrigin()} id={id} />;
}
