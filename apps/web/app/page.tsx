import { redirect } from "next/navigation";
import { apiOrigin, getSession } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <p>Signed in as {session.user.email}</p>
      <SignOutButton apiOrigin={apiOrigin()} />
    </main>
  );
}
