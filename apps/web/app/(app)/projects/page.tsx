import { redirect } from "next/navigation";
import { ProjectsScreen } from "@/features/projects/projects-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return <ProjectsScreen apiOrigin={apiOrigin()} />;
}
