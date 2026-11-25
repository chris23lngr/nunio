import { redirect } from "next/navigation";
import { ConnectionsScreen } from "@/features/settings/connections-screen";
import { apiOrigin, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return <ConnectionsScreen apiOrigin={apiOrigin()} />;
}
