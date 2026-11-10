"use client";

import { Button } from "@nunio/ui/components/button/button";
import { MdxContent } from "@nunio/ui/components/mdx/mdx";
import { Copy, Pencil } from "lucide-react";
import { useState } from "react";
import type { Message } from "../api/chat-queries";

export function ChatMessage({ message }: { message: Message }) {
  const [copied, setCopied] = useState("");
  const student = message.role === "student";
  const references = message.citations.map(({ tag, provenance }) => ({
    tag,
    label:
      provenance === "gone"
        ? "Diese Quelle wurde gelöscht."
        : provenance.kind === "source"
          ? `${provenance.title}, Seite ${provenance.location.page}`
          : "Dein eigener Eintrag",
    href:
      provenance !== "gone" && provenance.kind === "source"
        ? `/sources/${encodeURIComponent(provenance.sourceId)}?page=${provenance.location.page}`
        : undefined,
  }));
  return (
    <article
      aria-label={student ? "Deine Nachricht" : "Antwort von nunio"}
      className={`group/message flex flex-col ${student ? "items-end" : "items-start"}`}
    >
      {message.text === null ? (
        <p className="max-w-[647px] text-sm text-base-500">
          Diese Antwort wurde entfernt, weil eine verwendete Quelle gelöscht
          wurde.
        </p>
      ) : student ? (
        <div className="max-w-[647px] rounded-xl rounded-br-none bg-primary-50 px-4 py-4 text-base leading-7 whitespace-pre-wrap text-primary-900 [overflow-wrap:anywhere]">
          {message.text}
        </div>
      ) : (
        <MdxContent content={message.text} references={references} />
      )}
      <div className="mt-2 flex items-center gap-2 text-xs leading-4 text-base-600 opacity-100 group-focus-within/message:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100">
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
      </div>
    </article>
  );
}
