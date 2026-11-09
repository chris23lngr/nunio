import Link from "next/link";
import { redirect } from "next/navigation";
import { BriefingSettings } from "@/features/inbox/briefing-settings";
import { InboxScreen } from "@/features/inbox/inbox-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function InboxPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <Link href="/">Back to Home</Link>
      <InboxScreen apiOrigin={apiOrigin()} />
      <BriefingSettings apiOrigin={apiOrigin()} />
    </main>
  );
}
