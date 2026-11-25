import { differenceInCalendarDays } from "date-fns";

const day = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** A due date as "Mi., 2. Dez.". */
export function dueDay(date: string) {
  return day.format(new Date(`${date}T12:00:00Z`));
}

/** "Mi., 2. Dez. · noch 9 Tage", "… · morgen", "… · heute"; a past date stands alone. */
export function dueLine(date: string, now: Date) {
  const [year, month, dayOfMonth] = date.split("-").map(Number);
  const target = new Date(year!, month! - 1, dayOfMonth!);
  const days = differenceInCalendarDays(target, now);
  const left =
    days > 1
      ? ` · noch ${days} Tage`
      : days === 1
        ? " · morgen"
        : days === 0
          ? " · heute"
          : "";
  return `${dueDay(date)}${left}`;
}
