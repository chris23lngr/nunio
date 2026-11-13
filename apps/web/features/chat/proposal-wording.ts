import { format } from "date-fns";
import { de } from "date-fns/locale";
import type { SavedProposal } from "./api/chat-queries";

/** The exact Action a proposal asks for, as its card shows it. */
export type Shown = NonNullable<SavedProposal["action"]>["shown"];
type Span = { start: string; end: string };

/** A whole hour as "10", otherwise "10:30". */
const hour = (at: string) =>
  format(new Date(at), new Date(at).getMinutes() ? "H:mm" : "H");

/** "von 10 bis 12 Uhr". */
const hours = ({ start, end }: Span) =>
  `von ${hour(start)} bis ${hour(end)} Uhr`;

/** "Freitag". */
const weekday = (at: string) => format(new Date(at), "EEEE", { locale: de });

/** "Freitag von 10 bis 12 Uhr". */
const day = (span: Span) => `${weekday(span.start)} ${hours(span)}`;

/** "Freitag 20. Nov. von 10 bis 12 Uhr". */
export const longSpan = (span: Span) =>
  `${format(new Date(span.start), "EEEE d. MMM", { locale: de })} ${hours(span)}`;

/** "Fr., 20. Nov., 10:00 – 12:00 Uhr". */
export const shortSpan = ({ start, end }: Span) =>
  `${format(new Date(start), "EEE, d. MMM, HH:mm", { locale: de })} – ${format(new Date(end), "HH:mm")} Uhr`;

/** "Di., 17. Nov.". */
export const shortDay = (at: string) =>
  format(new Date(at), "EEE, d. MMM", { locale: de });

/** "„Übungsblatt 4“". */
export const quoted = (title: string) => `„${title}“`;

/** The question a waiting proposal's card asks. */
export function question(shown: Shown) {
  const work = quoted(shown.work.title);
  const course = shown.work.course ? ` im Kurs ${shown.work.course}` : "";
  switch (shown.kind) {
    case "studyBlock.create":
      return `Neuen Lernblock am ${day(shown.to!)} hinzufügen?`;
    case "studyBlock.move":
      return `Möchtest du deinen Lernblock für ${work}${course} am ${day((shown.from ?? shown.to)!)} verschieben?`;
    case "studyBlock.remove":
      return `Möchtest du deinen Lernblock für ${work}${course} am ${day(shown.from!)} entfernen?`;
    case "task.create":
      return `Aufgabe ${work} anlegen?`;
    case "task.reopen":
      return `Aufgabe ${work} wieder öffnen?`;
  }
}

/** The question an Action nunio could not confirm asks the student: did it take effect? */
export function happenedQuestion(shown: Shown) {
  const work = quoted(shown.work.title);
  switch (shown.kind) {
    case "studyBlock.create":
      return `Wurde dein Lernblock am ${weekday(shown.to!.start)} angelegt?`;
    case "studyBlock.move":
      return `Wurde dein Lernblock auf ${weekday(shown.to!.start)} verschoben?`;
    case "studyBlock.remove":
      return `Wurde dein Lernblock am ${weekday(shown.from!.start)} entfernt?`;
    case "task.create":
      return `Wurde die Aufgabe ${work} angelegt?`;
    case "task.reopen":
      return `Wurde die Aufgabe ${work} wieder geöffnet?`;
  }
}

/** The Preferences a block would break, as its card notes them. */
export const noted: Record<SavedProposal["notes"][number], string> = {
  outside_study_window: "Außerhalb deines Lernfensters",
  daily_limit: "Über deinem Tageslimit",
  work_limit: "Über dem Tageslimit für diese Arbeit",
};
