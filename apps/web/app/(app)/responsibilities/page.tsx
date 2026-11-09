import Link from "next/link";
import { redirect } from "next/navigation";
import { ResponsibilitiesScreen } from "@/features/responsibilities/responsibilities-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function ResponsibilitiesPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <Link href="/">Back to Home</Link>
      <ResponsibilitiesScreen apiOrigin={apiOrigin()} />
    </main>
  );
}
