import { redirect } from "next/navigation";
import { ArtifactScreen } from "@/features/study/artifact-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await params;

  return <ArtifactScreen apiOrigin={apiOrigin()} id={id} />;
}
