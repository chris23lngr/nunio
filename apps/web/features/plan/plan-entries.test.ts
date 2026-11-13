import { expect, test } from "vitest";
import type { Plan } from "./api/plan-queries";
import {
  blockDetails,
  fixedEventDetails,
  planEntries,
  plannedMinutes,
  planSuggestions,
  protectedRanges,
} from "./plan-entries";
import { weekDays } from "./plan-week";

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 10, day, hour, minute).toISOString();

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    obligations: [],
    tasks: [],
    studyBlocks: [],
    fixedEvents: [],
    calendars: [],
    priorities: [],
    limits: {
      preferences: {
        timeZone: "Europe/Berlin",
        studyFromMinute: 8 * 60,
        studyToMinute: 20 * 60,
        maxMinutesPerDay: 240,
      },
      courses: [],
      protectedTime: [],
    },
    proposal: { moves: [], unplanned: [], shortfalls: [], overlaps: [] },
    ...overrides,
  };
}

const exam = {
  id: "ob-1",
  courseId: "c-stats",
  course: "Statistics II",
  title: "Klausur Statistics II",
  kind: "exam" as const,
  state: "confirmed" as const,
  reportedSubmittedAt: null,
  due: at(18, 9),
  estimate: { minutes: 1200, estimatedBy: "nunio" as const, rationale: null },
};
const colors = { "c-stats": "fuchsia" as const };

test("a Study Block for an Obligation is titled by it and colored by its Course", () => {
  const entries = planEntries(
    plan({
      obligations: [exam],
      studyBlocks: [
        {
          id: "b-1",
          work: { kind: "obligation", id: "ob-1" },
          start: at(13, 9),
          end: at(13, 11),
          placedBy: "nunio",
          locked: false,
        },
      ],
    }),
    colors,
  );

  expect(entries).toEqual([
    {
      id: "b-1",
      kind: "study",
      title: "Klausur Statistics II",
      start: new Date(2026, 10, 13, 9),
      end: new Date(2026, 10, 13, 11),
      course: { title: "Statistics II", color: "fuchsia" },
      placedByStudent: false,
      locked: false,
    },
  ]);
});

test("a Study Block for a Task is titled by it and colored by its Obligation's Course or its own", () => {
  const task = (
    id: string,
    obligationId: string | null,
    course: { courseId: string; course: string } | null = null,
  ) => ({
    id,
    title: { "t-1": "Altklausur 2024", "t-2": "Kapitel 6 lesen" }[id] ?? id,
    obligationId,
    courseId: course?.courseId ?? null,
    course: course?.course ?? null,
    estimate: null,
    maxMinutesPerDay: null,
    done: false,
  });
  const block = (id: string, taskId: string) => ({
    id,
    work: { kind: "task" as const, id: taskId },
    start: at(10, 9),
    end: at(10, 10),
    placedBy: "student" as const,
    locked: true,
  });

  const [ofExam, loose, inCourse] = planEntries(
    plan({
      obligations: [exam],
      tasks: [
        task("t-1", "ob-1"),
        task("t-2", null),
        task("VL 3 nacharbeiten", null, {
          courseId: "c-stats",
          course: "Statistics II",
        }),
      ],
      studyBlocks: [
        block("b-1", "t-1"),
        block("b-2", "t-2"),
        block("b-3", "VL 3 nacharbeiten"),
      ],
    }),
    colors,
  );

  expect(ofExam).toMatchObject({
    title: "Altklausur 2024",
    course: { title: "Statistics II", color: "fuchsia" },
    placedByStudent: true,
    locked: true,
  });
  expect(loose).toMatchObject({ title: "Kapitel 6 lesen", course: null });
  expect(inCourse).toMatchObject({
    title: "VL 3 nacharbeiten",
    course: { title: "Statistics II", color: "fuchsia" },
  });
});

test("a Fixed Event is shown without a Course, since the API links none", () => {
  const entries = planEntries(
    plan({
      fixedEvents: [
        {
          id: "f-1",
          title: "Schicht Café",
          start: at(14, 10),
          end: at(14, 14),
          calendarId: "cal-1",
        },
      ],
    }),
    colors,
  );

  expect(entries).toEqual([
    {
      id: "f-1",
      kind: "fixed",
      title: "Schicht Café",
      start: new Date(2026, 10, 14, 10),
      end: new Date(2026, 10, 14, 14),
      course: null,
      placedByStudent: false,
      locked: false,
    },
  ]);
});

test("suggested Study Blocks appear where nunio proposes them, untimed ones not at all", () => {
  const entries = planEntries(
    plan({
      obligations: [exam],
      proposal: {
        moves: [
          {
            kind: "create",
            workId: "ob-1",
            start: at(12, 9),
            end: at(12, 12),
            needsApproval: false,
          },
          {
            kind: "move",
            blockId: "b-1",
            workId: "ob-1",
            from: { start: at(13, 9), end: at(13, 11) },
            to: { start: at(13, 15), end: at(13, 17) },
            needsApproval: true,
          },
          {
            kind: "create",
            workId: "ob-1",
            start: null,
            end: null,
            needsApproval: false,
          },
        ],
        unplanned: [],
        shortfalls: [],
        overlaps: [],
      },
    }),
    colors,
  );

  expect(entries).toEqual([
    {
      id: "move-0",
      kind: "proposal",
      title: "Klausur Statistics II",
      start: new Date(2026, 10, 12, 9),
      end: new Date(2026, 10, 12, 12),
      course: { title: "Statistics II", color: "fuchsia" },
      placedByStudent: false,
      locked: false,
    },
    expect.objectContaining({
      id: "move-1",
      kind: "proposal",
      start: new Date(2026, 10, 13, 15),
      end: new Date(2026, 10, 13, 17),
    }),
  ]);
});

