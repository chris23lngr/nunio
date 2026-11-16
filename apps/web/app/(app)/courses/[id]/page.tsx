import { redirect } from "next/navigation";
import { CourseScreen } from "@/features/courses/course-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ topic?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const [{ id }, { topic }] = await Promise.all([params, searchParams]);
  return <CourseScreen apiOrigin={apiOrigin()} id={id} topic={topic} />;
}
