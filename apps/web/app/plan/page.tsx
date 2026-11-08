import Link from "next/link";
import { redirect } from "next/navigation";
import { apiOrigin, getSession } from "@/lib/session";
import { PlanView } from "./plan-view";

export default async function PlanPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <Link href="/">Back to Home</Link>
      <PlanView apiOrigin={apiOrigin()} />
    </main>
  );
}
