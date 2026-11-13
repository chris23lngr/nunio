import { randomBytes, randomUUID } from "node:crypto";
import type {
  EstimateRequest,
  Estimator,
  SeriesAssigner,
  SeriesAssignmentInput,
} from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Delegation, Principal } from "@nunio/delegation";
import { createDelegation, principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import type { Facts } from "@nunio/knowledge";
import {
  createCourses,
  createFacts,
  createKnowledgeReader,
  createProjects,
} from "@nunio/knowledge";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Plan } from "./plan.js";
import { createPlan } from "./plan.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
let facts: Facts;
let plan: Plan;
let delegation: Delegation;
/** A Berlin wall-clock time in November (CET, UTC+1). */
const at = (local: string) => new Date(`${local.replace(" ", "T")}:00+01:00`);
const span = (from: string, to: string) => ({ start: at(from), end: at(to) });
let now = at("2026-11-09 08:00");
const clock = { now: () => now };

beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
  facts = createFacts({
    db: runtime,
    keys: createSourceKeys({
      activeVersion: "v1",
      masters: { v1: randomBytes(32) },
    }),
    clock,
  });
  plan = createPlan({ db: runtime, facts, clock });
  delegation = createDelegation({ db: runtime, aiEnabled: () => true });
}, 180_000);
afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
});

async function student(limitMicroUsd = 5_000_000): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({
    data: { id, email: `${id}@example.com`, name: "Student" },
  });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  await admin.allowance.create({ data: { studentId: id, limitMicroUsd } });
  return principal.fromSession({ studentId: id });
}

/** Enters an Obligation under a new accepted Course through the Facts interface, returning its id. */
async function obligation(
  p: Principal,
  title: string,
  date: string,
  time: string | null,
) {
  const entered = await facts.enterObligation(p, {
    course: { title: "Analysis I", code: "MA-101" },
    kind: "assignment",
    title,
    due: { date, time, timeZone: null },
    destination: null,
  });
  if (entered.status !== "ok") throw new Error(entered.status);
  return entered.id;
}

it("proposes Study Blocks before an Obligation's deadline from the student's own Estimate", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");

  expect(
    await plan.estimate(p, { kind: "obligation", id: sheet }, 120),
  ).toEqual({ status: "ok" });
  const view = await plan.view(p);

  expect(view.obligations).toEqual([
    expect.objectContaining({
      id: sheet,
      title: "Blatt 3",
      due: at("2026-11-11 12:00"),
      estimate: { minutes: 120, estimatedBy: "student", rationale: null },
    }),
  ]);
  expect(view.proposal.moves).toEqual([
    {
      kind: "create",
      workId: sheet,
      start: at("2026-11-09 09:00"),
      end: at("2026-11-09 11:00"),
      needsApproval: false,
    },
  ]);
});

it("applies a move only while it matches a fresh proposal", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 120);
  const [move] = (await plan.view(p)).proposal.moves;
  const forged = {
    kind: "create" as const,
    workId: sheet,
    start: at("2026-11-10 09:00"),
    end: at("2026-11-10 17:00"),
    needsApproval: false,
  };

  expect(await plan.apply(p, forged)).toEqual({ status: "stale" });
  expect(await plan.apply(p, move!)).toEqual({ status: "ok" });
  expect(await plan.apply(p, move!)).toEqual({ status: "stale" });

  const view = await plan.view(p);
  expect(view.studyBlocks).toEqual([
    {
      id: expect.any(String),
      work: { kind: "obligation", id: sheet },
      start: at("2026-11-09 09:00"),
      end: at("2026-11-09 11:00"),
      placedBy: "nunio",
      locked: false,
    },
  ]);
  expect(view.proposal.moves).toEqual([]);
});

it("plans an Obligation through its open Tasks, which the student adds, estimates and completes", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  const first = await plan.addTask(p, {
    title: "Aufgaben 1–4",
    obligationId: sheet,
  });
  const second = await plan.addTask(p, {
    title: "Aufgaben 5–8",
    obligationId: sheet,
  });
  if (first.status !== "ok" || second.status !== "ok")
    throw new Error("refused");
  await plan.estimate(p, { kind: "task", id: first.id }, 60);
  await plan.estimate(p, { kind: "task", id: second.id }, 90);

  expect(await plan.completeTask(p, first.id, true)).toEqual({ status: "ok" });
  const view = await plan.view(p);

  expect(view.tasks).toEqual([
    {
      id: first.id,
      title: "Aufgaben 1–4",
      obligationId: sheet,
      courseId: null,
      course: null,
      estimate: { minutes: 60, estimatedBy: "student", rationale: null },
      maxMinutesPerDay: null,
      done: true,
      fixedEventId: null,
      role: null,
      window: null,
    },
    {
      id: second.id,
      title: "Aufgaben 5–8",
      obligationId: sheet,
      courseId: null,
      course: null,
      estimate: { minutes: 90, estimatedBy: "student", rationale: null },
      maxMinutesPerDay: null,
      done: false,
      fixedEventId: null,
      role: null,
      window: null,
    },
  ]);
  expect(view.proposal.moves).toEqual([
    {
      kind: "create",
      workId: second.id,
      start: at("2026-11-09 09:00"),
      end: at("2026-11-09 10:30"),
      needsApproval: false,
    },
  ]);
  expect(
    await plan.addTask(await student(), {
      title: "Fremd",
      obligationId: sheet,
    }),
  ).toEqual({ status: "gone" });
});

