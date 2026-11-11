import { redirect } from "next/navigation";
import { ChatScreen } from "@/features/chat/chat-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function ChatPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return <ChatScreen apiOrigin={apiOrigin()} userName={session.user.name} />;
}
