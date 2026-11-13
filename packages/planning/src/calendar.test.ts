import { describe, expect, it } from "vitest";
import { readCalendar } from "./calendar.js";

/** A Berlin wall-clock time in winter (CET, UTC+1). */
const at = (local: string) => new Date(`${local.replace(" ", "T")}:00+01:00`);
const window = {
  from: at("2026-11-01 00:00"),
  until: at("2027-01-31 00:00"),
  timeZone: "Europe/Berlin",
};
const calendar = (...events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");
const berlin = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Berlin",
  "BEGIN:STANDARD",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
].join("\r\n");
const event = (lines: string[]) =>
  [
    "BEGIN:VEVENT",
    `UID:${lines.join("").length}@test`,
    "DTSTAMP:20261101T000000Z",
    ...lines,
    "END:VEVENT",
  ].join("\r\n");

describe("readCalendar", () => {
  it.each([
    {
      name: "an event in a declared time zone",
      ics: calendar(
        berlin,
        event([
          "SUMMARY:Analysis I",
          "DTSTART;TZID=Europe/Berlin:20261109T101500",
          "DTEND;TZID=Europe/Berlin:20261109T114500",
        ]),
      ),
      events: [
        {
          title: "Analysis I",
          start: at("2026-11-09 10:15"),
          end: at("2026-11-09 11:45"),
        },
      ],
    },
    {
      name: "a UTC event",
      ics: calendar(
        event([
          "SUMMARY:Schicht",
          "DTSTART:20261110T160000Z",
          "DTEND:20261110T200000Z",
        ]),
      ),
      events: [
        {
          title: "Schicht",
          start: at("2026-11-10 17:00"),
          end: at("2026-11-10 21:00"),
        },
      ],
    },
    {
      name: "a floating time, read in the student's time zone",
      ics: calendar(
        event([
          "SUMMARY:Tutorium",
          "DTSTART:20261111T140000",
          "DTEND:20261111T160000",
        ]),
      ),
      events: [
        {
          title: "Tutorium",
          start: at("2026-11-11 14:00"),
          end: at("2026-11-11 16:00"),
        },
      ],
    },
    {
      name: "a weekly lecture with an excluded date",
      ics: calendar(
        berlin,
        event([
          "SUMMARY:Lineare Algebra",
          "DTSTART;TZID=Europe/Berlin:20261102T080000",
          "DTEND;TZID=Europe/Berlin:20261102T100000",
          "RRULE:FREQ=WEEKLY;COUNT=3",
          "EXDATE;TZID=Europe/Berlin:20261109T080000",
        ]),
      ),
      events: [
        {
          title: "Lineare Algebra",
          start: at("2026-11-02 08:00"),
          end: at("2026-11-02 10:00"),
        },
        {
          title: "Lineare Algebra",
          start: at("2026-11-16 08:00"),
          end: at("2026-11-16 10:00"),
        },
      ],
    },
  ])("reads $name", ({ ics, events }) => {
    expect(readCalendar(ics, window)).toMatchObject({
      status: "ok",
      events,
      skipped: { allDay: 0, outsideWindow: 0, truncated: false },
    });
  });

  it("gives each occurrence its identity: its UID and, when repeated, the start it was scheduled for", () => {
    const ics = calendar(
      berlin,
      [
        "BEGIN:VEVENT",
        "UID:analysis@uni",
        "DTSTAMP:20261101T000000Z",
        "SUMMARY:Analysis I",
        "DTSTART;TZID=Europe/Berlin:20261102T100000",
        "DTEND;TZID=Europe/Berlin:20261102T120000",
        "RRULE:FREQ=WEEKLY;COUNT=2",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:analysis@uni",
        "DTSTAMP:20261101T000000Z",
        "RECURRENCE-ID;TZID=Europe/Berlin:20261109T100000",
        "SUMMARY:Analysis I",
        "DTSTART;TZID=Europe/Berlin:20261110T140000",
        "DTEND;TZID=Europe/Berlin:20261110T160000",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:sprechstunde@uni",
        "DTSTAMP:20261101T000000Z",
        "SUMMARY:Sprechstunde",
        "DTSTART;TZID=Europe/Berlin:20261104T090000",
        "DTEND;TZID=Europe/Berlin:20261104T100000",
        "END:VEVENT",
      ].join("\r\n"),
    );

    expect(readCalendar(ics, window)).toMatchObject({
      status: "ok",
      events: [
        {
          uid: "analysis@uni",
          recurrenceId: at("2026-11-02 10:00"),
          start: at("2026-11-02 10:00"),
        },
        { uid: "sprechstunde@uni", recurrenceId: null },
        {
          uid: "analysis@uni",
          recurrenceId: at("2026-11-09 10:00"),
          start: at("2026-11-10 14:00"),
        },
      ],
    });
  });

  it("leaves out a cancelled occurrence of a repeated event, and a cancelled event", () => {
    const ics = calendar(
      [
        "BEGIN:VEVENT",
        "UID:analysis@uni",
        "DTSTAMP:20261101T000000Z",
        "SUMMARY:Analysis I",
        "DTSTART:20261102T090000Z",
        "DTEND:20261102T110000Z",
        "RRULE:FREQ=WEEKLY;COUNT=2",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:analysis@uni",
        "DTSTAMP:20261101T000000Z",
        "RECURRENCE-ID:20261109T090000Z",
        "STATUS:CANCELLED",
        "SUMMARY:Analysis I",
        "DTSTART:20261109T090000Z",
        "DTEND:20261109T110000Z",
        "END:VEVENT",
      ].join("\r\n"),
      event([
        "SUMMARY:Exkursion",
        "STATUS:CANCELLED",
        "DTSTART:20261105T090000Z",
        "DTEND:20261105T110000Z",
      ]),
    );

    expect(readCalendar(ics, window)).toMatchObject({
      status: "ok",
      events: [{ title: "Analysis I", start: at("2026-11-02 10:00") }],
    });
  });

  it("skips all-day events and occurrences outside the window, counting them", () => {
    const ics = calendar(
      event([
        "SUMMARY:Feiertag",
        "DTSTART;VALUE=DATE:20261225",
        "DTEND;VALUE=DATE:20261226",
      ]),
      event([
        "SUMMARY:Vorbei",
        "DTSTART:20261001T080000Z",
        "DTEND:20261001T090000Z",
      ]),
    );
    expect(readCalendar(ics, window)).toEqual({
      status: "ok",
      events: [],
      skipped: { allDay: 1, outsideWindow: 1, truncated: false },
    });
  });

  it("caps an unbounded recurrence and says so", () => {
    const ics = calendar(
      event([
        "SUMMARY:Täglich",
        "DTSTART:20261101T060000Z",
        "DTEND:20261101T061500Z",
        "RRULE:FREQ=MINUTELY;INTERVAL=30",
      ]),
    );
    const result = readCalendar(ics, window);
    expect(result).toMatchObject({
      status: "ok",
      skipped: { truncated: true },
    });
    expect(result.status === "ok" && result.events.length).toBe(2000);
  });

  it.each([
    "not a calendar",
    calendar(event(["SUMMARY:Kaputt", "DTSTART:garbage"])),
    "x".repeat(1024 * 1024 + 1),
  ])("refuses a file it cannot read", (ics) => {
    expect(readCalendar(ics, window)).toEqual({ status: "invalid" });
  });
});

it("resolves a time zone the file declares under a non-IANA name, such as Outlook's", () => {
  const outlook = berlin.replace(
    "TZID:Europe/Berlin",
    "TZID:W. Europe Standard Time",
  );
  const ics = calendar(
    outlook,
    event([
      "SUMMARY:Seminar",
      "DTSTART;TZID=W. Europe Standard Time:20261112T120000",
      "DTEND;TZID=W. Europe Standard Time:20261112T140000",
    ]),
  );
  // A student in New York: only the file's own VTIMEZONE gives the right instants.
  expect(
    readCalendar(ics, { ...window, timeZone: "America/New_York" }),
  ).toMatchObject({
    status: "ok",
    events: [
      {
        title: "Seminar",
        start: at("2026-11-12 12:00"),
        end: at("2026-11-12 14:00"),
      },
    ],
  });
});