it("lets the student place, move, Lock and delete Study Blocks, which a Rebalance then treats as theirs", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 60);
  const work = { kind: "obligation" as const, id: sheet };

  const placed = await plan.placeBlock(p, {
    work,
    start: at("2026-11-10 14:00"),
    end: at("2026-11-10 15:00"),
  });
  if (placed.status !== "ok") throw new Error(placed.status);
  expect((await plan.view(p)).proposal.moves).toEqual([]);
  expect(
    await plan.placeBlock(p, {
      work,
      start: at("2026-11-10 15:00"),
      end: at("2026-11-10 14:00"),
    }),
  ).toEqual({ status: "invalid" });

  expect(
    await plan.moveBlock(p, placed.id, {
      start: at("2026-11-10 16:00"),
      end: at("2026-11-10 17:00"),
    }),
  ).toEqual({ status: "ok" });
  expect(await plan.lockBlock(p, placed.id, true)).toEqual({ status: "ok" });
  expect((await plan.view(p)).studyBlocks).toEqual([
    {
      id: placed.id,
      work,
      start: at("2026-11-10 16:00"),
      end: at("2026-11-10 17:00"),
      placedBy: "student",
      locked: true,
    },
  ]);

  expect(await plan.removeBlock(p, placed.id)).toEqual({ status: "ok" });
  expect((await plan.view(p)).proposal.moves).toEqual([
    expect.objectContaining({ kind: "create", workId: sheet }),
  ]);
  expect(
    await plan.moveBlock(await student(), placed.id, {
      start: at("2026-11-10 16:00"),
      end: at("2026-11-10 17:00"),
    }),
  ).toEqual({ status: "gone" });
});

it("plans within the student's Preferences and weekly Protected Time, breaking ties by Course Priority", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const analysis = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  const physics = await facts.enterObligation(p, {
    course: { title: "Physik", code: "PH-1" },
    kind: "assignment",
    title: "Laborbericht",
    due: { date: "2026-11-11", time: "12:00", timeZone: null },
    destination: null,
  });
  if (physics.status !== "ok") throw new Error(physics.status);
  await plan.estimate(p, { kind: "obligation", id: analysis }, 60);
  await plan.estimate(p, { kind: "obligation", id: physics.id }, 60);
  const physicsCourse = (await facts.review(p)).courses.find(
    (c) => c.code === "PH-1",
  )!.id;

  expect(
    await plan.setPreferences(p, {
      studyFromMinute: 10 * 60,
      studyToMinute: 16 * 60,
      maxMinutesPerDay: 120,
    }),
  ).toEqual({ status: "ok" });
  expect(
    await plan.addProtectedTime(p, {
      weekday: 1,
      fromMinute: 10 * 60,
      toMinute: 12 * 60,
    }),
  ).toMatchObject({ status: "ok" });
  expect(
    await plan.setPriorities(p, [{ kind: "course", id: physicsCourse }]),
  ).toEqual({ status: "ok" });
  const view = await plan.view(p);

  expect(
    view.proposal.moves.map(
      (m) => m.kind === "create" && [m.workId, m.start, m.end],
    ),
  ).toEqual([
    [physics.id, at("2026-11-09 12:00"), at("2026-11-09 13:00")],
    [analysis, at("2026-11-09 13:00"), at("2026-11-09 14:00")],
  ]);
  expect(view.limits).toEqual({
    preferences: {
      timeZone: "Europe/Berlin",
      studyFromMinute: 600,
      studyToMinute: 960,
      maxMinutesPerDay: 120,
    },
    courses: [],
    protectedTime: [
      { id: expect.any(String), weekday: 1, fromMinute: 600, toMinute: 720 },
    ],
  });
  expect(
    await plan.setPreferences(p, {
      studyFromMinute: 900,
      studyToMinute: 600,
      maxMinutesPerDay: 120,
    }),
  ).toEqual({ status: "invalid" });
});

it("expands weekly Protected Time onto every local day, even across the switch to summer time", async () => {
  // Late Friday evening before Sunday 28 March 2027, when Berlin switches to CEST.
  now = new Date("2027-03-26T23:30:00+01:00");
  const p = await student();
  const lab = await obligation(p, "Laborbericht", "2027-03-29", "18:00");
  await plan.estimate(p, { kind: "obligation", id: lab }, 60);
  // Saturday and Sunday are protected all day; nothing may be planned before Monday.
  // Saturday's span stops before midnight, so Sunday is protected only by its own rule.
  await plan.addProtectedTime(p, {
    weekday: 6,
    fromMinute: 0,
    toMinute: 23 * 60,
  });
  await plan.addProtectedTime(p, { weekday: 7, fromMinute: 0, toMinute: 1440 });

  expect((await plan.view(p)).proposal.moves).toEqual([
    {
      kind: "create",
      workId: lab,
      start: new Date("2027-03-29T09:00:00+02:00"),
      end: new Date("2027-03-29T10:00:00+02:00"),
      needsApproval: false,
    },
  ]);
});

it("proposes Estimates only for Obligations and Tasks without one, never replacing the student's own", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  const exam = await obligation(p, "Klausur", "2027-02-12", null);
  await plan.estimate(p, { kind: "obligation", id: exam }, 1200);
  const task = await plan.addTask(p, {
    title: "Altklausuren rechnen",
    obligationId: exam,
  });
  if (task.status !== "ok") throw new Error(task.status);
  const asked: EstimateRequest[][] = [];
  const estimator: Estimator = {
    estimateMicroUsd: () => 10,
    async estimate(items) {
      asked.push([...items]);
      return {
        value: items.map(() => ({ minutes: 180, rationale: "Four proofs." })),
        usage: { microUsd: 5 },
      };
    },
  };

  expect(await plan.proposeEstimates(p, { estimator, delegation })).toEqual({
    status: "ok",
    proposed: 2,
  });
  expect(asked).toEqual([
    [
      { kind: "assignment", title: "Blatt 3", course: "Analysis I" },
      { kind: "task", title: "Altklausuren rechnen", course: "Analysis I" },
    ],
  ]);
  const { obligations, tasks } = await plan.view(p);
  expect(obligations.map((o) => [o.id, o.estimate])).toEqual(
    expect.arrayContaining([
      [
        sheet,
        { minutes: 180, estimatedBy: "nunio", rationale: "Four proofs." },
      ],
      [exam, { minutes: 1200, estimatedBy: "student", rationale: null }],
    ]),
  );
  expect(tasks).toEqual([
    expect.objectContaining({
      id: task.id,
      estimate: {
        minutes: 180,
        estimatedBy: "nunio",
        rationale: "Four proofs.",
      },
    }),
  ]);
  expect(await plan.proposeEstimates(p, { estimator, delegation })).toEqual({
    status: "ok",
    proposed: 0,
  });
  expect(asked).toHaveLength(1);
});

