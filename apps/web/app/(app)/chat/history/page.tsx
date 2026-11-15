import { redirect } from "next/navigation";
import { ChatHistoryScreen } from "@/features/chat/chat-history-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function ChatHistoryPage() {
  if (!(await getSession())) redirect("/sign-in");
  return <ChatHistoryScreen apiOrigin={apiOrigin()} />;
}
