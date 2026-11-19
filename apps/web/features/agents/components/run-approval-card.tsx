import { Approval } from "@nunio/ui/components/approval/approval";
import { quoted, shortSpan } from "@/features/chat/proposal-wording";
import { kinds, startedAt } from "../activity-wording";
import type { RunApproval } from "../api/activity-mutations";

/**
 * One of a Run's open Approvals: only what nunio renders from the Action (its kind, work and Course, where the block
 * is and would go, and when the request expires), never a word the model wrote (ADR-0010).
 */
export function RunApprovalCard({
  approval,
  busy,
  onDecide,
}: {
  approval: RunApproval;
  busy: boolean;
  onDecide: (decision: "approve" | "deny") => void;
}) {
  const { action } = approval;
  return (
    <Approval
      title={kinds[action.kind].asked}
      busy={busy}
      onDecide={onDecide}
      approveLabel="Akzeptieren"
      denyLabel="Ablehnen"
      description={[
        quoted(action.work.title),
        ...(action.work.course ? [action.work.course] : []),
      ].join(" · ")}
    >
      {/* A removal has only where the block is now; a Task Action places nothing in time (ADR-0022). */}
      {action.kind === "studyBlock.remove" && action.from ? (
        <p>
          <del>{shortSpan(action.from)}</del>
        </p>
      ) : action.to ? (
        <p>
          {action.from
            ? `${shortSpan(action.from)} → ${shortSpan(action.to)}`
            : `Neu: ${shortSpan(action.to)}`}
        </p>
      ) : null}
      <p>
        {approval.agent?.name ? `${approval.agent.name} · ` : ""}Läuft ab am{" "}
        {startedAt(approval.expiresAt)}
      </p>
    </Approval>
  );
}
