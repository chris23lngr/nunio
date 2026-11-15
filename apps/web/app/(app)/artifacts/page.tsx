import { redirect } from "next/navigation";
import { ArtifactsScreen } from "@/features/artifacts/artifacts-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function ArtifactsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; create?: string; course?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { kind, create, course } = await searchParams;
  return (
    <ArtifactsScreen
      apiOrigin={apiOrigin()}
      kind={kind}
      create={create}
      course={course}
    />
  );
}
