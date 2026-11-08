import Link from "next/link";
import { redirect } from "next/navigation";
import { SourcesScreen } from "@/features/sources/sources-screen";
import { apiOrigin, getSession } from "@/lib/session";
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
      <SignOutButton apiOrigin={apiOrigin()} />
      <SourcesScreen apiOrigin={apiOrigin()} />
    </main>
  );
}
