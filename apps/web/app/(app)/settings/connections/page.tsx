import { redirect } from "next/navigation";
import { ConnectionsScreen } from "@/features/settings/connections-screen";
import { apiOrigin, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  // The OAuth callback comes back here with the Integration and the reason when connecting didn't work.
  const { connect, error } = await searchParams;

  return (
    <ConnectionsScreen
      apiOrigin={apiOrigin()}
      returned={
        connect && error ? { integrationKey: connect, error } : undefined
      }
    />
  );
}
