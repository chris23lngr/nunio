import { redirect } from "next/navigation";
import { ChatScreen } from "@/features/chat/chat-screen";
import { apiOrigin, getSession } from "@/lib/session";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await searchParams;
  return (
    <ChatScreen
      apiOrigin={apiOrigin()}
      chatId={id ?? null}
      userName={session.user.name}
    />
  );
}
