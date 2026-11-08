import Link from "next/link";
import { redirect } from "next/navigation";
import { apiOrigin, getSession } from "@/lib/session";
import { HomeView } from "./home-view";
import { SourceList } from "./source-list";
import { SignOutButton } from "./sign-out-button";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <p>Signed in as {session.user.email}</p>
      <Link href="/account">Account</Link>
      <Link href="/review">Review</Link>
      <Link href="/chat">Chat</Link>
      <Link href="/plan">Plan</Link>
      <Link href="/projects">Projects</Link>
      <SignOutButton apiOrigin={apiOrigin()} />
      <HomeView apiOrigin={apiOrigin()} />
      <SourceList apiOrigin={apiOrigin()} />
    </main>
  );
}
