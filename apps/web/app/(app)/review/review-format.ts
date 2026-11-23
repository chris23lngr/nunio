import type { paths } from "@nunio/api-client";
import { colors } from "@/features/courses/course-format";

export type Course =
  paths["/api/me/review"]["get"]["responses"][200]["content"]["application/json"]["courses"][number];
export type MergeSuggestion =
  paths["/api/me/courses/merge-suggestions"]["get"]["responses"][200]["content"]["application/json"][number];
export type CourseSummary =
  paths["/api/me/courses"]["get"]["responses"][200]["content"]["application/json"]["courses"][number];
export type Plan =
  paths["/api/me/plan"]["get"]["responses"][200]["content"]["application/json"];
export type Series = Plan["eventSeries"][number];
export type FixedEvent = Plan["fixedEvents"][number];
export type Calendar = Plan["calendars"][number];
export type Obligation = Course["obligations"][number];
export type Fact = Course["facts"][number];
export type Item =
  | { kind: "obligation"; item: Obligation }
  | { kind: "fact"; item: Fact };
export type Value = Item["item"]["values"][number];
export type Citation = Value["citations"][number];
type Due = Obligation["due"];

export const kinds: Record<Obligation["kind"], string> = {
  exam: "Klausur",
  assignment: "Abgabe",
  presentation: "Präsentation",
  thesis: "Abschlussarbeit",
  registration: "Anmeldung",
  other: "Frist",
};
export const factTypes: Record<Fact["type"], string> = {
  topic: "Thema",
  course_rule: "Kursregel",
  exam_logistics: "Klausurorganisation",
  ai_use_rule: "KI-Regel",
};
export const unsupported: Record<
  NonNullable<Obligation["unsupported"]>,
  string
> = {
  source_deleted: "Ihre Quelle wurde gelöscht; deine Korrektur bleibt.",
  not_found: "Ihre Quelle erwähnt das nicht mehr; deine Korrektur bleibt.",
};

const day = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const shortDay = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
});
const weekdayShort = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
});
const clock = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
});

/** "Do., 4. Dez. 2026, 23:59 · Europe/Berlin"; without a date, "Datum noch offen". */
export function deadline({ date, time, timeZone }: Omit<Due, "text">) {
  if (!date) return "Datum noch offen";
  const when = `${day.format(new Date(`${date}T12:00:00Z`))}${time ? `, ${time}` : ""}`;
  return timeZone ? `${when} · ${timeZone}` : when;
}
export function due(value: Due) {
  return value.date || value.text === null
    ? deadline(value)
    : `Kein Datum gefunden („${value.text}“)`;
}

export const valueText = (value: Value) =>
  "due" in value ? deadline(value.due) : value.value;
export const currentText = ({ kind, item }: Item) =>
  kind === "obligation" ? deadline(item.due) : item.value;
// Mirrors the server's comparison closely enough to pick out which values differ from a Correction.
export const same = (a: string, b: string) =>
  a.toLocaleLowerCase().replace(/\s+/g, " ").trim() ===
  b.toLocaleLowerCase().replace(/\s+/g, " ").trim();

export const courseName = (course: Course) =>
  `${course.code ? `${course.code} ` : ""}${course.title}`;
export const label = ({ kind, item }: Item) =>
  kind === "obligation"
    ? `${kinds[item.kind]}: ${item.title}`
    : `${factTypes[item.type]}: ${item.value}`;

export const entries = (course: Course): Item[] => [
  ...course.obligations.map((item) => ({ kind: "obligation" as const, item })),
  ...course.facts.map((item) => ({ kind: "fact" as const, item })),
];
/** Entries the student still has to decide on. */
export const openCount = (course: Course) =>
  entries(course).filter(
    ({ item }) => item.state === "unreviewed" || item.disagreement,
  ).length;
/** Entries confirmed without an open Disagreement. */
export const confirmedCount = (course: Course) =>
  entries(course).filter(
    ({ item }) => item.state === "confirmed" && !item.disagreement,
  ).length;
/** Non-rejected entries in a Course. */
export const shownCount = (course: Course) =>
  entries(course).filter(({ item }) => item.state !== "rejected").length;

/** The titles of the Sources a Course's entries were read from, one per Source. */
export const sourceTitles = (course: Course) => [
  ...new Map(
    entries(course).flatMap(({ item }) =>
      item.values.flatMap((value) =>
        value.citations.map(
          (citation) => [citation.sourceId, citation.title] as const,
        ),
      ),
    ),
  ).values(),
];

/** Map course ids to their palette swatch color from /api/me/courses. */
export function buildCourseColors(
  summaries: CourseSummary[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const summary of summaries) {
    result[summary.id] = colors[summary.color]?.swatch ?? "var(--base-400)";
  }
  return result;
}

/** Schedule summary for an Event Series from its Fixed Events and Calendar, if present. */
export function seriesSchedule(
  series: Series,
  fixedEvents: FixedEvent[],
  calendars: Calendar[],
): string | null {
  const matching = fixedEvents
    .filter((event) => event.seriesId === series.id)
    .sort((a, b) => a.start.localeCompare(b.start));
  const calendarName = calendars.find(
    (calendar) => calendar.id === series.calendarId,
  )?.name;
  const parts: string[] = [];
  const first = matching[0];
  const last = matching.at(-1);
  if (first) {
    const start = new Date(first.start);
    const end = new Date(first.end);
    parts.push(
      `${weekdayShort.format(start)}, ${clock.format(start)}–${clock.format(end)}`,
    );
    if (matching.length === 1) {
      parts.push(`1 Termin am ${shortDay.format(start)}`);
    } else if (last) {
      parts.push(
        `${matching.length} Termine bis ${shortDay.format(new Date(last.start))}`,
      );
    }
  }
  if (calendarName) parts.push(calendarName);
  return parts.length > 0 ? parts.join(" · ") : null;
}