it("refuses to propose Estimates once the Allowance is exhausted, without asking the model", async () => {
  const p = await student(0);
  await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  let calls = 0;
  const estimator: Estimator = {
    estimateMicroUsd: () => 10,
    async estimate(items) {
      calls++;
      return { value: items.map(() => null), usage: { microUsd: 1 } };
    },
  };

  expect(await plan.proposeEstimates(p, { estimator, delegation })).toEqual({
    status: "refused",
    reason: "allowance_exhausted",
  });
  expect(calls).toBe(0);
});

it("plans around Fixed Events entered by hand or imported from a calendar file, and forgets a deleted import", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 60);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    "UID:lecture@test",
    "DTSTAMP:20261101T000000Z",
    "SUMMARY:Analysis I",
    "DTSTART:20261109T080000Z",
    "DTEND:20261109T100000Z",
    "RRULE:FREQ=WEEKLY;COUNT=10",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const entered = await plan.addFixedEvent(p, {
    title: "Schicht",
    start: at("2026-11-09 11:00"),
    end: at("2026-11-09 12:00"),
  });
  const imported = await plan.addCalendar(p, { name: "Stundenplan.ics", ics });
  if (entered.status !== "ok" || imported.status !== "ok")
    throw new Error("refused");
  expect(imported).toMatchObject({
    events: 10,
    skipped: { allDay: 0, outsideWindow: 0, truncated: false },
  });

  const view = await plan.view(p);
  expect(view.fixedEvents.slice(0, 2)).toEqual([
    {
      id: expect.any(String),
      title: "Analysis I",
      start: at("2026-11-09 09:00"),
      end: at("2026-11-09 11:00"),
      calendarId: imported.id,
      seriesId: expect.any(String),
      courseId: null,
    },
    {
      id: entered.id,
      title: "Schicht",
      start: at("2026-11-09 11:00"),
      end: at("2026-11-09 12:00"),
      calendarId: null,
      seriesId: null,
      courseId: null,
    },
  ]);
  expect(view.calendars).toEqual([
    { id: imported.id, name: "Stundenplan.ics", events: 10 },
  ]);
  expect(view.proposal.moves).toEqual([
    expect.objectContaining({
      start: at("2026-11-09 12:00"),
      end: at("2026-11-09 13:00"),
    }),
  ]);

  expect(await plan.removeCalendar(p, imported.id)).toEqual({ status: "ok" });
  expect((await plan.view(p)).fixedEvents).toEqual([
    expect.objectContaining({ id: entered.id }),
  ]);
  expect(
    await plan.addCalendar(p, { name: "kaputt.ics", ics: "not a calendar" }),
  ).toEqual({ status: "invalid" });
});

