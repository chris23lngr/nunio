import { redirect } from "next/navigation";
import { ObligationScreen } from "@/features/study/obligation-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function StudyObligationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;

  return <ObligationScreen apiOrigin={apiOrigin()} id={id} />;
}
