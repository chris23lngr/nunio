import { redirect } from "next/navigation";
import { SourcesScreen } from "@/features/sources/sources-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function SourcesPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <SourcesScreen apiOrigin={apiOrigin()} />
    </main>
  );
}