/** A calendar file holding the given VEVENT lines, each event's lines in its own array. */
const icsOf = (...events: string[][]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    ...events.flatMap((lines) => [
      "BEGIN:VEVENT",
      "DTSTAMP:20261101T000000Z",
      ...lines,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ].join("\r\n");
const weeklyLecture = [
  "UID:analysis@uni",
  "SUMMARY:Analysis I",
  "DTSTART:20261102T090000Z",
  "DTEND:20261102T110000Z",
  "RRULE:FREQ=WEEKLY;COUNT=4",
];

it("updates a calendar added again, keeping its Fixed Events and their IDs", async () => {
  now = at("2026-11-01 08:00");
  const p = await student();
  const first = await plan.addCalendar(p, {
    name: "Stundenplan.ics",
    ics: icsOf(weeklyLecture),
  });
  if (first.status !== "ok") throw new Error(first.status);
  const before = (await plan.view(p)).fixedEvents;

  expect(
    await plan.addCalendar(p, {
      name: "Stundenplan (1).ics",
      ics: icsOf(weeklyLecture),
    }),
  ).toMatchObject({ status: "ok", id: first.id, events: 4 });
  const view = await plan.view(p);
  expect(view.calendars).toEqual([
    { id: first.id, name: "Stundenplan.ics", events: 4 },
  ]);
  expect(view.fixedEvents).toEqual(before);
});

it("moves a Fixed Event the calendar moved, keeping its ID, and drops one it no longer has, while past ones stay", async () => {
  now = at("2026-11-01 08:00");
  const p = await student();
  await plan.addCalendar(p, {
    name: "Stundenplan.ics",
    ics: icsOf(weeklyLecture),
  });
  const [, past, moved] = (await plan.view(p)).fixedEvents;

  now = at("2026-11-10 08:00");
  await plan.addCalendar(p, {
    name: "Stundenplan.ics",
    ics: icsOf(
      [...weeklyLecture, "EXDATE:20261123T090000Z", "EXDATE:20261109T090000Z"],
      [
        "UID:analysis@uni",
        "RECURRENCE-ID:20261116T090000Z",
        "SUMMARY:Analysis I",
        "DTSTART:20261117T130000Z",
        "DTEND:20261117T150000Z",
      ],
    ),
  });

  expect((await plan.view(p)).fixedEvents.map((e) => [e.id, e.start])).toEqual([
    [expect.any(String), at("2026-11-02 10:00")],
    [past!.id, at("2026-11-09 10:00")],
    [moved!.id, at("2026-11-17 14:00")],
  ]);
});

it("groups a calendar's Fixed Events into Event Series by title, whether repeated or listed one by one", async () => {
  now = at("2026-11-01 08:00");
  const p = await student();
  const tutorial = (day: string) => [
    `UID:tutorium-${day}@uni`,
    "SUMMARY:Tutorium Analysis",
    `DTSTART:202611${day}T130000Z`,
    `DTEND:202611${day}T150000Z`,
  ];
  const ics = icsOf(weeklyLecture, tutorial("04"), tutorial("11"));
  const added = await plan.addCalendar(p, { name: "Stundenplan.ics", ics });
  if (added.status !== "ok") throw new Error(added.status);
  const entered = await plan.addFixedEvent(p, {
    title: "Analysis I",
    start: at("2026-11-05 10:00"),
    end: at("2026-11-05 11:00"),
  });
  if (entered.status !== "ok") throw new Error(entered.status);

  const view = await plan.view(p);
  expect(view.eventSeries).toEqual([
    {
      id: expect.any(String),
      calendarId: added.id,
      title: "Analysis I",
      courseId: null,
      state: "undecided",
    },
    {
      id: expect.any(String),
      calendarId: added.id,
      title: "Tutorium Analysis",
      courseId: null,
      state: "undecided",
    },
  ]);
  const [lecture, tutorium] = view.eventSeries;
  const seriesOf = (title: string, calendarId: string | null) =>
    view.fixedEvents
      .filter((e) => e.title === title && e.calendarId === calendarId)
      .map((e) => e.seriesId);
  expect(seriesOf("Analysis I", added.id)).toEqual(Array(4).fill(lecture!.id));
  expect(seriesOf("Tutorium Analysis", added.id)).toEqual(
    Array(2).fill(tutorium!.id),
  );
  expect(seriesOf("Analysis I", null)).toEqual([null]);

  await plan.addCalendar(p, { name: "Stundenplan.ics", ics });
  expect((await plan.view(p)).eventSeries).toEqual(view.eventSeries);
});

it("drops an Event Series once the calendar lists none of its events", async () => {
  now = at("2026-11-01 08:00");
  const p = await student();
  await plan.addCalendar(p, {
    name: "Stundenplan.ics",
    ics: icsOf(weeklyLecture),
  });

  await plan.addCalendar(p, {
    name: "Stundenplan.ics",
    ics: icsOf(
      weeklyLecture.map((line) =>
        line.startsWith("SUMMARY:") ? "SUMMARY:Analysis I (Mathematik)" : line,
      ),
    ),
  });

  expect((await plan.view(p)).eventSeries).toEqual([
    expect.objectContaining({ title: "Analysis I (Mathematik)" }),
  ]);
});

const cafeShift = [
  "UID:cafe@uni",
  "SUMMARY:Schicht Café",
  "DTSTART:20261107T080000Z",
  "DTEND:20261107T120000Z",
];
/** A student with Analysis I and Physik I, and a calendar with the Analysis lecture and a café shift. */
async function studentWithCalendar(limitMicroUsd?: number) {
  const p = await student(limitMicroUsd);
  const analysis = await obligation(p, "Blatt 3", "2026-11-20", "12:00");
  const physik = await facts.enterObligation(p, {
    course: { title: "Physik I", code: "PH-101" },
    kind: "assignment",
    title: "Übung 2",
    due: { date: "2026-11-20", time: "12:00", timeZone: null },
    destination: null,
  });
  if (physik.status !== "ok") throw new Error(physik.status);
  const courseOf = async (id: string) =>
    (await admin.obligation.findUniqueOrThrow({ where: { id } })).courseId;
  await plan.addCalendar(p, {
    name: "Stundenplan.ics",
    ics: icsOf(weeklyLecture, cafeShift),
  });
  const [lecture, cafe] = (await plan.view(p)).eventSeries;
  return {
    p,
    analysisId: await courseOf(analysis),
    physikId: await courseOf(physik.id),
    lecture: lecture!,
    cafe: cafe!,
  };
}
/** An assigner that puts the Analysis lecture in K1 and knows nothing else, recording what it was asked. */
function fakeAssigner() {
  const asked: SeriesAssignmentInput[] = [];
  const assigner: SeriesAssigner = {
    assignMicroUsd: () => 10,
    async assign(input) {
      asked.push(input);
      return {
        value: input.series.map((s) =>
          s.title === "Analysis I" ? "K1" : null,
        ),
        usage: { microUsd: 5 },
      };
    },
  };
  return { asked, assigner };
}

it("proposes a Course for each undecided Event Series in one metered call, which the student confirms or changes", async () => {
  now = at("2026-11-01 08:00");
  const { p, analysisId, physikId, lecture, cafe } =
    await studentWithCalendar();
  const { asked, assigner } = fakeAssigner();

  expect(await plan.proposeSeriesCourses(p, { assigner, delegation })).toEqual({
    status: "ok",
    proposed: 1,
  });
  expect(asked).toEqual([
    {
      series: [
        { title: "Analysis I", times: ["Mon 10:00–12:00"], events: 4 },
        { title: "Schicht Café", times: ["Sat 09:00–13:00"], events: 1 },
      ],
      courses: [
        { handle: "K1", title: "Analysis I", code: "MA-101" },
        { handle: "K2", title: "Physik I", code: "PH-101" },
      ],
    },
  ]);
  expect((await plan.view(p)).eventSeries).toEqual([
    expect.objectContaining({
      id: lecture.id,
      courseId: analysisId,
      state: "proposed",
    }),
    expect.objectContaining({
      id: cafe.id,
      courseId: null,
      state: "undecided",
    }),
  ]);

  expect(
    await plan.decideSeries(p, lecture.id, { courseId: analysisId }),
  ).toEqual({ status: "ok" });
  expect(await plan.decideSeries(p, cafe.id, { courseId: physikId })).toEqual({
    status: "ok",
  });
  expect((await plan.view(p)).eventSeries).toEqual([
    expect.objectContaining({ courseId: analysisId, state: "confirmed" }),
    expect.objectContaining({ courseId: physikId, state: "confirmed" }),
  ]);
  expect(await plan.proposeSeriesCourses(p, { assigner, delegation })).toEqual({
    status: "ok",
    proposed: 0,
  });
  expect(asked).toHaveLength(1);
});

it("refuses to propose Courses for Event Series once the Allowance is exhausted, without asking the model", async () => {
  now = at("2026-11-01 08:00");
  const { p } = await studentWithCalendar(0);
  const { asked, assigner } = fakeAssigner();

  expect(await plan.proposeSeriesCourses(p, { assigner, delegation })).toEqual({
    status: "refused",
    reason: "allowance_exhausted",
  });
  expect(asked).toEqual([]);
  expect((await plan.view(p)).eventSeries.map((s) => s.state)).toEqual([
    "undecided",
    "undecided",
  ]);
});

it("keeps an Event Series the student said belongs to no Course that way, never proposing one for it again", async () => {
  now = at("2026-11-01 08:00");
  const { p, physikId, cafe } = await studentWithCalendar();
  const { asked, assigner } = fakeAssigner();

  expect(await plan.decideSeries(p, cafe.id, { reject: true })).toEqual({
    status: "ok",
  });
  await plan.addCalendar(p, {
    name: "Stundenplan.ics",
    ics: icsOf(weeklyLecture, cafeShift),
  });
  await plan.proposeSeriesCourses(p, { assigner, delegation });

  expect(asked.flatMap((input) => input.series.map((s) => s.title))).toEqual([
    "Analysis I",
  ]);
  expect((await plan.view(p)).eventSeries).toEqual([
    expect.objectContaining({ title: "Analysis I", state: "proposed" }),
    expect.objectContaining({
      id: cafe.id,
      courseId: null,
      state: "rejected",
    }),
  ]);
  // The student may still put it in a Course themselves.
  expect(await plan.decideSeries(p, cafe.id, { courseId: physikId })).toEqual({
    status: "ok",
  });
});

it("makes a confirmed Event Series' events Course Events, except one the student took out of it", async () => {
  now = at("2026-11-01 08:00");
  const { p, analysisId, lecture } = await studentWithCalendar();
  const { assigner } = fakeAssigner();
  const coursesOf = async () =>
    (await plan.view(p)).fixedEvents.map((e) => [e.title, e.courseId]);

  await plan.proposeSeriesCourses(p, { assigner, delegation });
  expect(new Set((await coursesOf()).map(([, courseId]) => courseId))).toEqual(
    new Set([null]),
  );

  await plan.decideSeries(p, lecture.id, { courseId: analysisId });
  const second = (await plan.view(p)).fixedEvents.filter(
    (e) => e.seriesId === lecture.id,
  )[1]!;
  expect(await plan.detachEvent(p, second.id)).toEqual({ status: "ok" });
  await plan.addCalendar(p, {
    name: "Stundenplan.ics",
    ics: icsOf(weeklyLecture, cafeShift),
  });

  expect(await coursesOf()).toEqual([
    ["Analysis I", analysisId],
    ["Schicht Café", null],
    ["Analysis I", null],
    ["Analysis I", analysisId],
    ["Analysis I", analysisId],
  ]);
});

it("leaves an Event Series undecided once its Course is deleted, keeping its events", async () => {
  now = at("2026-11-01 08:00");
  const { p, analysisId, lecture } = await studentWithCalendar();
  await plan.decideSeries(p, lecture.id, { courseId: analysisId });
  const courses = createCourses({
    db: runtime,
    clock,
    facts,
    responsibilities: {
      pauseForCourse: async () => {},
      endForCourse: async () => {},
    },
  });

  await courses.delete(p, analysisId);

  const view = await plan.view(p);
  expect(view.eventSeries[0]).toMatchObject({
    id: lecture.id,
    courseId: null,
    state: "undecided",
  });
  expect(
    view.fixedEvents.filter((e) => e.seriesId === lecture.id),
  ).toHaveLength(4);
});

it("adds a Preparation and a Follow-up for each Course Event in the next 14 days, each with its window, once", async () => {
  now = at("2026-11-01 08:00");
  const { p, analysisId, lecture } = await studentWithCalendar();
  await plan.decideSeries(p, lecture.id, { courseId: analysisId });
  const [first, second] = (await plan.view(p)).fixedEvents.filter(
    (e) => e.seriesId === lecture.id,
  );

  expect(
    await plan.setRoutine(p, lecture.id, {
      preparationMinutes: 30,
      followUpMinutes: 60,
    }),
  ).toEqual({ status: "ok" });
  await plan.applyRoutines(p);

  const view = await plan.view(p);
  const task = (event: string, role: "preparation" | "follow_up") =>
    view.tasks.find((t) => t.fixedEventId === event && t.role === role);
  const routine = { obligationId: null, courseId: analysisId };
  const minutes = (n: number) => ({
    minutes: n,
    estimatedBy: "student",
    rationale: null,
  });
  // The lectures on 2 and 9 November, each Monday 10:00–12:00; the one on 16 November lies beyond 14 days.
  expect(view.tasks).toHaveLength(4);
  expect(task(first!.id, "preparation")).toMatchObject({
    ...routine,
    title: "Vorbereitung: Analysis I",
    estimate: minutes(30),
    // The first lecture has none before it.
    window: span("2026-10-26 10:00", "2026-11-02 10:00"),
  });
  expect(task(first!.id, "follow_up")).toMatchObject({
    ...routine,
    title: "Nachbereitung: Analysis I",
    estimate: minutes(60),
    window: span("2026-11-02 12:00", "2026-11-09 10:00"),
  });
  expect(task(second!.id, "preparation")).toMatchObject({
    window: span("2026-11-02 12:00", "2026-11-09 10:00"),
  });
  expect(task(second!.id, "follow_up")).toMatchObject({
    window: span("2026-11-09 12:00", "2026-11-16 10:00"),
  });
  expect(view.proposal.moves).toContainEqual(
    expect.objectContaining({
      kind: "create",
      workId: task(first!.id, "preparation")!.id,
      ...span("2026-11-01 09:00", "2026-11-01 09:30"),
    }),
  );

  await plan.applyRoutines(p);
  expect((await plan.view(p)).tasks).toHaveLength(4);
});

it("adds only a Follow-up for a past Course Event whose window is open, and rolls on with the days", async () => {
  now = at("2026-11-01 08:00");
  const { p, analysisId, lecture } = await studentWithCalendar();
  await plan.decideSeries(p, lecture.id, { courseId: analysisId });
  const lectures = (await plan.view(p)).fixedEvents.filter(
    (e) => e.seriesId === lecture.id,
  );
  const roles = async () =>
    (await plan.view(p)).tasks
      .map(
        (t) =>
          `${lectures.findIndex((e) => e.id === t.fixedEventId) + 1} ${t.role}`,
      )
      .sort();

  // The first lecture was yesterday.
  now = at("2026-11-03 08:00");
  await plan.setRoutine(p, lecture.id, {
    preparationMinutes: 30,
    followUpMinutes: 60,
  });
  expect(await roles()).toEqual([
    "1 follow_up",
    "2 follow_up",
    "2 preparation",
    "3 follow_up",
    "3 preparation",
  ]);

  now = at("2026-11-10 08:00");
  await plan.applyRoutines(p);
  expect(await roles()).toEqual([
    "1 follow_up",
    "2 follow_up",
    "2 preparation",
    "3 follow_up",
    "3 preparation",
    "4 follow_up",
    "4 preparation",
  ]);
});

it("adds no Tasks for a series only proposed for a Course, until the student confirms it", async () => {
  now = at("2026-11-01 08:00");
  const { p, analysisId, lecture } = await studentWithCalendar();
  await plan.proposeSeriesCourses(p, {
    assigner: fakeAssigner().assigner,
    delegation,
  });
  await plan.setRoutine(p, lecture.id, {
    preparationMinutes: 30,
    followUpMinutes: 60,
  });
  expect((await plan.view(p)).tasks).toEqual([]);

  await plan.decideSeries(p, lecture.id, { courseId: analysisId });
  await plan.applyRoutines(p);
  expect((await plan.view(p)).tasks).toHaveLength(4);
});

it("applies every student's Routines in one tick, as the daily schedule does", async () => {
  now = at("2026-11-01 08:00");
  const students = await Promise.all([
    studentWithCalendar(),
    studentWithCalendar(),
  ]);
  for (const { p, analysisId, lecture } of students) {
    await plan.decideSeries(p, lecture.id, { courseId: analysisId });
    await plan.setRoutine(p, lecture.id, {
      preparationMinutes: 0,
      followUpMinutes: 60,
    });
  }

  now = at("2026-11-10 08:00");
  await plan.tickRoutines();

  // Follow-ups for the lectures on 2, 9, 16 and 23 November.
  for (const { p } of students)
    expect((await plan.view(p)).tasks).toHaveLength(4);
});

it("ranks Courses, Projects and Obligations in one list, an Obligation's own rank winning over its Project's and Course's", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  const lab = await obligation(p, "Laborbericht", "2026-11-11", "12:00");
  const talk = await obligation(p, "Referat", "2026-11-11", "12:00");
  for (const id of [sheet, lab, talk])
    await plan.estimate(p, { kind: "obligation", id }, 60);
  const project = await createProjects({ db: runtime }).create(p, {
    name: "Labor",
    courseIds: [],
    obligationId: lab,
  });
  if (project.status !== "ok") throw new Error(project.status);
  const sheetCourse = (await plan.view(p)).obligations.find(
    (o) => o.id === sheet,
  )!.courseId;

  // Talk outranks the lab's Project, which outranks the sheet's Course.
  expect(
    await plan.setPriorities(p, [
      { kind: "obligation", id: talk },
      { kind: "project", id: project.id },
      { kind: "course", id: sheetCourse },
    ]),
  ).toEqual({ status: "ok" });
  const view = await plan.view(p);

  expect(
    view.proposal.moves.map((m) => m.kind === "create" && m.workId),
  ).toEqual([talk, lab, sheet]);
  expect(view.priorities).toEqual([
    { kind: "obligation", id: talk },
    { kind: "project", id: project.id },
    { kind: "course", id: sheetCourse },
  ]);
  expect(
    await plan.setPriorities(await student(), [
      { kind: "obligation", id: talk },
    ]),
  ).toEqual({ status: "gone" });
});

it("applies a Task's own daily limit over its Course's, and the Course's over the global one", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-13", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 180);
  const courseId = (await plan.view(p)).obligations[0]!.courseId;

  expect(await plan.setCourseLimit(p, courseId, 60)).toEqual({ status: "ok" });
  expect(
    (await plan.view(p)).proposal.moves.map(
      (m) => m.kind === "create" && [m.start, m.end],
    ),
  ).toEqual([
    [at("2026-11-09 09:00"), at("2026-11-09 10:00")],
    [at("2026-11-10 09:00"), at("2026-11-10 10:00")],
    [at("2026-11-11 09:00"), at("2026-11-11 10:00")],
  ]);
  const task = await plan.addTask(p, { title: "Beweise", obligationId: sheet });
  if (task.status !== "ok") throw new Error(task.status);
  await plan.estimate(p, { kind: "task", id: task.id }, 180);
  expect(await plan.setTaskLimit(p, task.id, 90)).toEqual({ status: "ok" });
  expect(
    (await plan.view(p)).proposal.moves.map(
      (m) => m.kind === "create" && [m.start, m.end],
    ),
  ).toEqual([
    [at("2026-11-09 09:00"), at("2026-11-09 10:30")],
    [at("2026-11-10 09:00"), at("2026-11-10 10:30")],
  ]);
  expect(await plan.setCourseLimit(p, courseId, 10)).toEqual({
    status: "invalid",
  });
});

