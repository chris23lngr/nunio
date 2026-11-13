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
  const { heading, approveLabel } = {
    "studyBlock.create": {
      heading: `Add the block for ${action.work.title}`,
      approveLabel: "Approve this block",
    },
    "studyBlock.move": {
      heading: `Move the block for ${action.work.title}`,
      approveLabel: "Approve this move",
    },
    "task.create": {
      heading: `Add the Task ${action.work.title}`,
      approveLabel: "Approve this Task",
    },
    "task.reopen": {
      heading: `Reopen the Task ${action.work.title}`,
      approveLabel: "Approve reopening it",
    },
  }[action.kind];
  return (
    <ApprovalPresentation
      role="article"
      aria-label={heading}
      title={heading}
      busy={busy}
      onDecide={onDecide}
      approveLabel={approveLabel}
      denyLabel="Don't"
      description={
        <>
          {approval.responsibility
            ? `${presets[approval.responsibility.preset] ?? "A Responsibility"} asks`
            : "nunio asks"}
          {action.work.course && ` for ${action.work.course}`}
          {/* A Task Action places nothing in time (ADR-0022). */}
          {action.to &&
            (action.from
              ? `: from ${span(action.from)} to ${span(action.to)}`
              : `: on ${span(action.to)}`)}
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
