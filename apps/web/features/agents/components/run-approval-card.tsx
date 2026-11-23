import { Button } from "@nunio/ui/components/button/button";
import {
  ArrowLeftRight,
  ArrowRight,
  CalendarMinus,
  CalendarPlus,
  ListPlus,
} from "lucide-react";
import { useId } from "react";
import { quoted, shortSpan } from "@/features/chat/proposal-wording";
import { kinds, startedAt } from "../activity-wording";
import type { RunApproval } from "../api/activity-mutations";

const actionIcons: Record<
  RunApproval["action"]["kind"],
  typeof ArrowLeftRight
> = {
  "studyBlock.create": CalendarPlus,
  "studyBlock.move": ArrowLeftRight,
  "studyBlock.remove": CalendarMinus,
  "task.create": ListPlus,
  "task.reopen": ListPlus,
};

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
  const titleId = useId();
  const { action } = approval;
  const Icon = actionIcons[action.kind];
  const subtitle = [
    quoted(action.work.title),
    ...(action.work.course ? [action.work.course] : []),
  ].join(" · ");

  return (
    <fieldset
      aria-labelledby={titleId}
      aria-busy={busy}
      className="flex min-w-0 flex-wrap items-start gap-2 rounded-lg border-0 bg-base-100 p-4 sm:flex-nowrap"
    >
      <span className="flex shrink-0 pt-0.5">
        <Icon aria-hidden="true" className="size-4 text-primary-500" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <h3 id={titleId} className="text-sm font-medium text-base-800">
          {kinds[action.kind].asked}
        </h3>
        <p className="mt-0.5 text-xs text-base-500">{subtitle}</p>
        {/* What a new Task is for and the minutes it needs, both rendered from the Action, never the model's words. */}
        {action.task &&
        (action.task.obligation || action.task.event || action.task.minutes) ? (
          <p className="mt-1.5 text-xs text-base-600">
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
          <div className="mt-2 flex flex-col gap-0.5">
            <span className="text-xs text-base-500">Bisher</span>
            <del className="text-sm font-medium text-base-700">
              {shortSpan(action.from)}
            </del>
          </div>
        ) : action.to ? (
          <div className="mt-2 flex flex-wrap items-center gap-4">
            {action.from && (
              <>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-base-500">Bisher</span>
                  <del className="text-sm font-medium text-base-700">
                    {shortSpan(action.from)}
                  </del>
                </div>
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-base-500"
                />
              </>
            )}
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-base-500">Neu</span>
              <span className="text-sm font-medium text-base-700">
                {shortSpan(action.to)}
              </span>
            </div>
          </div>
        ) : null}
        <p className="mt-2 text-xs text-base-500">
          {approval.agent?.name ? `${approval.agent.name} · ` : ""}Läuft ab am{" "}
          {startedAt(approval.expiresAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => onDecide("deny")}
        >
          Ablehnen
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => onDecide("approve")}
        >
          Akzeptieren
        </Button>
      </div>
    </fieldset>
  );
}