it("never plans into a one-off span of Protected Time, such as a trip", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-13", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 60);

  const trip = await plan.addProtectedTime(p, {
    start: at("2026-11-09 00:00"),
    end: at("2026-11-11 00:00"),
  });
  expect(trip).toMatchObject({ status: "ok" });
  const view = await plan.view(p);

  expect(view.proposal.moves).toEqual([
    expect.objectContaining({
      start: at("2026-11-11 09:00"),
      end: at("2026-11-11 10:00"),
    }),
  ]);
  expect(view.limits.protectedTime).toEqual([
    {
      id: expect.any(String),
      start: at("2026-11-09 00:00"),
      end: at("2026-11-11 00:00"),
    },
  ]);
  expect(
    await plan.addProtectedTime(p, {
      start: at("2026-11-11 00:00"),
      end: at("2026-11-09 00:00"),
    }),
  ).toEqual({ status: "invalid" });
});

it("serves Fixed Events to the planning scope as operational Facts, apart from course material", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const shift = await plan.addFixedEvent(p, {
    title: "Schicht",
    start: at("2026-11-10 17:00"),
    end: at("2026-11-10 21:00"),
  });
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VEVENT",
    "UID:l@test",
    "DTSTAMP:20261101T000000Z",
    "SUMMARY:Analysis I",
    "DTSTART:20261111T080000Z",
    "DTEND:20261111T100000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const calendar = await plan.addCalendar(p, { name: "Stundenplan.ics", ics });
  if (shift.status !== "ok" || calendar.status !== "ok")
    throw new Error("refused");
  const reader = createKnowledgeReader({
    db: runtime,
    keys: createSourceKeys({
      activeVersion: "v1",
      masters: { v1: randomBytes(32) },
    }),
    delegation,
    clock,
    embedder: {
      model: "unused",
      dims: 1,
      relevanceFloor: 1,
      estimateMicroUsd: () => 1,
      embed: async () => {
        throw new Error("Fact queries never embed");
      },
    },
  });

  const result = await reader.retrieve(
    p,
    { planning: true },
    { kind: "facts", types: ["fixed_event"] },
  );

  if (result.status !== "ok") throw new Error(result.status);
  expect(result.items.map((i) => [i.channel, i.label, i.provenance])).toEqual([
    ["operational", "Fixed Event (entered by the student)", { kind: "entry" }],
    [
      "operational",
      "Fixed Event from Stundenplan.ics",
      { kind: "calendar", calendarId: calendar.id, name: "Stundenplan.ics" },
    ],
  ]);
  expect(result.render().data).toMatch(
    /^<<<BEGIN operational [0-9a-f]{16}>>>\n\[S1\] Fixed Event \(entered by the student\)\nSchicht, /,
  );
  const ref = result.items[1]!.cite;
  await plan.removeCalendar(p, calendar.id);
  expect((await reader.cite(p, [ref])).get(ref)).toBe("gone");
});

