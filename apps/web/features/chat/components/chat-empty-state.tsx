import Link from "next/link";
import type { ChatSummary } from "../api/chat-list-queries";
import { chatHistoryHref } from "../chat-routes";
import { ChatList } from "./chat-list";

type ChatEmptyStateProps = {
  firstName: string;
  /** The student's most recent Chats; nothing is listed until they load or when there are none. */
  recent: ChatSummary[] | undefined;
  /** Whether the student has more Chats than `recent`. */
  more: boolean;
};

export function ChatEmptyState({
  firstName,
  recent,
  more,
}: ChatEmptyStateProps) {
  return (
    <div className="flex min-h-full flex-col items-center pt-16 pb-8">
      <h1 className="max-w-[416px] text-center text-2xl leading-8 font-medium text-base-800 sm:text-3xl sm:leading-9">
        Woran möchtest du heute arbeiten, {firstName}?
      </h1>
      {!!recent?.length && (
        <section className="mt-12 w-full max-w-[640px]">
          <div className="flex items-center justify-between">
            <h2
              id="recent-chats"
              className="text-xs leading-4 font-medium text-base-500"
            >
              Deine letzten Chats
            </h2>
            {more && (
              <Link
                href={chatHistoryHref(null)}
                className="text-xs leading-4 font-medium text-primary-600 hover:text-primary-700"
              >
                Alle anzeigen
              </Link>
            )}
          </div>
          <ChatList chats={recent} labelledBy="recent-chats" />
        </section>
      )}
    </div>
  );
}
