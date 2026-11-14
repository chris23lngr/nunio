import {
  differenceInCalendarDays,
  differenceInHours,
  differenceInMinutes,
  differenceInMonths,
  differenceInYears,
  formatDuration,
  intlFormatDistance,
} from "date-fns";
import { de } from "date-fns/locale";

type Unit = "year" | "month" | "week" | "day" | "hour" | "minute";

/** The largest unit of time since `at`, in calendar days before today and in hours and minutes within it. */
function elapsed(at: Date, now: Date): [Unit, number] | null {
  const years = differenceInYears(now, at);
  if (years > 0) return ["year", years];
  const months = differenceInMonths(now, at);
  if (months > 0) return ["month", months];
  const days = differenceInCalendarDays(now, at);
  if (days >= 7) return ["week", Math.floor(days / 7)];
  if (days > 0) return ["day", days];
  const hours = differenceInHours(now, at);
  if (hours > 0) return ["hour", hours];
  const minutes = differenceInMinutes(now, at);
  return minutes > 0 ? ["minute", minutes] : null;
}

/** How long ago a Chat was last active: "3 Tage" in the menu, "Vor 3 Tagen" in the full list. */
export function chatAge(at: Date, now: Date, style: "short" | "long") {
  const since = elapsed(at, now);
  if (!since) return style === "short" ? "Jetzt" : "Gerade eben";
  const [unit, count] = since;
  if (style === "short")
    return formatDuration({ [`${unit}s`]: count }, { locale: de });
  const ago = intlFormatDistance(at, now, {
    unit,
    locale: "de",
    numeric: "always",
  });
  return ago.charAt(0).toUpperCase() + ago.slice(1);
}
