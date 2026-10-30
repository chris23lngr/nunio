import { redirect } from "next/navigation";
import { apiOrigin, getSession } from "@/lib/session";
import { DeletionForm } from "./deletion-form";
import { SessionList } from "./session-list";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <h1>Account</h1>
      <h2>Sessions</h2>
      <SessionList apiOrigin={apiOrigin()} />
      <h2>Delete account</h2>
      <DeletionForm apiOrigin={apiOrigin()} />
    </main>
  );
}
