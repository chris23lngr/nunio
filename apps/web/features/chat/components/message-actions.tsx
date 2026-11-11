"use client";

import { Button } from "@nunio/ui/components/button/button";
import { MessageFooter } from "@nunio/ui/components/message/message";
import { Copy, Pencil } from "lucide-react";
import { useState } from "react";

/** The row under a saved message: its time, copy, and (for the student's own message) edit. */
export function MessageActions({
  createdAt,
  text,
  own,
  withdrawn = false,
}: {
  createdAt: string;
  /** What the copy button writes to the clipboard. */
  text: string;
  /** The student's own message: labelled "Nachricht" and offers editing. */
  own: boolean;
  /** A withdrawn answer has nothing to copy. */
  withdrawn?: boolean;
}) {
  const [copied, setCopied] = useState("");
  return (
    <MessageFooter className="mt-2 flex items-center gap-2 px-0 text-xs leading-4 text-base-600 opacity-100 group-focus-within/message:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100">
      <time dateTime={createdAt}>
        {new Intl.DateTimeFormat("de-DE", {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(createdAt))}{" "}
        Uhr
      </time>
      {!withdrawn && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={own ? "Nachricht kopieren" : "Antwort kopieren"}
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
      {own && (
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
  );
}
