"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@nunio/ui/components/tooltip/tooltip";
import { ChevronDown, History, Plus } from "lucide-react";
import Link from "next/link";
import type { ChatSummary } from "../api/chat-list-queries";
import { chatAge } from "../chat-age";
import { chatHref } from "../chat-routes";

/**
 * The Chat header's switch to a recent Chat, marking the open one `openId`, and the button that starts an empty
 * Chat. Narrow screens show both as icons.
 */
export function ChatHeaderActions({
  recent,
  openId,
  allHref,
  onNewChat,
}: {
  recent: { chats: ChatSummary[]; more: boolean } | undefined;
  openId: string | null;
  allHref: string;
  onNewChat: () => void;
}) {
  const now = new Date();
  return (
    <div className="ml-auto flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" />}
          aria-label="Letzte Chats"
        >
          <History className="sm:hidden" />
          <span className="hidden sm:inline">Letzte Chats</span>
          <ChevronDown className="hidden sm:block" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[320px]">
          <DropdownMenuGroup aria-label="Letzte Chats">
            {recent?.chats.map((chat) => (
              <DropdownMenuLinkItem
                key={chat.id}
                render={<Link href={chatHref(chat.id)} />}
                aria-current={chat.id === openId ? "page" : undefined}
                className="text-base-800 aria-[current=page]:bg-base-100"
              >
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                <span className="shrink-0 font-normal text-base-500">
                  {chatAge(new Date(chat.lastActivityAt), now, "short")}
                </span>
              </DropdownMenuLinkItem>
            ))}
          </DropdownMenuGroup>
          {recent?.more && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLinkItem
                  render={<Link href={allHref} />}
                  className="text-base-800"
                >
                  Alle anzeigen
                </DropdownMenuLinkItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="ghost" />}
          aria-label="Neuer Chat"
          onClick={onNewChat}
        >
          <span className="hidden sm:inline">Neuer Chat</span>
          <Plus />
        </TooltipTrigger>
        <TooltipContent>
          {/Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘⇧O" : "Ctrl+Shift+O"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
