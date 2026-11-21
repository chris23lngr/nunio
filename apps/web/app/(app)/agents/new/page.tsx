import { redirect } from "next/navigation";
import { NewAgentScreen } from "@/features/agents/new-agent-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { template } = await searchParams;

  return <NewAgentScreen apiOrigin={apiOrigin()} templateId={template} />;
}
