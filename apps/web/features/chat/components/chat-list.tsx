import Link from "next/link";
import type { ChatSummary } from "../api/chat-list-queries";
import { chatAge } from "../chat-age";
import { chatHref } from "../chat-routes";

/** Chats as rows linking to each, under the heading `labelledBy`, with how long ago each was active when `now` is given. */
export function ChatList({
  chats,
  labelledBy,
  now,
}: {
  chats: ChatSummary[];
  labelledBy: string;
  now?: Date;
}) {
  return (
    <ul aria-labelledby={labelledBy}>
      {chats.map((chat) => (
        <li key={chat.id} className="border-b border-base-200 last:border-b-0">
          <Link
            href={chatHref(chat.id)}
            className="flex items-baseline gap-4 py-4 text-sm leading-5 text-base-800 hover:text-primary-700"
          >
            <span className="min-w-0 flex-1 truncate font-medium">
              {chat.title}
            </span>
            {now && (
              <span className="shrink-0 text-base-500">
                {chatAge(new Date(chat.lastActivityAt), now, "long")}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