it("proposes, for one Course, the Rebalance of that Course's work as Actions for the gate", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const analysis = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  const other = await facts.enterObligation(p, {
    course: { title: "Physik I", code: "PH-101" },
    kind: "assignment",
    title: "Übung 2",
    due: { date: "2026-11-12", time: "12:00", timeZone: null },
    destination: null,
  });
  if (other.status !== "ok") throw new Error(other.status);
  await plan.estimate(p, { kind: "obligation", id: analysis }, 60);
  await plan.estimate(p, { kind: "obligation", id: other.id }, 60);
  const courseId = (await plan.view(p)).obligations.find(
    (o) => o.id === analysis,
  )!.courseId;

  expect(await plan.intentsFor(p, { courseId })).toEqual([
    {
      kind: "studyBlock.create",
      workId: analysis,
      start: at("2026-11-09 09:00"),
      end: at("2026-11-09 10:00"),
    },
  ]);
});

it("proposes, for one exam, the Rebalance of that exam and its Tasks only", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  const klausur = await facts.enterObligation(p, {
    course: { title: "Analysis I", code: "MA-101" },
    kind: "exam",
    title: "Klausur",
    due: { date: "2026-11-13", time: "10:00", timeZone: null },
    destination: null,
  });
  if (klausur.status !== "ok") throw new Error(klausur.status);
  const task = await plan.addTask(p, {
    title: "Altklausur 2025",
    obligationId: klausur.id,
  });
  if (task.status !== "ok") throw new Error(task.status);
  await plan.estimate(p, { kind: "obligation", id: sheet }, 60);
  await plan.estimate(p, { kind: "task", id: task.id }, 60);

  expect(await plan.intentsFor(p, { obligationId: klausur.id })).toEqual([
    {
      kind: "studyBlock.create",
      workId: task.id,
      start: expect.any(Date),
      end: expect.any(Date),
    },
  ]);
});

