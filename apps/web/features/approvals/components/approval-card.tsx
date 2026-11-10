import { Approval as ApprovalPresentation } from "@nunio/ui/components/approval/approval";
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
    <ApprovalPresentation
      role="article"
      aria-label={heading}
      title={heading}
      busy={busy}
      onDecide={onDecide}
      approveLabel={
        action.kind === "studyBlock.move"
          ? "Approve this move"
          : "Approve this block"
      }
      denyLabel="Don't"
      description={
        <>
          {approval.responsibility
            ? `${presets[approval.responsibility.preset] ?? "A Responsibility"} asks`
            : "nunio asks"}
          {action.work.course && ` for ${action.work.course}`}:{" "}
          {action.from
            ? `from ${span(action.from)} to ${span(action.to)}`
            : `on ${span(action.to)}`}
          .
        </>
      }
    >
      <p>
        Fingerprint <code>{approval.fingerprint.slice(0, 8)}</code>. This
        request expires {when(approval.expiresAt)}.
      </p>
    </ApprovalPresentation>
  );
}
