import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { chatHref } from "@/features/chat/chat-routes";
import { ChatScreen } from "@/features/chat/chat-screen";
import { openChatCookie, openChatOf } from "@/features/chat/open-chat-cookie";
import { apiOrigin, getSession } from "@/lib/session";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  // Returning without a Chat reopens the one last open on this device, while it is remembered.
  if (!(await searchParams).id) {
    const open = openChatOf(
      (await cookies()).get(openChatCookie)?.value,
      session.user.id,
    );
    if (open) redirect(chatHref(open));
  }
  return (
    <ChatScreen
      apiOrigin={apiOrigin()}
      userId={session.user.id}
      userName={session.user.name}
    />
  );
}
