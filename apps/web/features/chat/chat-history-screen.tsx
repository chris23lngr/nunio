"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { PageHeader } from "@/features/shared/components/page-header";
import { allChatQueries, recentChatQueries } from "./api/chat-list-queries";
import { chatHistoryHref, chatHref } from "./chat-routes";
import { ChatHeaderActions } from "./components/chat-header-actions";
import { ChatList } from "./components/chat-list";
import { useNewChat } from "./use-new-chat";

/** All of the student's Chats by Last Activity, loading more while scrolling down. */
export function ChatHistoryScreen({ apiOrigin }: { apiOrigin: string }) {
  // The Chat the student came from, which "Zurück" reopens.
  const from = useSearchParams().get("from");
  const chats = useInfiniteQuery(allChatQueries(apiOrigin));
  const recent = useQuery(recentChatQueries(apiOrigin));
  const startNewChat = useNewChat();
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = chats;
  useEffect(() => {
    const element = end.current;
    if (!element || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void fetchNextPage();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return (
    <main
      className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-white font-sans text-base-800"
      aria-label="Alle Chats"
    >
      <PageHeader>
        <ChatHeaderActions
          recent={recent.data}
          openId={null}
          allHref={chatHistoryHref(from)}
          onNewChat={startNewChat}
        />
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-16">
        <div className="mx-auto w-full max-w-[640px] pt-16 pb-16">
          <Link
            href={from ? chatHref(from) : "/chat"}
            className="inline-flex items-center gap-1 text-sm leading-5 font-medium text-primary-600 hover:text-primary-700"
          >
            <ChevronLeft aria-hidden="true" className="size-4" />
            Zurück
          </Link>
          <h1
            id="all-chats"
            className="mt-8 text-xs leading-4 font-medium text-base-500"
          >
            Deine letzten Chats
          </h1>
          {chats.error && (
            <p role="alert" className="mt-4 text-sm text-destructive-700">
              {chats.error.message}
            </p>
          )}
          <ChatList
            chats={chats.data?.pages.flatMap((page) => page.chats) ?? []}
            labelledBy="all-chats"
            now={new Date()}
          />
          <div ref={end} />
          {(chats.isPending || isFetchingNextPage) && (
            <p role="status" className="py-4 text-sm text-base-500">
              Chats laden …
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
