"use client";

import { Bubble, BubbleContent } from "@nunio/ui/components/bubble/bubble";
import { Citation } from "@nunio/ui/components/citation/citation";
import type { MdxReference } from "@nunio/ui/components/mdx/mdx";
import { MdxContent } from "@nunio/ui/components/mdx/mdx";
import {
  MessageContent,
  Message as MessageRoot,
} from "@nunio/ui/components/message/message";
import { Reasoning } from "@nunio/ui/components/reasoning/reasoning";
import { memo, useMemo, useState } from "react";
import { sourceReferences } from "@/features/shared/components/source-citations";
import type { ChatUIMessage } from "../api/chat-queries";
import { messageText } from "../api/chat-queries";
import { MessageActions } from "./message-actions";

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
  const student = message.role === "user";
  const saved = message.metadata;
  // Only messages sent in this visit enter: a question slides in, an answer fades in.
  const [entering] = useState(!saved);
  const withdrawn = !!saved?.withdrawn;
  const text = messageText(message);
  const reasoning = message.parts.find((part) => part.type === "reasoning");
  // An answer with nothing streamed yet shows the waiting line.
  const waiting = !student && !saved && !text && !reasoning?.text;
  const citations = saved?.citations;
  const references = useMemo(
    () => sourceReferences(citations ?? []),
    [citations],
  );
  return (
    <MessageRoot
      role="article"
      aria-busy={!student && !saved ? true : undefined}
      align={student ? "end" : "start"}
      className={
        entering
          ? student
            ? "transition-[opacity,translate] duration-200 ease-out starting:translate-y-2 starting:opacity-0 motion-reduce:starting:translate-y-0"
            : "transition-opacity duration-200 ease-out starting:opacity-0"
          : undefined
      }
      aria-label={
        student
          ? "Deine Nachricht"
          : saved
            ? "Antwort von nunio"
            : "Laufende Antwort"
      }
    >
      <MessageContent>
        {!student && !withdrawn && (reasoning?.text || waiting) && (
          <Reasoning
            streaming={waiting || reasoning?.state === "streaming"}
            answering={!saved}
          >
            {reasoning?.text ?? ""}
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
        {saved && (
          <MessageActions
            createdAt={saved.createdAt}
            text={text}
            own={student}
            withdrawn={withdrawn}
          />
        )}
      </MessageContent>
    </MessageRoot>
  );
});
