/** The UTC offset of a time zone at an instant, in milliseconds. */
function offsetMs(ms: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(ms).map(part => [part.type, part.value]));
  return Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!) - ms;
}

/**
 * A deadline's instant from its local date and time. A date without a time counts from the start of that day, so work
 * is planned before an exam day, not on it.
 */
export function deadline(date: string, time: string | null, timeZone: string) {
  const wall = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), ...(time ? [+time.slice(0, 2), +time.slice(3, 5)] : [0, 0]));
  // Correct twice: the offset at the guessed instant can differ from the offset at the answer across a DST change.
  const guess = wall - offsetMs(wall, timeZone);
  return new Date(wall - offsetMs(guess, timeZone));
}
