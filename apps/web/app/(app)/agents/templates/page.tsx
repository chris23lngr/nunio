import { redirect } from "next/navigation";
import { TemplatesScreen } from "@/features/agents/templates-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function AgentTemplatesPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return <TemplatesScreen apiOrigin={apiOrigin()} />;
}
