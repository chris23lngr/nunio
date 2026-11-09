import type { Source } from "../api/source-queries";

const labels: Record<Source["status"], string> = {
  uploading: "Waiting for upload",
  queued: "Waiting to process",
  processing: "Processing",
  ready: "Ready",
  failed: "Processing stopped. Contact support before trying again.",
  deleted: "Deleted",
};
// What the student can do about a failure; an unexplained failure keeps the support label above.
const failureLabels: Record<NonNullable<Source["failure"]>, string> = {
  too_many_pages:
    "Processing stopped: this PDF has more than 100 pages. Delete it and upload it in parts of up to 100 pages.",
  too_large:
    "Processing stopped: this PDF has more content than one Source can hold. Delete it and upload it in smaller parts.",
  unreadable:
    "Processing stopped: this file could not be read. It may be damaged, password-protected or too complex. Try saving it as a new PDF.",
  no_text: "Processing stopped: no readable text was found in this PDF.",
  allowance_exhausted:
    "Processing stopped: your AI allowance is used up. Contact support to continue.",
};
const extractionLabels: Record<Source["extraction"], string> = {
  pending: "waiting to be read",
  running: "reading for review",
  done: "ready for review",
  failed: "could not be read for review. You can read it again.",
};
export function SourceList({
  sources,
  disabled,
  deletingId,
  onDelete,
  onReadAgain,
}: {
  sources: Source[];
  disabled: boolean;
  deletingId?: string;
  onDelete: (source: Source) => void;
  onReadAgain: (source: Source) => void;
}) {
  return (
    <ul>
      {sources.map((source) => (
        <li key={source.id}>
          <span>
            {source.title} —{" "}
            {source.failure
              ? failureLabels[source.failure]
              : labels[source.status]}
            {source.status === "ready" &&
              `, ${extractionLabels[source.extraction]}`}
          </span>{" "}
          {source.status === "ready" &&
            (source.extraction === "done" ||
              source.extraction === "failed") && (
              <>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onReadAgain(source)}
                >
                  Read again
                </button>{" "}
              </>
            )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDelete(source)}
          >
            {deletingId === source.id ? "Deleting…" : "Delete"}
          </button>
        </li>
      ))}
    </ul>
  );
}
