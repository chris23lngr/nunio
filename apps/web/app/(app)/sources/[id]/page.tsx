import { redirect } from "next/navigation";
import { SourceDocumentScreen } from "@/features/sources/source-document-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function SourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  if (!(await getSession())) redirect("/sign-in");
  const [{ id }, { page }] = await Promise.all([params, searchParams]);
  return (
    <SourceDocumentScreen apiOrigin={apiOrigin()} sourceId={id} page={page} />
  );
}
