"use client";

import { cn } from "@nunio/ui";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  Clock,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import type { SavedProposal } from "../api/chat-queries";
import type { Shown } from "../proposal-wording";
import { quoted, shortSpan } from "../proposal-wording";

type Action = NonNullable<SavedProposal["action"]>;
type Tone = "done" | "neutral" | "warning";

/** How loud a row is: the colors of its icon and of its word. */
const tones: Record<Tone, { icon: string; label: string }> = {
  done: { icon: "text-primary-500", label: "text-primary-600" },
  neutral: { icon: "text-base-400", label: "text-base-500" },
  warning: { icon: "text-warning-600", label: "text-warning-700" },
};

const done: Record<Shown["kind"], string> = {
  "studyBlock.create": "Angelegt",
  "studyBlock.move": "Verschoben",
  "studyBlock.remove": "Entfernt",
  "task.create": "Angelegt",
  "task.reopen": "Wieder geöffnet",
};

/** Where a decided or waiting proposal stands: its icon, its word, and how loud it is. */
function standing(
  action: Action,
  sending: boolean,
): {
  icon: ReactNode;
  label: string;
  tone: Tone;
} {
  if (action.status === "awaiting_approval" && sending)
    return {
      icon: <LoaderCircle className="motion-safe:animate-spin" />,
      label: "Wird gespeichert",
      tone: "neutral",
    };
  if (action.status === "done")
    return {
      icon: <CircleCheck />,
      label: done[action.shown.kind],
      tone: "done",
    };
  if (action.decision === "denied")
    return { icon: <CircleX />, label: "Abgelehnt", tone: "neutral" };
  if (action.status === "awaiting_approval")
    return {
      icon: <CircleDashed />,
      label: "Wartet auf dich",
      tone: "neutral",
    };
  if (action.status === "expired")
    return { icon: <Clock />, label: "Abgelaufen", tone: "neutral" };
  if (action.status === "refused")
    return { icon: <TriangleAlert />, label: "Nicht möglich", tone: "warning" };
  if (action.status === "failed")
    return { icon: <CircleX />, label: "Nicht passiert", tone: "neutral" };
  return { icon: <CircleHelp />, label: "Nicht bestätigt", tone: "warning" };
}

/** What a proposal concerns, in a line: its work, and its time or Course. */
function subject(shown: Shown) {
  const work = quoted(shown.work.title);
  if (shown.kind === "task.create" || shown.kind === "task.reopen") {
    const minutes = shown.task?.minutes;
    const meta = [shown.work.course, minutes ? `${minutes} Min.` : null]
      .filter(Boolean)
      .join(" · ");
    return { title: `Aufgabe ${work}`, meta };
  }
  const title = `Lernblock für ${work}`;
  if (shown.kind === "studyBlock.remove")
    return { title, meta: <del>{shortSpan(shown.from!)}</del> };
  if (shown.kind === "studyBlock.move" && shown.from)
    return {
      title,
      meta: `${shortSpan(shown.from)} → ${shortSpan(shown.to!)}`,
    };
  return { title, meta: shortSpan(shown.to!) };
}

function Row({
  icon,
  tone,
  title,
  meta,
  label,
}: {
  icon: ReactNode;
  tone: Tone;
  title: string;
  meta: ReactNode;
  label?: string;
}) {
  return (
    <div className="flex max-w-[647px] items-center gap-2 rounded-lg bg-white px-4 py-3 font-sans outline-1 outline-base-700/15">
      <div
        className={cn(
          "flex self-stretch py-0.5 [&_svg]:size-4",
          tones[tone].icon,
        )}
      >
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col text-sm leading-5">
        <span className="font-medium text-base-800">{title}</span>
        {meta && <span className="text-base-500">{meta}</span>}
      </div>
      {label && (
        <span className={cn("shrink-0 text-xs font-medium", tones[tone].label)}>
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * Where a proposal nunio made in an answer stands (ADR-0019), in the answer itself. While it waits, it is asked at the
 * composer; this only says so.
 */
export function ProposalOutcome({
  saved,
  sending = false,
}: {
  saved: SavedProposal | undefined;
  /** The student's decisions on its answer's proposals are being sent. */
  sending?: boolean;
}) {
  if (!saved)
    return (
      <Row
        icon={<LoaderCircle className="motion-safe:animate-spin" />}
        tone="neutral"
        title="Vorschlag wird gespeichert …"
        meta="Gleich kannst du ihn unten prüfen"
      />
    );
  if (!saved.action)
    return (
      <Row
        icon={<CircleAlert />}
        tone="neutral"
        title="Dieser Vorschlag konnte nicht gestellt werden"
        meta="Frag nunio einfach noch einmal"
      />
    );
  const { title, meta } = subject(saved.action.shown);
  return (
    <Row
      {...standing(saved.action, sending)}
      title={title}
      // Failed is what the student reports of an Action nunio could not confirm.
      meta={saved.action.status === "failed" ? "Laut dir nicht passiert" : meta}
    />
  );
}
