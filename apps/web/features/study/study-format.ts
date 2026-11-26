import { differenceInCalendarDays } from "date-fns";
import type { LucideIcon } from "lucide-react";
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
} from "lucide-react";
import { timeAgo } from "@/features/shared/time-ago";
import type { Course, Level } from "./api/study-queries";

export type LevelName = Level["level"];

/** Each Understanding Level as Lernen shows it, weakest first: the order "Als Nächstes üben" takes them in. */
export const levels: Record<
  LevelName,
  { label: string; icon: LucideIcon; icon500: string; text: string }
> = {
  weak: {
    label: "Schwach",
    icon: CircleAlert,
    icon500: "text-destructive-500",
    text: "text-destructive-600",
  },
  shaky: {
    label: "Unsicher",
    icon: CircleSlash,
    icon500: "text-warning-500",
    text: "text-warning-700",
  },
  not_studied: {
    label: "Noch nicht gelernt",
    icon: CircleDashed,
    icon500: "text-base-500",
    text: "text-base-600",
  },
  solid: {
    label: "Sicher",
    icon: CircleCheck,
    icon500: "text-success-500",
    text: "text-success-600",
  },
};

/** Assessed work nunio may help with: exams and registrations are not handed in. */
export const handedIn = ["assignment", "presentation", "thesis", "other"];

export type Obligation = Course["obligations"][number];

export const obligationKinds: Record<Obligation["kind"], string> = {
  exam: "Klausur",
  assignment: "Hausarbeit",
  presentation: "Präsentation",
  thesis: "Abschlussarbeit",
  registration: "Anmeldung",
  other: "Abgabe",
};

const dueDay = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const reportedAt = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const reportedDay = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
});
const draftDay = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

type Due = { date: string | null; time: string | null };

/** "Do., 4. Dez., 23:59"; a due date without a time leaves the time out. */
export function dueDayText(due: Due) {
  if (!due.date) return null;
  const day = dueDay.format(new Date(`${due.date}T12:00:00Z`));
  return due.time ? `${day}, ${due.time}` : day;
}

/** Days from today to the due date, by calendar day; null without a date. */
export function daysUntil(due: Due, now: Date) {
  if (!due.date) return null;
  const [year, month, day] = due.date.split("-").map(Number);
  return differenceInCalendarDays(new Date(year!, month! - 1, day!), now);
}

/** "in 11 Tagen", "morgen", "heute". */
export function inDaysText(days: number) {
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  return `in ${days} Tagen`;
}

/** "fällig Do., 4. Dez., 23:59", or "war fällig …" once the day is over. */
export function dueText(due: Due, now: Date) {
  const day = dueDayText(due);
  if (!day) return "ohne Termin";
  return (daysUntil(due, now) ?? 0) < 0 ? `war fällig ${day}` : `fällig ${day}`;
}

/** "Fällig Do., 4. Dez., 23:59 · in 11 Tagen", or "War fällig …" once the day is over. */
export function dueMetaText(due: Due, now: Date) {
  const day = dueDayText(due);
  if (!day) return null;
  const days = daysUntil(due, now) ?? 0;
  return days < 0 ? `War fällig ${day}` : `Fällig ${day} · ${inDaysText(days)}`;
}

/** "am 19. Nov." */
export const reportedDayText = (at: string) =>
  `am ${reportedDay.format(new Date(at))}`;

/** "Bestätigt am 18. Nov." */
export const confirmedText = (at: string) => `Bestätigt ${reportedDayText(at)}`;

/** Where a prefilled value came from: "Gefunden in Syllabus ADS, S. 4", or the student's own. */
export const provenanceText = (
  provenance:
    | { kind: "correction" }
    | { kind: "entry" }
    | { kind: "source"; title: string; page: number },
) =>
  provenance.kind === "source"
    ? `Gefunden in ${provenance.title}, S. ${provenance.page}`
    : provenance.kind === "correction"
      ? "Aus deiner Korrektur"
      : "Von dir eingetragen";

/** "Am 18. Nov., 14:20 als abgegeben gemeldet" */
export const reportedText = (at: string) =>
  `Am ${reportedAt.format(new Date(at))} als abgegeben gemeldet`;

/** "vor 2 Tagen", "gerade eben"; "noch nie" without. */
export function agoText(at: string | null | undefined, now: Date) {
  if (!at) return "noch nie";
  const text = timeAgo(new Date(at), now, "long");
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** "vor 2 Std." for recent drafts, else "Mo., 17. Nov.". */
export function draftDateText(at: string, now: Date) {
  const date = new Date(at);
  if (Math.abs(now.getTime() - date.getTime()) < 24 * 60 * 60 * 1000) {
    return agoText(at, now);
  }
  return draftDay.format(date);
}
