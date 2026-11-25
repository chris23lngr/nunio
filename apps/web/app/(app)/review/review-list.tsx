"use client";

import { createApiClient } from "@nunio/api-client";
import { cn } from "@nunio/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { Button, buttonVariants } from "@nunio/ui/components/button/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nunio/ui/components/collapsible/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import {
  BookOpen,
  CalendarCheck2,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Ellipsis,
  Merge,
  Plus,
} from "lucide-react";
import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/features/shared/components/page-header";
import type { AddObligationInput } from "./review-dialogs";
import { AddObligationDialog, MergeCourseDialog } from "./review-dialogs";
import type { EntryActions } from "./review-entry";
import { FactEntry, ObligationEntry } from "./review-entry";
import type { Course, Item, MergeSuggestion, Series } from "./review-format";
import {
  buildCourseColors,
  confirmedCount,
  courseName,
  due,
  entries,
  factTypes,
  kinds,
  label,
  openCount,
  same,
  shownCount,
  sourceTitles,
} from "./review-format";
import { SeriesReview } from "./series-review";

const SERIES_TAB = "__series__";

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex max-w-[440px] flex-col items-start gap-4 pt-24 pb-30">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg outline-1 outline-dashed outline-base-300">
        <ClipboardCheck aria-hidden="true" className="size-4.5 text-base-500" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-medium text-base-900">
          Noch nichts zu prüfen
        </h2>
        <p className="text-sm leading-5.5 text-base-600">
          Ergebnisse erscheinen, sobald eine Quelle gelesen wurde. Lade einen
          Syllabus oder ein Übungsblatt hoch – nunio zeigt dir dann jede Frist
          mit der Stelle, aus der sie stammt.
        </p>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Link
          href="/"
          className={cn(buttonVariants({ variant: "primary" }), "px-3")}
        >
          Quelle hochladen
        </Link>
        <Button type="button" variant="outline" onClick={onAdd}>
          Frist selbst eintragen
        </Button>
      </div>
    </div>
  );
}

