import Link from "next/link";
import { redirect } from "next/navigation";
import { StudyScreen } from "@/features/study/study-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function StudyPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <Link href="/">Back to Home</Link>
      <StudyScreen apiOrigin={apiOrigin()} />
    </main>
  );
}
