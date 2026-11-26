import { redirect } from "next/navigation";
import { ConnectionScreen } from "@/features/settings/connection-screen";
import { apiOrigin, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ConnectionPage({
  params,
}: {
  params: Promise<{ integrationKey: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { integrationKey } = await params;

  return (
    <ConnectionScreen apiOrigin={apiOrigin()} integrationKey={integrationKey} />
  );
}
