import { Check } from "lucide-react";
import type { MailFolder } from "../api/email-connection";

/** A folder's label: the inbox by its German name, others as the mailbox names them. */
function folderLabel(folder: MailFolder) {
  return folder.specialUse === "\\Inbox" ? "Posteingang" : folder.name;
}

/** The folders nunio reads, by IMAP path, as one line: "Lesen: Posteingang, Lehrstuhl". */
export function foldersLine(folders: string[]) {
  return `Lesen: ${folders.map((folder) => (folder === "INBOX" ? "Posteingang" : folder)).join(", ")}`;
}

/** The mailbox's folders as chips; a pressed chip is a folder nunio may read. */
export function FolderChips({
  folders,
  selected,
  onChange,
}: {
  folders: MailFolder[];
  /** The chosen folders, by IMAP path. */
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {folders.map((folder) => {
        const pressed = selected.includes(folder.path);
        return (
          <button
            key={folder.path}
            type="button"
            aria-pressed={pressed}
            onClick={() =>
              onChange(
                pressed
                  ? selected.filter((path) => path !== folder.path)
                  : [...selected, folder.path],
              )
            }
            className={`flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[13px] leading-4 font-medium outline-1 focus-visible:outline-2 focus-visible:outline-primary-500 ${
              pressed
                ? "bg-primary-50 text-primary-700 outline-primary-300"
                : "text-base-600 outline-base-300 hover:bg-base-50"
            }`}
          >
            {pressed && (
              <Check aria-hidden className="size-3 text-primary-600" />
            )}
            {folderLabel(folder)}
          </button>
        );
      })}
    </div>
  );
}