it("stops planning work the student reported as handed in, while still showing it", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-09", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 600);
  expect((await plan.view(p)).proposal.shortfalls).not.toEqual([]);

  expect(await facts.reportSubmitted(p, sheet, true)).toEqual({
    status: "ok",
  });
  const view = await plan.view(p);

  expect(view.obligations).toEqual([
    expect.objectContaining({ id: sheet, reportedSubmittedAt: now }),
  ]);
  expect(view.proposal).toMatchObject({ moves: [], shortfalls: [] });
});

it("leaves an Archived Course's work out of the Plan, and brings it back when unarchived", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 120);
  const courses = createCourses({
    db: runtime,
    clock,
    facts,
    responsibilities: {
      pauseForCourse: async () => {},
      endForCourse: async () => {},
    },
  });
  const [course] = (await courses.list(p)).courses;

  await courses.archive(p, course!.id);
  expect(await plan.view(p)).toMatchObject({
    obligations: [],
    proposal: { moves: [], shortfalls: [] },
  });

  await courses.unarchive(p, course!.id);
  expect((await plan.view(p)).obligations).toEqual([
    expect.objectContaining({ id: sheet }),
  ]);
});

it("keeps a Task in a Course, which the Course's daily limit, Archiving and deletion reach", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-20", "12:00");
  const { courseId } = await admin.obligation.findUniqueOrThrow({
    where: { id: sheet },
  });
  const courses = createCourses({
    db: runtime,
    clock,
    facts,
    responsibilities: {
      pauseForCourse: async () => {},
      endForCourse: async () => {},
    },
  });

  expect(
    await plan.addTask(p, {
      title: "VL 3 nacharbeiten",
      obligationId: sheet,
      courseId,
    }),
  ).toEqual({ status: "invalid" });
  expect(
    await plan.addTask(p, {
      title: "VL 3 nacharbeiten",
      obligationId: null,
      courseId: randomUUID(),
    }),
  ).toEqual({ status: "gone" });
  const task = await plan.addTask(p, {
    title: "VL 3 nacharbeiten",
    obligationId: null,
    courseId,
  });
  if (task.status !== "ok") throw new Error(task.status);
  expect((await plan.view(p)).tasks).toEqual([
    expect.objectContaining({
      id: task.id,
      obligationId: null,
      courseId,
      course: "Analysis I",
    }),
  ]);

  const work = { kind: "task", id: task.id } as const;
  await plan.placeBlock(p, {
    work,
    start: at("2026-11-12 09:00"),
    end: at("2026-11-12 10:00"),
  });
  await plan.setCourseLimit(p, courseId, 60);
  expect(
    await plan.check(p, {
      kind: "create",
      work,
      start: at("2026-11-12 11:00"),
      end: at("2026-11-12 12:00"),
    }),
  ).toEqual({ status: "ok", notes: ["work_limit"] });

  expect(await courses.impact(p, courseId)).toMatchObject({
    tasks: 1,
    studyBlocks: 1,
    futureStudyBlocks: 1,
  });
  await courses.archive(p, courseId);
  expect((await plan.view(p)).tasks).toEqual([]);
  expect(await admin.studyBlock.count({ where: { taskId: task.id } })).toBe(0);
  await courses.unarchive(p, courseId);
  expect((await plan.view(p)).tasks).toEqual([
    expect.objectContaining({ id: task.id }),
  ]);

  await courses.delete(p, courseId);
  expect(await admin.task.findUnique({ where: { id: task.id } })).toBeNull();
});