test("Protected Time lands on its weekday, and a one-off range is cut per day", () => {
  const week = weekDays(new Date(2026, 10, 11));
  const limits = plan().limits;
  const ranges = protectedRanges(
    plan({
      limits: {
        ...limits,
        protectedTime: [
          { id: "sunday", weekday: 7, fromMinute: 0, toMinute: 24 * 60 },
          { id: "trip", start: at(12, 18), end: at(13, 10) },
        ],
      },
    }),
    week,
  );

  expect(ranges).toEqual([
    {
      id: "sunday-2026-11-15",
      start: new Date(2026, 10, 15, 0),
      end: new Date(2026, 10, 16, 0),
    },
    {
      id: "trip-2026-11-12",
      start: new Date(2026, 10, 12, 18),
      end: new Date(2026, 10, 13, 0),
    },
    {
      id: "trip-2026-11-13",
      start: new Date(2026, 10, 13, 0),
      end: new Date(2026, 10, 13, 10),
    },
  ]);
});

test("a day's planned minutes add up its Study Blocks only", () => {
  const block = (id: string, day: number, from: number, to: number) => ({
    id,
    work: { kind: "obligation" as const, id: "ob-1" },
    start: at(day, from),
    end: at(day, to),
    placedBy: "nunio" as const,
    locked: false,
  });
  const p = plan({
    obligations: [exam],
    studyBlocks: [
      block("a", 13, 9, 11),
      block("b", 13, 14, 15),
      block("c", 14, 9, 10),
    ],
    fixedEvents: [
      {
        id: "f",
        title: "Vorlesung",
        start: at(13, 11),
        end: at(13, 13),
        calendarId: null,
      },
    ],
  });

  expect(plannedMinutes(p, new Date(2026, 10, 13))).toBe(180);
  expect(plannedMinutes(p, new Date(2026, 10, 15))).toBe(0);
});

test("the suggestions name the work and when, like the grid shows them", () => {
  const suggestions = planSuggestions(
    plan({
      obligations: [exam],
      proposal: {
        moves: [
          {
            kind: "create",
            workId: "ob-1",
            start: null,
            end: null,
            needsApproval: false,
          },
          {
            kind: "move",
            blockId: "b-1",
            workId: "ob-1",
            from: { start: at(13, 9), end: at(13, 11) },
            to: { start: at(13, 15), end: at(13, 17) },
            needsApproval: true,
          },
        ],
        unplanned: [],
        shortfalls: [],
        overlaps: [],
      },
    }),
  );

  expect(suggestions).toEqual([
    {
      id: "move-1",
      kind: "move",
      title: "Klausur Statistics II",
      start: new Date(2026, 10, 13, 15),
      end: new Date(2026, 10, 13, 17),
      needsApproval: true,
    },
  ]);
});

test("a Study Block's details name its Obligation and how much of the Estimate is planned", () => {
  const block = (id: string, day: number) => ({
    id,
    work: { kind: "obligation" as const, id: "ob-1" },
    start: at(day, 9),
    end: at(day, 11),
    placedBy: "student" as const,
    locked: true,
  });
  const p = plan({
    obligations: [
      {
        ...exam,
        estimate: { ...exam.estimate, rationale: "Wie frühere Klausuren." },
      },
    ],
    studyBlocks: [block("b-1", 13), block("b-2", 16)],
  });

  expect(blockDetails(p, "b-1", colors)).toEqual({
    course: { title: "Statistics II", color: "fuchsia" },
    title: "Klausur Statistics II",
    placedBy: "student",
    locked: true,
    start: new Date(2026, 10, 13, 9),
    end: new Date(2026, 10, 13, 11),
    obligation: {
      title: "Klausur Statistics II",
      due: new Date(2026, 10, 18, 9),
    },
    estimate: {
      plannedMinutes: 240,
      estimatedMinutes: 1200,
      rationale: "Wie frühere Klausuren.",
    },
  });
  expect(blockDetails(p, "missing", colors)).toBeNull();
});

test("a Fixed Event's details say what, when, and which calendar it came from", () => {
  const p = plan({
    calendars: [{ id: "cal-1", name: "Uni-Stundenplan", events: 12 }],
    fixedEvents: [
      {
        id: "f-1",
        title: "Vorlesung Analysis II",
        start: at(9, 10),
        end: at(9, 12),
        calendarId: "cal-1",
      },
      {
        id: "f-2",
        title: "Zahnarzt",
        start: at(10, 8),
        end: at(10, 9),
        calendarId: null,
      },
    ],
  });

  expect(fixedEventDetails(p, "f-1")).toEqual({
    title: "Vorlesung Analysis II",
    start: new Date(2026, 10, 9, 10),
    end: new Date(2026, 10, 9, 12),
    calendar: "Uni-Stundenplan",
  });
  expect(fixedEventDetails(p, "f-2")).toMatchObject({ calendar: null });
  expect(fixedEventDetails(p, "missing")).toBeNull();
});
