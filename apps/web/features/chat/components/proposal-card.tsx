"use client";

import {
  Trace,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@nunio/ui/components/trace/trace";
import { CalendarCheck, CalendarX, LoaderCircle } from "lucide-react";
import { ApprovalCard } from "@/features/approvals/components/approval-card";
import type { SavedProposal } from "../api/chat-queries";

const noted: Record<SavedProposal["notes"][number], string> = {
  outside_study_window: "Außerhalb deines Lernfensters",
  daily_limit: "Über deinem Tageslimit",
  work_limit: "Über dem Tageslimit für diese Arbeit",
};

/** A waiting proposal as the Approval card shows it. */
export function approvalOf(saved: SavedProposal) {
  const action = saved.action;
  if (
    action?.status !== "awaiting_approval" ||
    !action.fingerprint ||
    !action.expiresAt
  )
    return null;
  return {
    actionId: action.id,
    action: action.shown,
    fingerprint: action.fingerprint,
    expiresAt: action.expiresAt,
    responsibility: null,
  };
}

/** Where a decided proposal stands, in a word. */
function outcome(action: NonNullable<SavedProposal["action"]>) {
  if (action.decision === "denied") return "Abgelehnt";
  if (action.status === "done")
    return {
      "studyBlock.create": "Angelegt",
      "studyBlock.move": "Verschoben",
      "studyBlock.remove": "Entfernt",
      "task.create": "Angelegt",
      "task.reopen": "Wieder geöffnet",
    }[action.shown.kind];
  if (action.status === "expired") return "Abgelaufen";
  if (action.status === "refused") return "Nicht möglich";
  return "Nicht bestätigt";
}

/**
 * A Study Block nunio proposed in an answer (ADR-0019): the exact Action to confirm while it waits (ADR-0010), and
 * what became of it once decided. It only asks once the answer is saved, since only then is there an Action.
 */
export function ProposalCard({
  saved,
  busy,
  onDecide,
}: {
  saved: SavedProposal | undefined;
  busy: boolean;
  onDecide: (saved: SavedProposal, decision: "approve" | "deny") => void;
}) {
  const action = saved?.action;
  const approval = saved && approvalOf(saved);
  if (saved && approval)
    return (
      <div className="flex flex-col gap-2">
        <ApprovalCard
          approval={approval}
          busy={busy}
          onDecide={(decision) => onDecide(saved, decision)}
        />
        {saved.notes.length > 0 && (
          <ul className="text-sm text-base-500">
            {saved.notes.map((note) => (
              <li key={note}>{noted[note]}</li>
            ))}
          </ul>
        )}
      </div>
    );
  return (
    <Trace>
      <div>
        <TraceLine status={saved ? undefined : "running"}>
          <TraceIcon>
            {!saved ? (
              <LoaderCircle className="motion-safe:animate-spin" />
            ) : action?.status === "done" ? (
              <CalendarCheck />
            ) : (
              <CalendarX />
            )}
          </TraceIcon>
          <TraceTitle>
            {!saved
              ? "Vorschlag wird gespeichert …"
              : action
                ? action.shown.kind.startsWith("task.")
                  ? `Aufgabe ${action.shown.work.title}`
                  : `Lernblock für ${action.shown.work.title}`
                : "Dieser Vorschlag konnte nicht gestellt werden"}
          </TraceTitle>
          {action && <TraceDescription>{outcome(action)}</TraceDescription>}
        </TraceLine>
      </div>
    </Trace>
  );
}
