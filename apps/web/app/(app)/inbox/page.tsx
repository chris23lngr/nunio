import Link from "next/link";
import { redirect } from "next/navigation";
import { BriefingSettings } from "@/features/inbox/briefing-settings";
import { EmailSettings } from "@/features/inbox/email-settings";
import { InboxScreen } from "@/features/inbox/inbox-screen";
import { PushSettings } from "@/features/inbox/push-settings";
import { QuietSettings } from "@/features/inbox/quiet-settings";
import { apiOrigin, getSession } from "@/lib/session";

export default async function InboxPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return (
    <main>
      <Link href="/">Back to Home</Link>
      <InboxScreen apiOrigin={apiOrigin()} />
      <BriefingSettings apiOrigin={apiOrigin()} />
      <EmailSettings apiOrigin={apiOrigin()} />
      <PushSettings apiOrigin={apiOrigin()} />
      <QuietSettings apiOrigin={apiOrigin()} />
    </main>
  );
}
