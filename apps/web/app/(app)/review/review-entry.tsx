"use client";

import { cn } from "@nunio/ui";
import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { Input } from "@nunio/ui/components/input/input";
import { Textarea } from "@nunio/ui/components/textarea/textarea";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Calendar,
  CalendarClock,
  Check,
  ClipboardList,
  Ellipsis,
  FileCheck,
  GitCompareArrows,
  Presentation,
} from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useId, useState } from "react";
import type { Citation, Item, Obligation } from "./review-format";
import {
  currentText,
  due,
  factTypes,
  kinds,
  same,
  unsupported,
  valueText,
} from "./review-format";

export type EntryActions = {
  busy: boolean;
  /** The entry whose Correction form is open. */
  editing: string | null;
  setEditing: (id: string | null) => void;
  review: (
    entry: Item,
    action: "confirm" | "reject" | "restore" | "keep_mine",
  ) => void;
  use: (entry: Item, extractionId: string) => void;
  correct: (event: FormEvent<HTMLFormElement>, entry: Item) => void;
};

const icons: Record<Obligation["kind"], LucideIcon> = {
  exam: Calendar,
  assignment: FileCheck,
  presentation: Presentation,
  thesis: BookOpen,
  registration: ClipboardList,
  other: CalendarClock,
};

export function Badge({
  tone = "base",
  children,
}: {
  tone?: "base" | "primary" | "warning";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs font-medium outline-1",
        {
          base: "bg-base-100 text-base-700 outline-base-200",
          primary: "bg-primary-50 text-primary-800 outline-primary-200",
          warning: "bg-warning-50 text-warning-800 outline-warning-500/35",
        }[tone],
      )}
    >
      {children}
    </span>
  );
}

function Confirmed() {
  return (
    <span className="inline-flex h-5.5 shrink-0 items-center gap-1 rounded-full bg-success-50 px-2 text-xs font-medium text-success-800">
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className="size-3 text-success-600"
      />
      Bestätigt
    </span>
  );
}

const quoteText = "text-[13px] leading-5 text-base-700";

/** The passage an entry was read from, with its Source and page; further Sources fold behind a link. */
function Quote({ citations }: { citations: Citation[] }) {
  const [all, setAll] = useState(false);
  const [first, ...more] = citations;
  if (!first) return null;
  const line = (citation: Citation) => (
    <p className="text-xs text-base-500">
      {citation.title}, Seite {citation.page}
    </p>
  );
  return (
    <div className="flex flex-col gap-1 border-l-2 border-base-200 pl-3">
      <blockquote className={quoteText}>„{first.quote}“</blockquote>
      <div className="flex flex-wrap items-baseline gap-1 text-xs text-base-500">
        {line(first)}
        {more.length > 0 && !all && (
          <>
            ·
            <button
              type="button"
              className="font-medium text-primary-700 hover:text-primary-600"
              onClick={() => setAll(true)}
            >
              Auch in {more.length} weiteren
            </button>
          </>
        )}
      </div>
      {all &&
        more.map((citation) => (
          <div key={citation.extractionId} className="flex flex-col gap-1 pt-1">
            <blockquote className={quoteText}>„{citation.quote}“</blockquote>
            {line(citation)}
          </div>
        ))}
    </div>
  );
}

function EntryMenu({ entry, actions }: { entry: Item; actions: EntryActions }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            disabled={actions.busy}
            aria-label={`Aktionen für ${entry.kind === "obligation" ? entry.item.title : entry.item.value}`}
          />
        }
      >
        <Ellipsis aria-hidden="true" className="text-base-600" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => actions.setEditing(entry.item.id)}>
            Korrigieren
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.review(entry, "reject")}>
            Ablehnen
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConfirmButton({
  entry,
  actions,
}: {
  entry: Item;
  actions: EntryActions;
}) {
  return (
    <Button
      variant="outline"
      disabled={actions.busy}
      onClick={() => actions.review(entry, "confirm")}
    >
      <Check
        aria-hidden="true"
        strokeWidth={2.5}
        className="size-3.5 text-success-600"
      />
      Bestätigen
    </Button>
  );
}

const fieldLabel = "text-[13px] leading-4.5 font-medium text-base-700";
const fieldInput = "h-8.5 font-normal text-base-900";

function Field({
  label,
  optional,
  className,
  children,
}: {
  label: string;
  optional?: boolean;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={fieldLabel}>
        {label}
        {optional && (
          <span className="font-normal text-base-500"> (optional)</span>
        )}
      </label>
      {children(id)}
    </div>
  );
}

