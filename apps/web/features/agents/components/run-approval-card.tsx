import { Approval } from "@nunio/ui/components/approval/approval";
import { quoted, shortSpan } from "@/features/chat/proposal-wording";
import { kinds, startedAt } from "../activity-wording";
import type { RunApproval } from "../api/activity-mutations";

/**
 * One of a Run's open Approvals: only what nunio renders from the Action (its kind, work and Course, where the block
 * is and would go, a new Task's title, Obligation, Course Event and Estimate, and when the request expires), never a word the model
 * wrote beyond a Task's title (ADR-0010).
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
      {/* What a new Task is for and the minutes it needs, both rendered from the Action, never the model's words. */}
      {action.task &&
      (action.task.obligation || action.task.event || action.task.minutes) ? (
        <p>
          {[
            ...(action.task.obligation
              ? [`Zählt für ${quoted(action.task.obligation)}`]
              : []),
            ...(action.task.event
              ? [
                  `${action.task.role === "follow_up" ? "Nachbereitung von" : "Vorbereitung auf"} ${quoted(action.task.event.title)} am ${startedAt(action.task.event.start)}`,
                ]
              : []),
            ...(action.task.minutes
              ? [`${action.task.minutes} Min. geschätzt`]
              : []),
          ].join(" · ")}
        </p>
      ) : null}
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