it("proposes, for one Course, moving the block of a Task in that Course as an Action for the gate", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-20", "12:00");
  const { courseId } = await admin.obligation.findUniqueOrThrow({
    where: { id: sheet },
  });
  const task = await plan.addTask(p, {
    title: "VL 3 nacharbeiten",
    obligationId: null,
    courseId,
  });
  if (task.status !== "ok") throw new Error(task.status);
  const placed = await plan.placeBlock(p, {
    work: { kind: "task", id: task.id },
    start: at("2026-11-10 09:00"),
    end: at("2026-11-10 10:00"),
  });
  if (placed.status !== "ok") throw new Error(placed.status);
  await plan.addFixedEvent(p, {
    title: "Sprechstunde",
    start: at("2026-11-10 09:00"),
    end: at("2026-11-10 10:00"),
  });

  expect(await plan.intentsFor(p, { courseId })).toEqual([
    {
      kind: "studyBlock.move",
      studyBlockId: placed.id,
      start: expect.any(Date),
      end: expect.any(Date),
    },
  ]);
});

it("refuses a proposed Study Block in the past, in Protected Time, over a Fixed Event or another block, and a move of a Locked one", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const work = {
    kind: "obligation",
    id: await obligation(p, "Blatt 3", "2026-11-13", "12:00"),
  } as const;
  await plan.addProtectedTime(p, {
    weekday: 1,
    fromMinute: 12 * 60,
    toMinute: 13 * 60,
  });
  await plan.addFixedEvent(p, {
    title: "Vorlesung",
    start: at("2026-11-10 10:00"),
    end: at("2026-11-10 12:00"),
  });
  const placed = await plan.placeBlock(p, {
    work,
    start: at("2026-11-11 09:00"),
    end: at("2026-11-11 10:00"),
  });
  if (placed.status !== "ok") throw new Error(placed.status);
  await plan.lockBlock(p, placed.id, true);
  const create = (start: string, end: string) =>
    plan.check(p, { kind: "create", work, start: at(start), end: at(end) });

  expect(await create("2026-11-09 07:00", "2026-11-09 09:00")).toEqual({
    status: "refused",
    reasons: ["past"],
  });
  expect(await create("2026-11-09 11:30", "2026-11-09 12:30")).toEqual({
    status: "refused",
    reasons: ["protected_time"],
  });
  expect(await create("2026-11-10 11:00", "2026-11-10 13:00")).toEqual({
    status: "refused",
    reasons: ["fixed_event"],
  });
  expect(await create("2026-11-11 09:30", "2026-11-11 10:30")).toEqual({
    status: "refused",
    reasons: ["study_block"],
  });
  expect(
    await plan.check(p, {
      kind: "move",
      blockId: placed.id,
      start: at("2026-11-12 09:00"),
      end: at("2026-11-12 10:00"),
    }),
  ).toEqual({ status: "refused", reasons: ["locked"] });
  expect(await create("2026-11-12 10:00", "2026-11-12 11:00")).toEqual({
    status: "ok",
    notes: [],
  });
});

it("notes a proposed Study Block outside the study window or over a daily limit, without refusing it", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const id = await obligation(p, "Blatt 3", "2026-11-20", "12:00");
  const work = { kind: "obligation", id } as const;
  const { courseId } = await admin.obligation.findUniqueOrThrow({
    where: { id },
  });
  await plan.placeBlock(p, {
    work,
    start: at("2026-11-12 09:00"),
    end: at("2026-11-12 13:00"),
  });
  const create = (start: string, end: string) =>
    plan.check(p, { kind: "create", work, start: at(start), end: at(end) });

  expect(await create("2026-11-11 18:00", "2026-11-11 19:00")).toEqual({
    status: "ok",
    notes: ["outside_study_window"],
  });
  expect(await create("2026-11-12 14:00", "2026-11-12 15:00")).toEqual({
    status: "ok",
    notes: ["daily_limit"],
  });
  await plan.setCourseLimit(p, courseId, 60);
  expect(await create("2026-11-13 09:00", "2026-11-13 11:00")).toEqual({
    status: "ok",
    notes: ["work_limit"],
  });
});
