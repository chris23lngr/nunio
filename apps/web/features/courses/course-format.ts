import type { CourseColor, CourseSummary } from "./api/course-queries";

/** "2026-ws" as "Wintersemester 2026/27", "2027-ss" as "Sommersemester 2027". */
export function semesterLabel(semester: string) {
  const [year, season] = semester.split("-");
  return season === "ws"
    ? `Wintersemester ${year}/${String(Number(year) + 1).slice(2)}`
    : `Sommersemester ${year}`;
}

/** Each palette name's swatch and its name in the color picker. */
export const colors: Record<CourseColor, { swatch: string; name: string }> = {
  rose: { swatch: "oklch(64.5% 0.246 16.439)", name: "Rot" },
  orange: { swatch: "oklch(70.5% 0.213 47.604)", name: "Orange" },
  amber: { swatch: "oklch(76.9% 0.188 70.08)", name: "Gelb" },
  emerald: { swatch: "oklch(69.6% 0.17 162.48)", name: "Grün" },
  teal: { swatch: "oklch(70.4% 0.14 182.503)", name: "Türkis" },
  blue: { swatch: "oklch(62.3% 0.214 259.815)", name: "Blau" },
  violet: { swatch: "oklch(60.6% 0.25 292.717)", name: "Violett" },
  fuchsia: { swatch: "oklch(66.7% 0.295 322.15)", name: "Pink" },
};

const weekday = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  timeZone: "UTC",
});
const dayMonth = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});

/** "Blatt 3 · Freitag, 20.11. um 12:00 Uhr"; a date without a time leaves the time out. */
export function dueText(next: NonNullable<CourseSummary["next"]>) {
  const day = new Date(`${next.due.date}T12:00:00Z`);
  const when = `${weekday.format(day)}, ${dayMonth.format(day)}`;
  return `${next.title} · ${when}${next.due.time ? ` um ${next.due.time} Uhr` : ""}`;
}

export type Clash = {
  title: string;
  status: "proposed" | "accepted" | "rejected";
  archived: boolean;
};

/** Why a name is taken, and what to do with the Course that has it instead of making another. */
export function clashText(clash: Clash) {
  const name = `„${clash.title}“`;
  if (clash.status === "proposed")
    return `${name} gibt es schon als Vorschlag von nunio. Nimm ihn oben an, statt einen neuen anzulegen.`;
  if (clash.status === "rejected")
    return `${name} hast du schon einmal abgelehnt. Stelle ihn unter Prüfen wieder her, statt einen neuen anzulegen.`;
  if (clash.archived)
    return `${name} gibt es schon, archiviert. Hebe die Archivierung auf, statt einen neuen anzulegen.`;
  return `${name} gibt es schon unter deinen Kursen. Wähle einen anderen Namen oder ein anderes Kürzel.`;
}

const count = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;
const list = (parts: string[]) =>
  parts.length > 1
    ? `${parts.slice(0, -1).join(", ")} und ${parts.at(-1)}`
    : (parts[0] ?? "");

/** What archiving stops: future Study Blocks go, Responsibilities pause. */
export function archiveText(impact: {
  futureStudyBlocks: number;
  responsibilities: number;
}) {
  const parts = [
    impact.futureStudyBlocks > 0 &&
      `${count(impact.futureStudyBlocks, "geplante Lernzeit wird", "geplante Lernzeiten werden")} entfernt`,
    impact.responsibilities > 0 &&
      `${count(impact.responsibilities, "laufender Auftrag an nunio wird", "laufende Aufträge an nunio werden")} pausiert`,
  ].filter((part): part is string => Boolean(part));
  const stops = "nunio plant und arbeitet nicht mehr für diesen Kurs.";
  return parts.length ? `${stops} ${parts.join(", und ")}.` : stops;
}

/** What deleting removes for good: every Study Block, past ones too. The student's Sources stay. */
export function deleteText(impact: {
  obligations: number;
  tasks: number;
  studyBlocks: number;
}) {
  const parts = [
    impact.obligations > 0 && count(impact.obligations, "Termin", "Termine"),
    impact.tasks > 0 && count(impact.tasks, "Aufgabe", "Aufgaben"),
    impact.studyBlocks > 0 &&
      count(impact.studyBlocks, "Lernzeit", "Lernzeiten"),
  ].filter((part): part is string => Boolean(part));
  const single =
    parts.length === 1 &&
    impact.obligations + impact.tasks + impact.studyBlocks === 1;
  const gone = parts.length
    ? `${list(parts)} ${single ? "wird" : "werden"} endgültig gelöscht.`
    : "Der Kurs wird endgültig gelöscht.";
  return `${gone} Deine Quellen bleiben erhalten.`;
}
