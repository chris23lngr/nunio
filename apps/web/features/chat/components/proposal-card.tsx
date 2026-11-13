"use client";

import { Button } from "@nunio/ui/components/button/button";
import {
  ArrowRight,
  ChevronLeft,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { SavedProposal } from "../api/chat-queries";
import type { Decision } from "../proposal-queue";
import type { Shown } from "../proposal-wording";
import {
  happenedQuestion,
  longSpan,
  noted,
  question,
  quoted,
  shortDay,
  shortSpan,
} from "../proposal-wording";

const strong = (text: string) => (
  <span className="font-medium text-base-700">{text}</span>
);

/** What a waiting proposal would do, beneath its question. */
function details(shown: Shown): ReactNode {
  const course = shown.work.course && <> im Kurs {strong(shown.work.course)}</>;
  switch (shown.kind) {
    case "studyBlock.create":
      return (
        <p>
          nunio möchte einen neuen Lernblock am {strong(longSpan(shown.to!))}{" "}
          für {strong(quoted(shown.work.title))}
          {course} hinzufügen.
        </p>
      );
    case "studyBlock.move":
      return (
        <p className="flex flex-wrap items-center gap-2">
          {shown.from && (
            <>
              <span>{shortSpan(shown.from)}</span>
              <ArrowRight aria-label="nach" className="size-4 text-base-400" />
            </>
          )}
          <span>{shortSpan(shown.to!)}</span>
        </p>
      );
    case "studyBlock.remove":
      return (
        <p>
          <del>{shortSpan(shown.from!)}</del>
        </p>
      );
    case "task.create": {
      const { role, minutes, event } = shown.task ?? {};
      return (
        <p>
          nunio möchte{course} eine neue Aufgabe
          {event && (
            <>
              {" "}
              {role === "preparation"
                ? "zur Vorbereitung des"
                : role === "follow_up"
                  ? "zur Nachbereitung des"
                  : "zum"}{" "}
              Termins {strong(quoted(event.title))} am{" "}
              {strong(shortDay(event.start))}
            </>
          )}{" "}
          anlegen.
          {minutes ? <> Geschätzt {strong(`${minutes} Min.`)}</> : null}
        </p>
      );
    }
    case "task.reopen":
      return (
        <p>
          Du hast diese Aufgabe{course} als erledigt markiert. nunio möchte sie
          wieder auf deine offene Liste setzen.
        </p>
      );
  }
}

/** The card frame shared by every question asked at the composer. */
function ComposerCard({
  label,
  position,
  onBack,
  title,
  children,
  actions,
  focus = false,
}: {
  label: string;
  position: { index: number; total: number };
  onBack?: () => void;
  title: string;
  children: ReactNode;
  actions: ReactNode;
  /** Takes focus when shown, to its first action, so the keyboard follows from one card to the next. */
  focus?: boolean;
}) {
  const buttons = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only when the card is shown.
  useEffect(() => {
    if (focus) buttons.current?.querySelector("button")?.focus();
  }, []);
  return (
    // Tucked under the composer, which overlaps its foot, so its shadow never falls on the composer.
    <section aria-label={label} className="-mb-2 px-6 pt-8">
      <div className="flex flex-col rounded-t-lg bg-white px-6 pt-5 pb-7 font-sans shadow-sm outline-1 outline-base-700/15">
        <div className="flex h-4 items-center gap-4 text-xs text-base-500">
          <span>{label}</span>
          <span className="flex-1" />
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 font-medium hover:text-base-700"
            >
              <ChevronLeft aria-hidden className="size-3.5" />
              Zurück
            </button>
          )}
          <span>
            {position.index + 1} / {position.total}
          </span>
        </div>
        <h2 className="mt-2 text-base leading-6 font-medium text-pretty text-black">
          {title}
        </h2>
        <div className="mt-2 text-sm leading-5 text-base-600">{children}</div>
        <div ref={buttons} className="mt-4 flex items-center justify-end gap-3">
          {actions}
        </div>
      </div>
    </section>
  );
}

/** A waiting proposal, asked at the composer: the exact Action to confirm (ADR-0010), one of a batch. */
export function ProposalCard({
  proposal,
  position,
  busy,
  focus,
  onBack,
  onDecide,
}: {
  proposal: SavedProposal;
  position: { index: number; total: number };
  busy: boolean;
  focus?: boolean;
  onBack?: () => void;
  onDecide: (decision: Decision) => void;
}) {
  const shown = proposal.action!.shown;
  return (
    <ComposerCard
      label={position.total > 1 ? "Vorschläge prüfen" : "Vorschlag prüfen"}
      position={position}
      focus={focus}
      onBack={busy ? undefined : onBack}
      title={question(shown)}
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide("deny")}
          >
            Ablehnen
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onDecide("approve")}>
            {busy && <LoaderCircle className="motion-safe:animate-spin" />}
            {busy ? "Wird gespeichert …" : "Annehmen"}
          </Button>
        </>
      }
    >
      {details(shown)}
      {proposal.notes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {proposal.notes.map((note) => (
            <li key={note} className="flex items-center gap-2">
              <TriangleAlert
                aria-hidden
                className="size-4 shrink-0 text-warning-600"
              />
              {noted[note]}
            </li>
          ))}
        </ul>
      )}
    </ComposerCard>
  );
}

/** An approved proposal nunio could not confirm took effect: only the student can say whether it did. */
export function UnconfirmedActionCard({
  proposal,
  busy,
  focus,
  onResolve,
}: {
  proposal: SavedProposal;
  busy: boolean;
  focus?: boolean;
  onResolve: (resolution: "happened" | "did_not_happen") => void;
}) {
  return (
    <ComposerCard
      label="Nicht bestätigt"
      position={{ index: 0, total: 1 }}
      focus={focus}
      title={happenedQuestion(proposal.action!.shown)}
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onResolve("did_not_happen")}
          >
            Ist nicht passiert
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onResolve("happened")}
          >
            Ist passiert
          </Button>
        </>
      }
    >
      <p>
        nunio hat es versucht, konnte aber nicht bestätigen, dass es geklappt
        hat. Schau kurz in deinen Plan. nunio versucht es nicht noch einmal.
      </p>
    </ComposerCard>
  );
}