/** The Correction form, inline under the entry. */
function CorrectionForm({
  entry,
  actions,
}: {
  entry: Item;
  actions: EntryActions;
}) {
  return (
    <form
      aria-label="Korrigieren"
      className="flex flex-col gap-4 rounded-[10px] bg-base-50 p-4 outline-1 outline-base-200"
      onSubmit={(event) => actions.correct(event, entry)}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-base-900">Korrigieren</p>
        <p className="text-[13px] leading-4.5 text-base-600">
          Deine Korrektur gilt auch dann, wenn nunio später etwas anderes liest.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {entry.kind === "obligation" ? (
          <>
            <Field label="Titel">
              {(id) => (
                <Input
                  id={id}
                  name="title"
                  required
                  defaultValue={entry.item.title}
                  className={fieldInput}
                />
              )}
            </Field>
            <div className="flex flex-wrap gap-3">
              <Field label="Datum" className="min-w-40 flex-1">
                {(id) => (
                  <Input
                    id={id}
                    name="date"
                    type="date"
                    defaultValue={entry.item.due.date ?? ""}
                    className={fieldInput}
                  />
                )}
              </Field>
              <Field label="Uhrzeit" className="w-30 shrink-0">
                {(id) => (
                  <Input
                    id={id}
                    name="time"
                    type="time"
                    defaultValue={entry.item.due.time ?? ""}
                    className={fieldInput}
                  />
                )}
              </Field>
              <Field label="Zeitzone" className="w-50 shrink-0">
                {(id) => (
                  <Input
                    id={id}
                    name="timeZone"
                    placeholder="Europe/Berlin"
                    defaultValue={entry.item.due.timeZone ?? ""}
                    className={fieldInput}
                  />
                )}
              </Field>
            </div>
            <Field label="Abgabe" optional>
              {(id) => (
                <Input
                  id={id}
                  name="destination"
                  defaultValue={entry.item.destination ?? ""}
                  className={fieldInput}
                />
              )}
            </Field>
          </>
        ) : (
          <Field label="Wert">
            {(id) => (
              <Textarea
                id={id}
                name="value"
                required
                defaultValue={entry.item.value}
                className="font-normal text-base-900"
              />
            )}
          </Field>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Button type="submit" disabled={actions.busy} className="px-3">
            Korrektur speichern
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={actions.busy}
            className="text-base-600"
            onClick={() => actions.setEditing(null)}
          >
            Abbrechen
          </Button>
        </div>
      </div>
    </form>
  );
}

/** A Disagreement: each value in question with its passage, to use one of them. */
function Choices({ entry, actions }: { entry: Item; actions: EntryActions }) {
  const { item } = entry;
  // An entry is the student's own value just like a Correction.
  const corrected = item.provenance.kind !== "source";
  const live = item.values.filter((value) => !value.overruled);
  // With a Correction, only values that differ from it are in question; without one, every live value is.
  const contested = corrected
    ? live.filter((value) => !same(valueText(value), currentText(entry)))
    : live;
  return (
    // biome-ignore lint/a11y/useSemanticElements: This group contains review content, not a set of form fields.
    <div role="group" aria-label="Widerspruch" className="flex flex-col gap-3">
      <p className="text-sm text-base-700">
        {corrected
          ? `Eine Quelle sagt jetzt etwas anderes als ${item.provenance.kind === "entry" ? "dein Eintrag" : "deine Korrektur"}.`
          : `Deine Quellen widersprechen sich. nunio übernimmt ${entry.kind === "obligation" ? "kein Datum" : "keinen Wert"}, bis du entscheidest.`}
      </p>
      <div className="flex flex-col border-t border-base-700/10">
        <ul>
          {contested.map((value, index) => {
            const [first] = value.citations;
            if (!first) return null;
            return (
              <li
                key={first.extractionId}
                className="flex items-center gap-4 border-b border-base-700/10 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-base-900">
                      {valueText(value)}
                    </p>
                    <Badge tone="primary">Q{index + 1}</Badge>
                  </div>
                  {value.citations.map((citation) => (
                    <div
                      key={citation.extractionId}
                      className="flex flex-col gap-1"
                    >
                      <blockquote className={quoteText}>
                        „{citation.quote}“
                      </blockquote>
                      <p className="text-xs text-base-500">
                        {citation.title}, Seite {citation.page}
                      </p>
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={actions.busy}
                  className="h-8 w-39 px-0"
                  onClick={() => actions.use(entry, first.extractionId)}
                >
                  Diesen übernehmen
                </Button>
              </li>
            );
          })}
        </ul>
        {actions.editing !== item.id && (
          <div className="flex flex-wrap items-center gap-4 pt-3">
            {corrected && (
              <Button
                type="button"
                variant="outline"
                disabled={actions.busy}
                onClick={() => actions.review(entry, "keep_mine")}
              >
                Meine behalten
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={actions.busy}
              className="px-0 text-primary-700 hover:text-primary-600"
              onClick={() => actions.setEditing(item.id)}
            >
              {entry.kind === "obligation"
                ? "Anderes Datum eintragen"
                : "Anderen Wert eintragen"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={actions.busy}
              className="px-0 text-base-600"
              onClick={() => actions.review(entry, "reject")}
            >
              Ablehnen
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** What nunio read before the student's Correction, which no longer counts. */
function CorrectionNote({ entry }: { entry: Item }) {
  const read = entry.item.values.find(
    (value) => !same(valueText(value), currentText(entry)),
  );
  if (entry.item.provenance.kind === "entry" && !entry.item.values.length)
    return (
      <p className="text-xs text-base-500">
        Von dir eingetragen · keine Quelle
      </p>
    );
  return (
    <p className="text-[13px] leading-4.5 text-base-600">
      {read && (
        <>
          nunio hatte <s>{valueText(read)}</s> gelesen.{" "}
        </>
      )}
      Deine Korrektur gilt, auch wenn spätere Quellen etwas anderes sagen.
    </p>
  );
}

/** Everything under an entry's title: its notes, passage or Disagreement, and its Correction form. */
function Details({ entry, actions }: { entry: Item; actions: EntryActions }) {
  const { item } = entry;
  const corrected = item.provenance.kind !== "source";
  return (
    <>
      {item.unsupported && (
        <p className="text-[13px] leading-4.5 text-base-600">
          {unsupported[item.unsupported]}
        </p>
      )}
      {item.disagreement ? (
        <Choices entry={entry} actions={actions} />
      ) : corrected ? (
        <CorrectionNote entry={entry} />
      ) : (
        <Quote citations={item.values.flatMap((value) => value.citations)} />
      )}
      {actions.editing === item.id && (
        <CorrectionForm entry={entry} actions={actions} />
      )}
    </>
  );
}

const provenanceBadge = (entry: Item) =>
  entry.item.provenance.kind === "correction" ? (
    <Badge>deine Korrektur</Badge>
  ) : entry.item.provenance.kind === "entry" ? (
    <Badge>von dir eingetragen</Badge>
  ) : null;

/** An Obligation under "Fristen & Pflichten". */
export function ObligationEntry({
  entry,
  actions,
}: {
  entry: Item & { kind: "obligation" };
  actions: EntryActions;
}) {
  const { item } = entry;
  const Icon = item.disagreement ? GitCompareArrows : icons[item.kind];
  const open = item.state !== "confirmed" && !item.disagreement;
  return (
    <li className="flex items-start gap-4 p-5">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          item.disagreement
            ? "bg-warning-50 text-warning-700 outline-1 outline-warning-500/30"
            : "bg-base-100 text-base-700",
        )}
      >
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[15px] leading-5.5 font-semibold text-base-900">
                {item.title}
              </h4>
              {item.disagreement && <Badge tone="warning">Widerspruch</Badge>}
              {provenanceBadge(entry)}
            </div>
            <p className="text-[13px] leading-4.5 text-base-600">
              {kinds[item.kind]} · {due(item.due)}
            </p>
          </div>
          {item.state === "confirmed" && (
            <>
              <Confirmed />
              <EntryMenu entry={entry} actions={actions} />
            </>
          )}
        </div>
        {(item.destination || item.uncertainty) && (
          <div className="flex flex-wrap items-center gap-2">
            {item.destination && (
              <p className="text-[13px] leading-4.5 text-base-700">
                Abgabe über {item.destination}{" "}
                <span className="text-base-500">(nicht geprüft)</span>
              </p>
            )}
            {item.uncertainty && (
              <Badge tone="warning">Unsicher: {item.uncertainty}</Badge>
            )}
          </div>
        )}
        <Details entry={entry} actions={actions} />
        {open && actions.editing !== item.id && (
          <div className="flex items-center gap-2 pt-1">
            <ConfirmButton entry={entry} actions={actions} />
            <Button
              variant="outline"
              disabled={actions.busy}
              onClick={() => actions.setEditing(item.id)}
            >
              Korrigieren
            </Button>
            <Button
              variant="ghost"
              disabled={actions.busy}
              className="text-base-600"
              onClick={() => actions.review(entry, "reject")}
            >
              Ablehnen
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/** A Topic, rule or detail under "Themen & Details". */
export function FactEntry({
  entry,
  actions,
}: {
  entry: Item & { kind: "fact" };
  actions: EntryActions;
}) {
  const { item } = entry;
  return (
    <li className="flex items-start gap-4 px-5 py-4">
      <p className="w-33 shrink-0 text-[13px] leading-5.5 text-base-500">
        {factTypes[item.type]}
      </p>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-sm leading-5.5 font-medium text-base-900">
            {item.value}
          </h4>
          {item.disagreement && <Badge tone="warning">Widerspruch</Badge>}
          {provenanceBadge(entry)}
          {item.uncertainty && (
            <Badge tone="warning">Unsicher: {item.uncertainty}</Badge>
          )}
        </div>
        <Details entry={entry} actions={actions} />
      </div>
      <div className="flex h-7.5 w-40 shrink-0 items-center justify-end gap-1">
        {item.state === "confirmed" ? (
          <Confirmed />
        ) : (
          !item.disagreement && (
            <ConfirmButton entry={entry} actions={actions} />
          )
        )}
        <EntryMenu entry={entry} actions={actions} />
      </div>
    </li>
  );
}
