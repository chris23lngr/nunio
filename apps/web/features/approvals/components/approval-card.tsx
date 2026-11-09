import type { Approval } from "../api/approval-queries";

const presets: Record<string, string> = {
  keep_course_organized: "Keep this course organized",
};
const when = (value: string) =>
  new Date(value).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const span = ({ start, end }: { start: string; end: string }) =>
  `${when(start)}–${new Date(end).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

/** One exact Action, shown back to the student before they confirm it (ADR-0010). */
export function ApprovalCard({
  approval,
  busy,
  onDecide,
}: {
  approval: Approval;
  busy: boolean;
  onDecide: (decision: "approve" | "deny") => void;
}) {
  const { action } = approval;
  const verb = action.kind === "studyBlock.move" ? "Move" : "Add";
  const heading = `${verb} the block for ${action.work.title}`;
  return (
    <article aria-label={heading}>
      <h3>{heading}</h3>
      <p>
        {approval.responsibility
          ? `${presets[approval.responsibility.preset] ?? "A Responsibility"} asks`
          : "nunio asks"}
        {action.work.course && ` for ${action.work.course}`}:{" "}
        {action.from
          ? `from ${span(action.from)} to ${span(action.to)}`
          : `on ${span(action.to)}`}
        .
      </p>
      <p>
        Fingerprint <code>{approval.fingerprint.slice(0, 8)}</code>. This
        request expires {when(approval.expiresAt)}.
      </p>
      <button type="button" disabled={busy} onClick={() => onDecide("approve")}>
        {action.kind === "studyBlock.move"
          ? "Approve this move"
          : "Approve this block"}
      </button>
      <button type="button" disabled={busy} onClick={() => onDecide("deny")}>
        Don't
      </button>
    </article>
  );
}
