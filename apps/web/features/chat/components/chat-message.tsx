"use client";

import { Bubble, BubbleContent } from "@nunio/ui/components/bubble/bubble";
import { Button } from "@nunio/ui/components/button/button";
import { Citation } from "@nunio/ui/components/citation/citation";
import { MdxContent } from "@nunio/ui/components/mdx/mdx";
import {
  MessageContent,
  MessageFooter,
  Message as MessageRoot,
} from "@nunio/ui/components/message/message";
import { Reasoning } from "@nunio/ui/components/reasoning/reasoning";
import { Copy, Pencil } from "lucide-react";
import { useState } from "react";
import { sourceReferences } from "@/features/shared/components/source-citations";
import type { Message } from "../api/chat-queries";

export function ChatMessage({ message }: { message: Message }) {
  const [copied, setCopied] = useState("");
  const student = message.role === "student";
  const references = sourceReferences(message.citations);
  return (
    <MessageRoot
      role="article"
      align={student ? "end" : "start"}
      aria-label={student ? "Deine Nachricht" : "Antwort von nunio"}
    >
      <MessageContent>
        {!student && message.text !== null && message.reasoning && (
          <Reasoning>{message.reasoning}</Reasoning>
        )}
        {message.text === null ? (
          <p className="max-w-[647px] text-sm text-base-500">
            Diese Antwort wurde entfernt, weil eine verwendete Quelle gelöscht
            wurde.
          </p>
        ) : student ? (
          <Bubble align="end" variant="tinted">
            <BubbleContent>{message.text}</BubbleContent>
          </Bubble>
        ) : (
          <MdxContent
            content={message.text}
            references={references}
            renderReference={(reference) => (
              <Citation
                tag={reference.tag}
                title={reference.label}
                href={reference.href}
              />
            )}
          />
        )}
        <MessageFooter className="mt-2 flex items-center gap-2 text-xs leading-4 text-base-600 opacity-100 group-focus-within/message:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100">
          <time dateTime={message.createdAt}>
            {new Intl.DateTimeFormat("de-DE", {
              hour: "numeric",
              minute: "2-digit",
            }).format(new Date(message.createdAt))}{" "}
            Uhr
          </time>
          {message.text !== null && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={student ? "Nachricht kopieren" : "Antwort kopieren"}
              className="size-5"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message.text!);
                  setCopied("Kopiert");
                } catch {
                  setCopied("Kopieren nicht möglich");
                }
              }}
            >
              <Copy className="size-3.5" />
            </Button>
          )}
          {student && (
            <Button
              variant="ghost"
              size="icon-sm"
              disabled
              title="Bearbeiten ist noch nicht verfügbar"
              aria-label="Nachricht bearbeiten (noch nicht verfügbar)"
              className="size-5"
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
          <span role="status">{copied}</span>
        </MessageFooter>
      </MessageContent>
    </MessageRoot>
  );
}
