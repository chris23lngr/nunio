import { redirect } from "next/navigation";
import { StudyScreen } from "@/features/study/study-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function StudyPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { course } = await searchParams;

  return <StudyScreen apiOrigin={apiOrigin()} course={course} />;
}
