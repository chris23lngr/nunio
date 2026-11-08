import Link from "next/link";
import { redirect } from "next/navigation";
import { apiOrigin, getSession } from "@/lib/session";
import { ProjectsView } from "./projects-view";

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <Link href="/">Back to Home</Link>
      <ProjectsView apiOrigin={apiOrigin()} />
    </main>
  );
}
