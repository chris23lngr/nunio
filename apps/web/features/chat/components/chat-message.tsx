"use client";

import { Bubble, BubbleContent } from "@nunio/ui/components/bubble/bubble";
import { Button } from "@nunio/ui/components/button/button";
import { Citation } from "@nunio/ui/components/citation/citation";
import type { MdxReference } from "@nunio/ui/components/mdx/mdx";
import { MdxContent } from "@nunio/ui/components/mdx/mdx";
import {
  MessageContent,
  MessageFooter,
  Message as MessageRoot,
} from "@nunio/ui/components/message/message";
import { Reasoning } from "@nunio/ui/components/reasoning/reasoning";
import { Copy, Pencil } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { sourceReferences } from "@/features/shared/components/source-citations";
import type { ChatUIMessage } from "../api/chat-mutations";

function renderReference(reference: MdxReference) {
  return (
    <Citation
      tag={reference.tag}
      title={reference.label}
      href={reference.href}
    />
  );
}

/** One message, from its first streamed part to its saved form, in the same element. */
export const ChatMessage = memo(function ChatMessage({
  message,
}: {
  message: ChatUIMessage;
}) {
  const [copied, setCopied] = useState("");
  const student = message.role === "user";
  const saved = message.metadata;
  const withdrawn = !!saved?.withdrawn;
  const text = message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  const reasoning = message.parts.find((part) => part.type === "reasoning");
  const citations = saved?.citations;
  const references = useMemo(
    () => sourceReferences(citations ?? []),
    [citations],
  );
  return (
    <MessageRoot
      role="article"
      align={student ? "end" : "start"}
      aria-label={
        student
          ? "Deine Nachricht"
          : saved
            ? "Antwort von nunio"
            : "Laufende Antwort"
      }
    >
      <MessageContent>
        {!student && !withdrawn && reasoning?.text && (
          <Reasoning streaming={reasoning.state === "streaming"}>
            {reasoning.text}
          </Reasoning>
        )}
        {withdrawn ? (
          <p className="max-w-[647px] text-sm text-base-500">
            Diese Antwort wurde entfernt, weil eine verwendete Quelle gelöscht
            wurde.
          </p>
        ) : student ? (
          <Bubble align="end" variant="tinted">
            <BubbleContent>{text}</BubbleContent>
          </Bubble>
        ) : (
          text && (
            <MdxContent
              content={text}
              references={references}
              renderReference={renderReference}
            />
          )
        )}
        {!student && !saved && (
          <p role="status" className="text-sm text-base-500">
            {text
              ? "Antwort wird geschrieben …"
              : reasoning?.text
                ? ""
                : "nunio antwortet …"}
          </p>
        )}
        {saved && (
          <MessageFooter className="mt-2 flex items-center gap-2 text-xs leading-4 text-base-600 opacity-100 group-focus-within/message:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100">
            <time dateTime={saved.createdAt}>
              {new Intl.DateTimeFormat("de-DE", {
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(saved.createdAt))}{" "}
              Uhr
            </time>
            {!withdrawn && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={student ? "Nachricht kopieren" : "Antwort kopieren"}
                className="size-5"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(text);
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
        )}
      </MessageContent>
    </MessageRoot>
  );
});
