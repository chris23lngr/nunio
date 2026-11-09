import { redirect } from "next/navigation";
import { SecurityScreen } from "@/features/settings/security-screen";
import { apiOrigin, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return <SecurityScreen apiOrigin={apiOrigin()} />;
}
