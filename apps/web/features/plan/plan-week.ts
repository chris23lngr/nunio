import {
  addWeeks,
  eachDayOfInterval,
  endOfISOWeek,
  format,
  getISOWeek,
  isSameMonth,
  isSameYear,
  startOfISOWeek,
  subWeeks,
} from "date-fns";
import { de } from "date-fns/locale";

const fmt = (day: Date, pattern: string) =>
  format(day, pattern, { locale: de });

/** Monday to Sunday of the ISO week containing `day`, each at 00:00. */
export function weekDays(day: Date): Date[] {
  return eachDayOfInterval({
    start: startOfISOWeek(day),
    end: endOfISOWeek(day),
  });
}

/** "KW46, 9.–15. Nov" for the Monday–Sunday ISO week containing `day`. */
export function weekLabel(day: Date): string {
  const start = startOfISOWeek(day);
  const end = endOfISOWeek(day);
  const range = !isSameYear(start, end)
    ? `${fmt(start, "d. LLL y")} – ${fmt(end, "d. LLL y")}`
    : isSameMonth(start, end)
      ? `${fmt(start, "d.")}–${fmt(end, "d. LLL")}`
      : `${fmt(start, "d. LLL")} – ${fmt(end, "d. LLL")}`;
  return `KW${getISOWeek(day)}, ${range}`;
}

export function previousWeek(day: Date): Date {
  return subWeeks(day, 1);
}

export function nextWeek(day: Date): Date {
  return addWeeks(day, 1);
}
