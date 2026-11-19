import Link from "next/link";
import { redirect } from "next/navigation";
import { AgentsScreen } from "@/features/agents/agents-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function AgentsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <Link href="/">Back to Home</Link>
      <AgentsScreen apiOrigin={apiOrigin()} />
    </main>
  );
}
