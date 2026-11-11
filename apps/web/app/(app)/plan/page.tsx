import { redirect } from "next/navigation";
import { PlanScreen } from "@/features/plan/plan-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function PlanPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return <PlanScreen apiOrigin={apiOrigin()} />;
}
