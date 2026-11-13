import ICAL from "ical.js";
import { deadline, hhmm } from "./time.js";

/**
 * One occurrence, identified within its file by the event's UID and, for a repeated event, the start it was scheduled
 * for, which stays the same when that occurrence is moved.
 */
export type CalendarEvent = {
  uid: string | null;
  recurrenceId: Date | null;
  title: string;
  start: Date;
  end: Date;
};
export type CalendarReading =
  | {
      status: "ok";
      events: CalendarEvent[];
      skipped: { allDay: number; outsideWindow: number; truncated: boolean };
    }
  | { status: "invalid" };

const maxBytes = 1024 * 1024;
const maxEvents = 2000;
/** Recurrence steps examined per event, so a dense rule that starts long ago cannot run unbounded. */
const maxSteps = 100_000;

/**
 * Reads the timed events of an iCalendar file that overlap a window, expanding recurrences. Pure: time zones declared in
 * the file are resolved locally (never registered globally), and floating times are read in the student's time zone.
 */
export function readCalendar(
  ics: string,
  { from, until, timeZone }: { from: Date; until: Date; timeZone: string },
): CalendarReading {
  if (Buffer.byteLength(ics) > maxBytes) return { status: "invalid" };
  try {
    const root = new ICAL.Component(ICAL.parse(ics));
    if (root.name !== "vcalendar") return { status: "invalid" };
    const zones = new Map(
      root
        .getAllSubcomponents("vtimezone")
        .map((zone) => [
          String(zone.getFirstPropertyValue("tzid")),
          new ICAL.Timezone(zone),
        ]),
    );
    const instant = (time: ICAL.Time, tzid: string | null) => {
      if (time.zone === ICAL.Timezone.utcTimezone)
        return new Date(
          Date.UTC(
            time.year,
            time.month - 1,
            time.day,
            time.hour,
            time.minute,
            time.second,
          ),
        );
      const wall = Date.UTC(
        time.year,
        time.month - 1,
        time.day,
        time.hour,
        time.minute,
        time.second,
      );
      const declared = tzid ? zones.get(tzid) : undefined;
      if (declared) return new Date(wall - declared.utcOffset(time) * 1000);
      const date = `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
      return deadline(
        date,
        hhmm(time.hour * 60 + time.minute),
        tzid && isTimeZone(tzid) ? tzid : timeZone,
      );
    };
    const vevents = root.getAllSubcomponents("vevent");
    const events: CalendarEvent[] = [];
    const skipped = { allDay: 0, outsideWindow: 0, truncated: false };
    for (const main of vevents.filter(
      (vevent) => !vevent.hasProperty("recurrence-id"),
    )) {
      const uid = main.getFirstPropertyValue("uid");
      const exceptions = vevents.filter(
        (vevent) =>
          vevent.hasProperty("recurrence-id") &&
          vevent.getFirstPropertyValue("uid") === uid,
      );
      const event = new ICAL.Event(main, { exceptions });
      if (
        !(event.startDate instanceof ICAL.Time) ||
        Number.isNaN(event.startDate.year)
      )
        return { status: "invalid" };
      if (event.startDate.isDate) {
        skipped.allDay++;
        continue;
      }
      const tzid = main.getFirstProperty("dtstart")?.getParameter("tzid");
      const zone = typeof tzid === "string" ? tzid : null;
      const title = (event.summary || "Event").trim().slice(0, 500);
      const iterator = event.iterator();
      let found = 0,
        steps = 0;
      for (
        let next = iterator.next();
        next && steps < maxSteps;
        next = iterator.next(), steps++
      ) {
        const details = event.getOccurrenceDetails(next);
        const start = instant(details.startDate, zone),
          end = instant(details.endDate, zone);
        if (
          Number.isNaN(start.getTime()) ||
          Number.isNaN(end.getTime()) ||
          end <= start
        )
          return { status: "invalid" };
        if (start >= until) break;
        if (end <= from) continue;
        found++;
        // A cancelled occurrence is not taking place, whether the event or only this occurrence says so.
        if (
          details.item.component.getFirstPropertyValue("status") === "CANCELLED"
        )
          continue;
        if (events.length === maxEvents) {
          skipped.truncated = true;
          break;
        }
        events.push({
          uid: typeof uid === "string" ? uid : null,
          recurrenceId: event.isRecurring()
            ? instant(details.recurrenceId, zone)
            : null,
          title: details.item.summary?.trim().slice(0, 500) || title,
          start,
          end,
        });
      }
      if (steps === maxSteps) skipped.truncated = true;
      if (!found && !skipped.truncated) skipped.outsideWindow++;
    }
    return {
      status: "ok",
      events: events.sort((a, b) => a.start.getTime() - b.start.getTime()),
      skipped,
    };
  } catch {
    return { status: "invalid" };
  }
}

const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};
