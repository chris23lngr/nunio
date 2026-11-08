import Link from "next/link";
import { redirect } from "next/navigation";
import { apiOrigin, getSession } from "@/lib/session";
import { ChatView } from "./chat-view";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const { id } = await searchParams;

  return (
    <main>
      <Link href="/">Back to Sources</Link>
      <ChatView apiOrigin={apiOrigin()} chatId={id ?? null} />
    </main>
  );
}
