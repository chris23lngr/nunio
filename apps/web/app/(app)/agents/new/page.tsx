import { redirect } from "next/navigation";
import { AgentFormScreen } from "@/features/agents/agent-form-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function NewAgentPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return <AgentFormScreen apiOrigin={apiOrigin()} agent={null} />;
}