function RejectedEntries({
  rejected,
  busy,
  onRestore,
}: {
  rejected: Item[];
  busy: boolean;
  onRestore: (entry: Item) => void;
}) {
  if (rejected.length === 0) return null;
  return (
    <Collapsible className="flex flex-col gap-3">
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 border-t border-base-200 py-3 text-left">
        <ChevronRight
          aria-hidden="true"
          strokeWidth={2.5}
          className="size-3.5 shrink-0 text-base-500 transition-transform group-data-panel-open:rotate-90"
        />
        <span className="text-sm font-medium text-base-600">
          Abgelehnt ({rejected.length})
        </span>
        <span className="text-[13px] leading-4.5 text-base-500">
          · bleiben ausgeblendet, bis du sie wiederherstellst
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="flex flex-col divide-y divide-base-200 rounded-xl border border-base-200 bg-base-50">
          {rejected.map((entry) => (
            <li
              key={entry.item.id}
              className="flex items-center justify-between gap-4 px-5 py-3"
            >
              <span className="min-w-0 flex-1 text-sm text-base-700">
                {label(entry)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => onRestore(entry)}
              >
                Wiederherstellen
              </Button>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

function MergeBanner({
  course,
  target,
  busy,
  onMerge,
  onKeepApart,
}: {
  course: Course;
  target: Course;
  busy: boolean;
  onMerge: () => void;
  onKeepApart: () => void;
}) {
  const sameCode = Boolean(
    course.code && target.code && same(course.code, target.code),
  );
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-[10px] bg-primary-50 px-4 py-3.5 outline-1 outline-primary-200">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white outline-1 outline-primary-200">
        <Merge aria-hidden="true" className="size-4 text-primary-700" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium text-base-900">
          Ähnlich zu „{courseName(target)}“ – zusammenführen?
        </p>
        <p className="text-[13px] leading-4.5 text-base-600">
          {sameCode ? `Gleicher Kurscode ${course.code}. ` : ""}
          Einträge und Quellen wandern mit.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onMerge}
        >
          Zusammenführen
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          className="text-base-600"
          onClick={onKeepApart}
        >
          Nein, verschieden
        </Button>
      </div>
    </div>
  );
}

function CourseRail({
  accepted,
  proposed,
  rejectedCourses,
  openSeriesCount,
  courseColors,
  activeSelection,
  busy,
  onSelect,
  onRestoreCourse,
}: {
  accepted: Course[];
  proposed: Course[];
  rejectedCourses: Course[];
  openSeriesCount: number;
  courseColors: Record<string, string>;
  activeSelection: string | null;
  busy: boolean;
  onSelect: (selection: string) => void;
  onRestoreCourse: (id: string) => void;
}) {
  const hasAccepted = accepted.length > 0;
  const hasCourses = accepted.length > 0 || proposed.length > 0;

  return (
    <nav
      aria-label="Kurse"
      className="flex w-full shrink-0 flex-col gap-1 lg:w-[232px]"
    >
      {hasAccepted && (
        <>
          <p className="px-2.5 pb-1.5 text-xs font-medium text-base-500">
            Kurse
          </p>
          {accepted.map((course) => {
            const open = openCount(course);
            const active = activeSelection === course.id;
            const ariaLabel =
              open > 0
                ? `${course.title} – ${open} offen`
                : `${course.title} – alles bestätigt`;
            return (
              <button
                key={course.id}
                type="button"
                aria-current={active ? "true" : undefined}
                aria-label={ariaLabel}
                onClick={() => onSelect(course.id)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-sm font-medium transition-colors",
                  active
                    ? "bg-base-100 text-base-900"
                    : "text-base-700 hover:bg-base-50",
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      courseColors[course.id] ?? "var(--base-400)",
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{course.title}</span>
                <span className="flex w-6 shrink-0 justify-end">
                  {open > 0 ? (
                    <span className="text-right text-xs font-medium text-warning-700 tabular-nums">
                      {open}
                    </span>
                  ) : (
                    <Check
                      aria-hidden="true"
                      strokeWidth={2.5}
                      className="size-3.5 text-success-600"
                    />
                  )}
                </span>
              </button>
            );
          })}
        </>
      )}

      {proposed.length > 0 && (
        <>
          <p
            className={cn(
              "px-2.5 pb-1.5 text-xs font-medium text-base-500",
              hasAccepted && "pt-5",
            )}
          >
            Vorgeschlagen
          </p>
          {proposed.map((course) => {
            const count = shownCount(course);
            const active = activeSelection === course.id;
            return (
              <button
                key={course.id}
                type="button"
                aria-current={active ? "true" : undefined}
                aria-label={`${course.title} – ${count} gefunden`}
                onClick={() => onSelect(course.id)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-sm font-medium transition-colors",
                  active
                    ? "bg-base-100 text-base-900"
                    : "text-base-700 hover:bg-base-50",
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full border-[1.5px] border-dashed border-base-400"
                />
                <span className="min-w-0 flex-1 truncate">{course.title}</span>
                <span className="w-6 shrink-0 text-right text-xs font-medium text-base-500 tabular-nums">
                  {count}
                </span>
              </button>
            );
          })}
        </>
      )}

      {openSeriesCount > 0 && (
        <>
          <p
            className={cn(
              "px-2.5 pb-1.5 text-xs font-medium text-base-500",
              hasCourses && "pt-5",
            )}
          >
            Kalender
          </p>
          <button
            type="button"
            aria-current={activeSelection === SERIES_TAB ? "true" : undefined}
            aria-label={`Kalender-Serien – ${openSeriesCount} offen`}
            onClick={() => onSelect(SERIES_TAB)}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-sm font-medium transition-colors",
              activeSelection === SERIES_TAB
                ? "bg-base-100 text-base-900"
                : "text-base-700 hover:bg-base-50",
            )}
          >
            <CalendarCheck2
              aria-hidden="true"
              className="size-3.5 shrink-0 text-base-500"
            />
            <span className="min-w-0 flex-1 truncate">Kalender-Serien</span>
            <span className="w-6 shrink-0 text-right text-xs font-medium text-warning-700 tabular-nums">
              {openSeriesCount}
            </span>
          </button>
        </>
      )}

      {rejectedCourses.length > 0 && (
        <Collapsible className="flex flex-col gap-2 pt-6">
          <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1.5 px-2.5 text-left text-[13px] leading-4.5 text-base-500 hover:text-base-700">
            <ChevronRight
              aria-hidden="true"
              strokeWidth={2.5}
              className="size-3 shrink-0 transition-transform group-data-panel-open:rotate-90"
            />
            <span>Abgelehnte Kurse ({rejectedCourses.length})</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex flex-col gap-1 px-2.5">
              {rejectedCourses.map((course) => (
                <li
                  key={course.id}
                  className="flex items-center justify-between gap-2 py-1 text-[13px] text-base-600"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {courseName(course)}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    className="shrink-0 cursor-pointer text-xs font-medium text-primary-700 hover:text-primary-600 disabled:opacity-50"
                    onClick={() => onRestoreCourse(course.id)}
                  >
                    Wiederherstellen
                  </button>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </nav>
  );
}

function ProposedCourseView({
  course,
  suggestions,
  openCourses,
  busy,
  onDecide,
  onOpenMerge,
  onMergeInto,
  onKeepApart,
  onRestoreEntry,
}: {
  course: Course;
  suggestions: Course[];
  openCourses: Course[];
  busy: boolean;
  onDecide: (decision: "accept" | "reject") => void;
  onOpenMerge: () => void;
  onMergeInto: (target: Course) => void;
  onKeepApart: (target: Course) => void;
  onRestoreEntry: (entry: Item) => void;
}) {
  const all = entries(course);
  const shown = all.filter((entry) => entry.item.state !== "rejected");
  const rejected = all.filter((entry) => entry.item.state === "rejected");
  const sources = sourceTitles(course);
  const metaParts = [
    "Vorgeschlagen",
    course.code,
    sources.length === 1
      ? `aus „${sources[0]}“`
      : sources.length > 1
        ? `aus ${sources.length} Quellen`
        : null,
    `${shown.length} ${shown.length === 1 ? "Eintrag" : "Einträge"} gefunden`,
  ].filter(Boolean);

  return (
    <article
      aria-labelledby={`course-${course.id}`}
      className="flex min-w-0 flex-1 flex-col gap-6"
    >
      <div className="flex items-start gap-4 border-b border-base-200 pb-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full border-[1.5px] border-dashed border-base-400"
            />
            <h2
              id={`course-${course.id}`}
              className="text-xl leading-7 font-medium text-base-900"
            >
              {course.title}
            </h2>
          </div>
          <p className="pl-5 text-[13px] leading-4.5 text-base-600">
            {metaParts.join(" · ")}
          </p>
        </div>
      </div>

      {suggestions.map((target) => (
        <MergeBanner
          key={target.id}
          course={course}
          target={target}
          busy={busy}
          onMerge={() => onMergeInto(target)}
          onKeepApart={() => onKeepApart(target)}
        />
      ))}

      <div className="flex flex-col gap-4 rounded-xl bg-white p-5 shadow-xs outline-1 outline-base-200">
        <div className="flex items-start gap-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 outline-1 outline-primary-200">
            <BookOpen aria-hidden="true" className="size-4 text-primary-700" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 className="text-base font-semibold text-base-900">
              Ist das einer deiner Kurse?
            </h3>
            <p className="text-sm text-base-700">
              nunio hat in einer hochgeladenen Quelle einen Kurs erkannt, den du
              noch nicht hast. Erst wenn du ihn übernimmst, plant nunio seine
              Fristen ein.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-12">
          <Button
            type="button"
            disabled={busy}
            className="px-3"
            onClick={() => onDecide("accept")}
          >
            Ja, übernehmen
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onDecide("reject")}
          >
            Nein, ablehnen
          </Button>
          {openCourses.length > 1 && (
            <>
              <div className="flex-1" />
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                className="px-0 text-primary-700 hover:text-primary-600"
                onClick={onOpenMerge}
              >
                Gleicher Kurs wie …
              </Button>
            </>
          )}
        </div>
      </div>

      {shown.length > 0 && (
        <Collapsible defaultOpen className="flex flex-col gap-3">
          <CollapsibleTrigger className="group flex cursor-pointer items-center gap-2 text-left">
            <ChevronDown
              aria-hidden="true"
              strokeWidth={2.5}
              className="size-3.5 shrink-0 text-base-600 transition-transform group-not-data-panel-open:-rotate-90"
            />
            <span className="text-base font-medium text-base-800">
              {shown.length} {shown.length === 1 ? "Eintrag" : "Einträge"}{" "}
              gefunden
            </span>
            <span className="text-[13px] leading-4.5 text-base-500">
              · prüfbar, sobald du den Kurs übernimmst
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="flex flex-col divide-y divide-base-200 rounded-xl border border-base-200 bg-base-50">
              {shown.map((entry) => (
                <li
                  key={entry.item.id}
                  className="flex items-center gap-4 px-5 py-3"
                >
                  <span className="w-33 shrink-0 text-[13px] leading-5 text-base-500">
                    {entry.kind === "obligation"
                      ? kinds[entry.item.kind]
                      : factTypes[entry.item.type]}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-base-700">
                    {entry.kind === "obligation"
                      ? `${entry.item.title} — ${due(entry.item.due)}`
                      : entry.item.value}
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}

      <RejectedEntries
        rejected={rejected}
        busy={busy}
        onRestore={onRestoreEntry}
      />
    </article>
  );
}

function AcceptedCourseView({
  course,
  swatch,
  suggestions,
  openCourses,
  actions,
  onOpenMerge,
  onMergeInto,
  onKeepApart,
}: {
  course: Course;
  swatch?: string;
  suggestions: Course[];
  openCourses: Course[];
  actions: EntryActions;
  onOpenMerge: () => void;
  onMergeInto: (target: Course) => void;
  onKeepApart: (target: Course) => void;
}) {
  const all = entries(course);
  const shown = all.filter((entry) => entry.item.state !== "rejected");
  const rejected = all.filter((entry) => entry.item.state === "rejected");
  const obligations = shown.filter(
    (entry): entry is Item & { kind: "obligation" } =>
      entry.kind === "obligation",
  );
  const facts = shown.filter(
    (entry): entry is Item & { kind: "fact" } => entry.kind === "fact",
  );
  const sources = sourceTitles(course);
  const open = openCount(course);
  const confirmed = confirmedCount(course);

  return (
    <article
      aria-labelledby={`course-${course.id}`}
      className="flex min-w-0 flex-1 flex-col gap-8"
    >
      <div className="flex items-start gap-4 border-b border-base-200 pb-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: swatch ?? "var(--base-400)" }}
            />
            <h2
              id={`course-${course.id}`}
              className="text-xl leading-7 font-medium text-base-900"
            >
              {course.title}
            </h2>
          </div>
          <p className="pl-5 text-[13px] leading-4.5 text-base-600">
            {course.code && <>{course.code} · </>}
            {sources.length > 0 && (
              <>
                aus {sources.length}{" "}
                {sources.length === 1 ? "Quelle" : "Quellen"} ·{" "}
              </>
            )}
            {open > 0 && (
              <span className="font-medium text-warning-700">{open} offen</span>
            )}
            {open > 0 && confirmed > 0 && " · "}
            {confirmed > 0 && <>{confirmed} bestätigt</>}
            {open === 0 && confirmed === 0 && "Keine Einträge"}
          </p>
        </div>
        {openCourses.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={actions.busy}
                  aria-label={`Kursaktionen für ${course.title}`}
                  className="size-8"
                />
              }
            >
              <Ellipsis aria-hidden="true" className="text-base-600" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={onOpenMerge}>
                  Gleicher Kurs wie …
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {suggestions.map((target) => (
        <MergeBanner
          key={target.id}
          course={course}
          target={target}
          busy={actions.busy}
          onMerge={() => onMergeInto(target)}
          onKeepApart={() => onKeepApart(target)}
        />
      ))}

      <section aria-label="Fristen & Pflichten" className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <h3 className="text-base font-medium text-base-800">
            Fristen &amp; Pflichten
          </h3>
          <span className="text-[13px] leading-4.5 text-base-500 tabular-nums">
            {obligations.length}
          </span>
        </div>
        {obligations.length === 0 ? (
          <p className="rounded-xl border border-base-200 bg-white px-5 py-4 text-sm text-base-500">
            Keine Fristen gefunden.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-base-200 overflow-hidden rounded-xl border border-base-200 bg-white">
            {obligations.map((entry) => (
              <ObligationEntry
                key={entry.item.id}
                entry={entry}
                actions={actions}
              />
            ))}
          </ul>
        )}
      </section>

      {facts.length > 0 && (
        <section aria-label="Themen & Details" className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <h3 className="text-base font-medium text-base-800">
              Themen &amp; Details
            </h3>
            <span className="text-[13px] leading-4.5 text-base-500 tabular-nums">
              {facts.length}
            </span>
          </div>
          <ul className="flex flex-col divide-y divide-base-200 overflow-hidden rounded-xl border border-base-200 bg-white">
            {facts.map((entry) => (
              <FactEntry key={entry.item.id} entry={entry} actions={actions} />
            ))}
          </ul>
        </section>
      )}

      <RejectedEntries
        rejected={rejected}
        busy={actions.busy}
        onRestore={(entry) => actions.review(entry, "restore")}
      />
    </article>
  );
}

export function ReviewList({ apiOrigin }: { apiOrigin: string }) {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const [series, setSeries] = useState<Series[]>([]);
  const [courseColors, setCourseColors] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [mergeCourse, setMergeCourse] = useState<Course | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const client = createApiClient(apiOrigin);
        const [result, similar, plan, summary] = await Promise.all([
          client.GET("/api/me/review"),
          client.GET("/api/me/courses/merge-suggestions").catch(() => null),
          client.GET("/api/me/plan").catch(() => null),
          client.GET("/api/me/courses").catch(() => null),
        ]);
        if (cancelled) return;
        if (!result.data)
          return setError("Prüfen konnte nicht geladen werden.");
        setCourses(result.data.courses);
        // Suggestions, calendar series, and course colors enrich the view; Review still works without them.
        setSuggestions(similar?.data ?? []);
        setSeries(plan?.data?.eventSeries ?? []);
        if (summary?.data?.courses) {
          setCourseColors(buildCourseColors(summary.data.courses));
        }
      } catch {
        if (!cancelled) setError("Prüfen konnte nicht geladen werden.");
      }
    };
    void load();
    // New extractions arrive while the student reviews.
    const timer = setInterval(() => {
      void load();
    }, 5_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [apiOrigin, version]);

  const client = () => createApiClient(apiOrigin);

  async function act(
    request: () => Promise<{ data?: unknown; response: Response }>,
    invalid = "Deine Entscheidung konnte nicht gespeichert werden. Bitte versuche es erneut.",
  ) {
    setBusy(true);
    setError(null);
    try {
      const result = await request();
      if (!result.data)
        throw new Error(
          result.response.status === 400
            ? "Prüfe Datum, Uhrzeit und Zeitzone."
            : invalid,
        );
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : invalid);
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
  }

  const review = (
    { kind, item }: Item,
    action: "confirm" | "reject" | "restore" | "keep_mine",
  ) => {
    void act(() =>
      client().POST("/api/me/review/{kind}/{id}/{action}", {
        params: { path: { kind, id: item.id, action } },
      }),
    );
  };

  const use = ({ kind, item }: Item, extractionId: string) => {
    void act(() =>
      client().POST("/api/me/review/{kind}/{id}/use", {
        params: { path: { kind, id: item.id } },
        body: { extractionId },
      }),
    );
  };

  const decide = (id: string, decision: "accept" | "reject" | "restore") => {
    void act(() =>
      client().POST("/api/me/courses/{id}/decision", {
        params: { path: { id } },
        body: { decision },
      }),
    );
  };

  async function mergeInto(
    course: Course,
    target: Course,
    inlineError = false,
  ): Promise<string | null> {
    setBusy(true);
    if (!inlineError) setError(null);
    let message: string | null = null;
    try {
      const result = await client().POST("/api/me/courses/{id}/merge", {
        params: { path: { id: course.id } },
        body: { into: target.id },
      });
      if (
        result.response.status === 409 &&
        result.error &&
        "items" in result.error
      ) {
        const targetEntries = entries(target);
        const titles = result.error.items
          .map(({ id }) => targetEntries.find((entry) => entry.item.id === id))
          .filter((entry): entry is Item => entry !== undefined)
          .map(label);
        message = `Beide Kurse haben unterschiedliche Korrekturen für ${titles.join(", ")}. Gleiche sie an oder übernimm einen Wert und führe dann erneut zusammen.`;
      } else if (!result.data) {
        message =
          "Die Kurse konnten nicht zusammengeführt werden. Bitte versuche es erneut.";
      }
    } catch {
      message =
        "Die Kurse konnten nicht zusammengeführt werden. Bitte versuche es erneut.";
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
    if (message && !inlineError) setError(message);
    return message;
  }

  /** "Nein, verschieden": Review never suggests merging these two again. */
  const keepApart = (course: Course, other: Course) => {
    void act(
      () =>
        client().POST("/api/me/courses/{id}/keep-apart", {
          params: { path: { id: course.id } },
          body: { other: other.id },
        }),
      "Das konnte nicht gespeichert werden. Bitte versuche es erneut.",
    );
  };

  function correct(event: FormEvent<HTMLFormElement>, { kind, item }: Item) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const field = (name: string) => String(form.get(name) ?? "").trim() || null;
    const body =
      kind === "obligation"
        ? {
            title: field("title") ?? "",
            due: {
              date: field("date"),
              time: field("time"),
              timeZone: field("timeZone"),
            },
            destination: field("destination"),
          }
        : { value: field("value") ?? "" };
    void act(() =>
      client().POST("/api/me/review/{kind}/{id}/correct", {
        params: { path: { kind, id: item.id } },
        body,
      }),
    );
  }

  async function addObligation(
    body: AddObligationInput,
  ): Promise<string | null> {
    setBusy(true);
    try {
      const result = await client().POST("/api/me/obligations", { body });
      if (result.data) return null;
      return (
        {
          400: "Prüfe Datum, Uhrzeit und Zeitzone.",
          404: "Dieser Kurs ist nicht mehr verfügbar.",
          409: "Dieser Kurs hat diese Frist bereits. Korrigiere sie stattdessen.",
        }[result.response.status] ??
        "Die Frist konnte nicht hinzugefügt werden. Bitte versuche es erneut."
      );
    } catch {
      return "Die Frist konnte nicht hinzugefügt werden. Bitte versuche es erneut.";
    } finally {
      setBusy(false);
      setVersion((v) => v + 1);
    }
  }

  const allCourses = courses ?? [];
  const openCourses = allCourses.filter(
    (course) => course.status !== "rejected",
  );
  const accepted = openCourses.filter((course) => course.status === "accepted");
  const proposed = openCourses.filter((course) => course.status === "proposed");
  const rejectedCourses = allCourses.filter(
    (course) => course.status === "rejected",
  );
  const openSeries = series.filter((s) => s.state !== "confirmed");

  const activeSelection = (() => {
    if (selected === SERIES_TAB && openSeries.length > 0) return SERIES_TAB;
    if (selected && openCourses.some((course) => course.id === selected))
      return selected;
    return (
      accepted[0]?.id ??
      proposed[0]?.id ??
      (openSeries.length > 0 ? SERIES_TAB : null)
    );
  })();
  const selectedCourse =
    activeSelection && activeSelection !== SERIES_TAB
      ? (openCourses.find((course) => course.id === activeSelection) ?? null)
      : null;

  const suggestionsFor = (course: Course) =>
    suggestions.flatMap(({ courseId, intoId }) => {
      if (courseId !== course.id) return [];
      const target = openCourses.find((other) => other.id === intoId);
      return target ? [target] : [];
    });

  const entryActions: EntryActions = {
    busy,
    editing,
    setEditing,
    review,
    use,
    correct,
  };

  const completelyEmpty =
    courses !== null && courses.length === 0 && openSeries.length === 0;

  return (
    <main className="relative min-h-dvh bg-white font-sans text-base-800">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Prüfen</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex-1" />
        {courses !== null && (
          <Button type="button" onClick={() => setAddOpen(true)}>
            Frist hinzufügen
            <Plus data-icon="inline-end" aria-hidden="true" />
          </Button>
        )}
      </PageHeader>

      <div className="mx-auto flex w-full max-w-[calc(1086px+4rem)] flex-col gap-8 px-8 pt-20 pb-20">
        <div className="flex flex-col gap-1.5">
          <h1
            id="review-title"
            className="text-2xl font-medium tracking-[-0.01em] text-base-800"
          >
            Prüfen
          </h1>
          <p className="text-sm text-base-600">
            Prüf, was nunio in deinen Quellen gefunden hat. Jeder Eintrag zeigt
            die Stelle, aus der er stammt.
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive-600">
            {error}
          </p>
        )}

        {courses === null ? (
          !error && <p className="text-sm text-base-500">Wird geladen…</p>
        ) : completelyEmpty ? (
          <EmptyState onAdd={() => setAddOpen(true)} />
        ) : (
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-12">
            <CourseRail
              accepted={accepted}
              proposed={proposed}
              rejectedCourses={rejectedCourses}
              openSeriesCount={openSeries.length}
              courseColors={courseColors}
              activeSelection={activeSelection}
              busy={busy}
              onSelect={(next) => {
                setSelected(next);
                setEditing(null);
              }}
              onRestoreCourse={(id) => decide(id, "restore")}
            />

            <div className="flex min-w-0 flex-1 flex-col">
              {activeSelection === SERIES_TAB ? (
                <SeriesReview
                  apiOrigin={apiOrigin}
                  courseColors={courseColors}
                  onChange={() => setVersion((v) => v + 1)}
                />
              ) : selectedCourse ? (
                selectedCourse.status === "proposed" ? (
                  <ProposedCourseView
                    course={selectedCourse}
                    suggestions={suggestionsFor(selectedCourse)}
                    openCourses={openCourses}
                    busy={busy}
                    onDecide={(decision) => decide(selectedCourse.id, decision)}
                    onOpenMerge={() => setMergeCourse(selectedCourse)}
                    onMergeInto={(target) => {
                      void mergeInto(selectedCourse, target);
                    }}
                    onKeepApart={(target) => keepApart(selectedCourse, target)}
                    onRestoreEntry={(entry) => review(entry, "restore")}
                  />
                ) : (
                  <AcceptedCourseView
                    course={selectedCourse}
                    swatch={courseColors[selectedCourse.id]}
                    suggestions={suggestionsFor(selectedCourse)}
                    openCourses={openCourses}
                    actions={entryActions}
                    onOpenMerge={() => setMergeCourse(selectedCourse)}
                    onMergeInto={(target) => {
                      void mergeInto(selectedCourse, target);
                    }}
                    onKeepApart={(target) => keepApart(selectedCourse, target)}
                  />
                )
              ) : (
                <EmptyState onAdd={() => setAddOpen(true)} />
              )}
            </div>
          </div>
        )}
      </div>

      <AddObligationDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        accepted={accepted}
        defaultCourseId={
          selectedCourse?.status === "accepted" ? selectedCourse.id : null
        }
        courseColors={courseColors}
        busy={busy}
        onSubmit={addObligation}
      />

      <MergeCourseDialog
        course={mergeCourse}
        targets={
          mergeCourse
            ? openCourses.filter((other) => other.id !== mergeCourse.id)
            : []
        }
        courseColors={courseColors}
        busy={busy}
        onClose={() => setMergeCourse(null)}
        onMerge={(source, target) => mergeInto(source, target, true)}
      />
    </main>
  );
}
