import { redirect } from "next/navigation";
import { CoursesScreen } from "@/features/courses/courses-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function CoursesPage({
  searchParams,
}: {
  searchParams: Promise<{ semester?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { semester } = await searchParams;
  return <CoursesScreen apiOrigin={apiOrigin()} semester={semester} />;
}
