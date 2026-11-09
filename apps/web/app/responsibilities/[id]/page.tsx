import Link from "next/link";
import { redirect } from "next/navigation";
import { ResponsibilityScreen } from "@/features/responsibilities/responsibility-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function ResponsibilityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;

  return (
    <main>
      <Link href="/responsibilities">All Responsibilities</Link>
      <ResponsibilityScreen apiOrigin={apiOrigin()} id={id} />
    </main>
  );
}
