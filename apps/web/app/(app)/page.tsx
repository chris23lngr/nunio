import Link from "next/link";
import { redirect } from "next/navigation";
import { ApprovalsPanel } from "@/features/approvals/approvals-panel";
import { SourcesScreen } from "@/features/sources/sources-screen";
import { apiOrigin, getSession } from "@/lib/session";
import { HomeView } from "./home-view";
import { SignOutButton } from "./sign-out-button";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <p>Signed in as {session.user.email}</p>
      <Link href="/review">Review</Link>
      <Link href="/chat">Chat</Link>
      <Link href="/plan">Plan</Link>
      <Link href="/projects">Projects</Link>
      <Link href="/responsibilities">Responsibilities</Link>
      <SignOutButton apiOrigin={apiOrigin()} />
      <ApprovalsPanel apiOrigin={apiOrigin()} />
      <HomeView apiOrigin={apiOrigin()} />
      <SourcesScreen apiOrigin={apiOrigin()} />
    </main>
  );
}
