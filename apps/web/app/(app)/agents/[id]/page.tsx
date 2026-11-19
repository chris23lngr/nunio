import Link from "next/link";
import { redirect } from "next/navigation";
import { AgentScreen } from "@/features/agents/agent-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;

  return (
    <main>
      <Link href="/agents">All Agents</Link>
      <AgentScreen apiOrigin={apiOrigin()} id={id} />
    </main>
  );
}
