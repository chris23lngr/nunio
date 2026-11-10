import { redirect } from "next/navigation";
import { NotificationsScreen } from "@/features/settings/notifications-screen";
import { apiOrigin, getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  return <NotificationsScreen apiOrigin={apiOrigin()} />;
}
