import { cn } from "@nunio/ui";
import { Button } from "@nunio/ui/components/button/button";
import { Mail } from "lucide-react";
import { useState } from "react";
import type { Notice } from "../api/inbox-queries";
import { when } from "../inbox-wording";

export const unreadBadge =
  "shrink-0 rounded-sm bg-primary-100 px-1.5 py-px text-xs leading-4.5 font-medium text-primary-700";

/**
 * A Notice as its Agent wrote it, plain text that is never rendered as a link or formatting (ADR-0014). Unread, it
 * shows only who wrote it until the student opens it, which marks it read. Bundled in a Briefing, it is a plain row.
 */
export function NoticeCard({
  notice,
  onOpen,
  opening,
  bundled = false,
}: {
  notice: Notice;
  onOpen: (options: { onError: () => void }) => void;
  opening: boolean;
  bundled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const heading = `Nachricht von ${notice.agentName}`;
  const unread = notice.readAt === null;
  const shown = open || !unread;
  const gone = shown && notice.text === null;
  const openButton = (
    <Button
      type="button"
      variant="outline"
      className="self-start"
      disabled={opening}
      onClick={() => {
        setOpen(true);
        onOpen({ onError: () => setOpen(false) });
      }}
    >
      Öffnen
    </Button>
  );
  return (
    <article
      aria-label={heading}
      className={cn(
        "flex flex-col border",
        bundled ? "gap-2 rounded-lg p-3" : "gap-2.5 rounded-[10px] p-4",
        gone
          ? "border-dashed border-base-300 bg-base-50"
          : "border-base-200 bg-white",
      )}
    >
      <div className={cn("flex items-center", bundled ? "gap-3" : "gap-2.5")}>
        {!bundled && (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-base-100">
            <Mail aria-hidden="true" className="size-4 text-base-500" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="text-sm font-medium text-base-800">{heading}</h3>
          <span
            className={cn(
              "text-base-500",
              bundled ? "text-[13px] leading-4.5" : "text-xs",
            )}
          >
            {bundled && !shown
              ? "Öffnen markiert sie als gelesen."
              : when(notice.sentAt)}
          </span>
        </div>
        {unread && <span className={unreadBadge}>Ungelesen</span>}
        {bundled && !shown && openButton}
      </div>
      {shown ? (
        notice.text === null ? (
          <p className="text-[13px] leading-4.5 text-base-500">
            Nicht mehr lesbar: Eine Quelle, die der Agent gelesen hatte, wurde
            gelöscht.
          </p>
        ) : (
          <p className="text-sm whitespace-pre-line text-base-600">
            {notice.text}
          </p>
        )
      ) : (
        !bundled && openButton
      )}
    </article>
  );
}
