import { randomBytes, randomUUID } from "node:crypto";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import type { EstimateRequest, Estimator } from "@nunio/ai";
import { createDelegation, principal, type Delegation, type Principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { createFacts, createKnowledgeReader, createProjects, type Facts } from "@nunio/knowledge";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPlan, type Plan } from "./plan.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
let facts: Facts;
let plan: Plan;
let delegation: Delegation;
/** A Berlin wall-clock time in November (CET, UTC+1). */
const at = (local: string) => new Date(`${local.replace(" ", "T")}:00+01:00`);
let now = at("2026-11-09 08:00");
const clock = { now: () => now };

beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
  facts = createFacts({ db: runtime, keys: createSourceKeys({ activeVersion: "v1", masters: { v1: randomBytes(32) } }), clock });
  plan = createPlan({ db: runtime, facts, clock });
  delegation = createDelegation({ db: runtime, aiEnabled: () => true });
}, 180_000);
afterAll(async () => { await runtime?.$disconnect(); await admin?.$disconnect(); await database?.stop(); });

async function student(limitMicroUsd = 5_000_000): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({ data: { id, email: `${id}@example.com`, name: "Student" } });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  await admin.allowance.create({ data: { studentId: id, limitMicroUsd } });
  return principal.fromSession({ studentId: id });
}

/** Enters an Obligation under a new accepted Course through the Facts interface, returning its id. */
async function obligation(p: Principal, title: string, date: string, time: string | null) {
  const entered = await facts.enterObligation(p, { course: { title: "Analysis I", code: "MA-101" }, kind: "assignment", title,
    due: { date, time, timeZone: null }, destination: null });
  if (entered.status !== "ok") throw new Error(entered.status);
  return entered.id;
}

it("proposes Study Blocks before an Obligation's deadline from the student's own Estimate", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");

  expect(await plan.estimate(p, { kind: "obligation", id: sheet }, 120)).toEqual({ status: "ok" });
  const view = await plan.view(p);

  expect(view.obligations).toEqual([expect.objectContaining({ id: sheet, title: "Blatt 3", due: at("2026-11-11 12:00"),
    estimate: { minutes: 120, estimatedBy: "student", rationale: null } })]);
  expect(view.proposal.moves).toEqual([
    { kind: "create", workId: sheet, start: at("2026-11-09 09:00"), end: at("2026-11-09 11:00"), needsApproval: false },
  ]);
});

it("applies a move only while it matches a fresh proposal", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 120);
  const [move] = (await plan.view(p)).proposal.moves;
  const forged = { kind: "create" as const, workId: sheet, start: at("2026-11-10 09:00"), end: at("2026-11-10 17:00"), needsApproval: false };

  expect(await plan.apply(p, forged)).toEqual({ status: "stale" });
  expect(await plan.apply(p, move!)).toEqual({ status: "ok" });
  expect(await plan.apply(p, move!)).toEqual({ status: "stale" });

  const view = await plan.view(p);
  expect(view.studyBlocks).toEqual([{ id: expect.any(String), work: { kind: "obligation", id: sheet },
    start: at("2026-11-09 09:00"), end: at("2026-11-09 11:00"), placedBy: "nunio", locked: false }]);
  expect(view.proposal.moves).toEqual([]);
});

it("plans an Obligation through its open Tasks, which the student adds, estimates and completes", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  const first = await plan.addTask(p, { title: "Aufgaben 1–4", obligationId: sheet });
  const second = await plan.addTask(p, { title: "Aufgaben 5–8", obligationId: sheet });
  if (first.status !== "ok" || second.status !== "ok") throw new Error("refused");
  await plan.estimate(p, { kind: "task", id: first.id }, 60);
  await plan.estimate(p, { kind: "task", id: second.id }, 90);

  expect(await plan.completeTask(p, first.id, true)).toEqual({ status: "ok" });
  const view = await plan.view(p);

  expect(view.tasks).toEqual([
    { id: first.id, title: "Aufgaben 1–4", obligationId: sheet, estimate: { minutes: 60, estimatedBy: "student", rationale: null },
      maxMinutesPerDay: null, done: true },
    { id: second.id, title: "Aufgaben 5–8", obligationId: sheet, estimate: { minutes: 90, estimatedBy: "student", rationale: null },
      maxMinutesPerDay: null, done: false },
  ]);
  expect(view.proposal.moves).toEqual([
    { kind: "create", workId: second.id, start: at("2026-11-09 09:00"), end: at("2026-11-09 10:30"), needsApproval: false },
  ]);
  expect(await plan.addTask(await student(), { title: "Fremd", obligationId: sheet })).toEqual({ status: "gone" });
});

it("lets the student place, move, Lock and delete Study Blocks, which a Rebalance then treats as theirs", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 60);
  const work = { kind: "obligation" as const, id: sheet };

  const placed = await plan.placeBlock(p, { work, start: at("2026-11-10 14:00"), end: at("2026-11-10 15:00") });
  if (placed.status !== "ok") throw new Error(placed.status);
  expect((await plan.view(p)).proposal.moves).toEqual([]);
  expect(await plan.placeBlock(p, { work, start: at("2026-11-10 15:00"), end: at("2026-11-10 14:00") })).toEqual({ status: "invalid" });

  expect(await plan.moveBlock(p, placed.id, { start: at("2026-11-10 16:00"), end: at("2026-11-10 17:00") })).toEqual({ status: "ok" });
  expect(await plan.lockBlock(p, placed.id, true)).toEqual({ status: "ok" });
  expect((await plan.view(p)).studyBlocks).toEqual([{ id: placed.id, work, start: at("2026-11-10 16:00"), end: at("2026-11-10 17:00"),
    placedBy: "student", locked: true }]);

  expect(await plan.removeBlock(p, placed.id)).toEqual({ status: "ok" });
  expect((await plan.view(p)).proposal.moves).toEqual([expect.objectContaining({ kind: "create", workId: sheet })]);
  expect(await plan.moveBlock(await student(), placed.id, { start: at("2026-11-10 16:00"), end: at("2026-11-10 17:00") }))
    .toEqual({ status: "gone" });
});

it("plans within the student's Preferences and weekly Protected Time, breaking ties by Course Priority", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const analysis = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  const physics = await facts.enterObligation(p, { course: { title: "Physik", code: "PH-1" }, kind: "assignment", title: "Laborbericht",
    due: { date: "2026-11-11", time: "12:00", timeZone: null }, destination: null });
  if (physics.status !== "ok") throw new Error(physics.status);
  await plan.estimate(p, { kind: "obligation", id: analysis }, 60);
  await plan.estimate(p, { kind: "obligation", id: physics.id }, 60);
  const physicsCourse = (await facts.review(p)).courses.find(c => c.code === "PH-1")!.id;

  expect(await plan.setPreferences(p, { studyFromMinute: 10 * 60, studyToMinute: 16 * 60, maxMinutesPerDay: 120 })).toEqual({ status: "ok" });
  expect(await plan.addProtectedTime(p, { weekday: 1, fromMinute: 10 * 60, toMinute: 12 * 60 })).toMatchObject({ status: "ok" });
  expect(await plan.setPriorities(p, [{ kind: "course", id: physicsCourse }])).toEqual({ status: "ok" });
  const view = await plan.view(p);

  expect(view.proposal.moves.map(m => m.kind === "create" && [m.workId, m.start, m.end])).toEqual([
    [physics.id, at("2026-11-09 12:00"), at("2026-11-09 13:00")],
    [analysis, at("2026-11-09 13:00"), at("2026-11-09 14:00")],
  ]);
  expect(view.limits).toEqual({ preferences: { timeZone: "Europe/Berlin", studyFromMinute: 600, studyToMinute: 960, maxMinutesPerDay: 120 },
    courses: [], protectedTime: [{ id: expect.any(String), weekday: 1, fromMinute: 600, toMinute: 720 }] });
  expect(await plan.setPreferences(p, { studyFromMinute: 900, studyToMinute: 600, maxMinutesPerDay: 120 })).toEqual({ status: "invalid" });
});

it("expands weekly Protected Time onto every local day, even across the switch to summer time", async () => {
  // Late Friday evening before Sunday 28 March 2027, when Berlin switches to CEST.
  now = new Date("2027-03-26T23:30:00+01:00");
  const p = await student();
  const lab = await obligation(p, "Laborbericht", "2027-03-29", "18:00");
  await plan.estimate(p, { kind: "obligation", id: lab }, 60);
  // Saturday and Sunday are protected all day; nothing may be planned before Monday.
  // Saturday's span stops before midnight, so Sunday is protected only by its own rule.
  await plan.addProtectedTime(p, { weekday: 6, fromMinute: 0, toMinute: 23 * 60 });
  await plan.addProtectedTime(p, { weekday: 7, fromMinute: 0, toMinute: 1440 });

  expect((await plan.view(p)).proposal.moves).toEqual([
    { kind: "create", workId: lab, start: new Date("2027-03-29T09:00:00+02:00"), end: new Date("2027-03-29T10:00:00+02:00"), needsApproval: false },
  ]);
});

it("proposes Estimates only for Obligations and Tasks without one, never replacing the student's own", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  const exam = await obligation(p, "Klausur", "2027-02-12", null);
  await plan.estimate(p, { kind: "obligation", id: exam }, 1200);
  const task = await plan.addTask(p, { title: "Altklausuren rechnen", obligationId: exam });
  if (task.status !== "ok") throw new Error(task.status);
  const asked: EstimateRequest[][] = [];
  const estimator: Estimator = { estimateMicroUsd: () => 10,
    async estimate(items) { asked.push([...items]); return { value: items.map(() => ({ minutes: 180, rationale: "Four proofs." })), usage: { microUsd: 5 } }; } };

  expect(await plan.proposeEstimates(p, { estimator, delegation })).toEqual({ status: "ok", proposed: 2 });
  expect(asked).toEqual([[{ kind: "assignment", title: "Blatt 3", course: "Analysis I" },
    { kind: "task", title: "Altklausuren rechnen", course: "Analysis I" }]]);
  const { obligations, tasks } = await plan.view(p);
  expect(obligations.map(o => [o.id, o.estimate])).toEqual(expect.arrayContaining([
    [sheet, { minutes: 180, estimatedBy: "nunio", rationale: "Four proofs." }],
    [exam, { minutes: 1200, estimatedBy: "student", rationale: null }],
  ]));
  expect(tasks).toEqual([expect.objectContaining({ id: task.id, estimate: { minutes: 180, estimatedBy: "nunio", rationale: "Four proofs." } })]);
  expect(await plan.proposeEstimates(p, { estimator, delegation })).toEqual({ status: "ok", proposed: 0 });
  expect(asked).toHaveLength(1);
});

it("refuses to propose Estimates once the Allowance is exhausted, without asking the model", async () => {
  const p = await student(0);
  await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  let calls = 0;
  const estimator: Estimator = { estimateMicroUsd: () => 10, async estimate(items) { calls++; return { value: items.map(() => null), usage: { microUsd: 1 } }; } };

  expect(await plan.proposeEstimates(p, { estimator, delegation })).toEqual({ status: "refused", reason: "allowance_exhausted" });
  expect(calls).toBe(0);
});

it("plans around Fixed Events entered by hand or imported from a calendar file, and forgets a deleted import", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 60);
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", "BEGIN:VEVENT", "UID:lecture@test", "DTSTAMP:20261101T000000Z",
    "SUMMARY:Analysis I", "DTSTART:20261109T080000Z", "DTEND:20261109T100000Z", "RRULE:FREQ=WEEKLY;COUNT=10", "END:VEVENT", "END:VCALENDAR"].join("\r\n");

  const entered = await plan.addFixedEvent(p, { title: "Schicht", start: at("2026-11-09 11:00"), end: at("2026-11-09 12:00") });
  const imported = await plan.addCalendar(p, { name: "Stundenplan.ics", ics });
  if (entered.status !== "ok" || imported.status !== "ok") throw new Error("refused");
  expect(imported).toMatchObject({ events: 10, skipped: { allDay: 0, outsideWindow: 0, truncated: false } });

  const view = await plan.view(p);
  expect(view.fixedEvents.slice(0, 2)).toEqual([
    { id: expect.any(String), title: "Analysis I", start: at("2026-11-09 09:00"), end: at("2026-11-09 11:00"), calendarId: imported.id },
    { id: entered.id, title: "Schicht", start: at("2026-11-09 11:00"), end: at("2026-11-09 12:00"), calendarId: null },
  ]);
  expect(view.calendars).toEqual([{ id: imported.id, name: "Stundenplan.ics", events: 10 }]);
  expect(view.proposal.moves).toEqual([expect.objectContaining({ start: at("2026-11-09 12:00"), end: at("2026-11-09 13:00") })]);

  expect(await plan.removeCalendar(p, imported.id)).toEqual({ status: "ok" });
  expect((await plan.view(p)).fixedEvents).toEqual([expect.objectContaining({ id: entered.id })]);
  expect(await plan.addCalendar(p, { name: "kaputt.ics", ics: "not a calendar" })).toEqual({ status: "invalid" });
});

it("ranks Courses, Projects and Obligations in one list, an Obligation's own rank winning over its Project's and Course's", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  const lab = await obligation(p, "Laborbericht", "2026-11-11", "12:00");
  const talk = await obligation(p, "Referat", "2026-11-11", "12:00");
  for (const id of [sheet, lab, talk]) await plan.estimate(p, { kind: "obligation", id }, 60);
  const project = await createProjects({ db: runtime }).create(p, { name: "Labor", courseIds: [], obligationId: lab });
  if (project.status !== "ok") throw new Error(project.status);
  const sheetCourse = (await plan.view(p)).obligations.find(o => o.id === sheet)!.courseId;

  // Talk outranks the lab's Project, which outranks the sheet's Course.
  expect(await plan.setPriorities(p, [{ kind: "obligation", id: talk }, { kind: "project", id: project.id }, { kind: "course", id: sheetCourse }]))
    .toEqual({ status: "ok" });
  const view = await plan.view(p);

  expect(view.proposal.moves.map(m => m.kind === "create" && m.workId)).toEqual([talk, lab, sheet]);
  expect(view.priorities).toEqual([{ kind: "obligation", id: talk }, { kind: "project", id: project.id }, { kind: "course", id: sheetCourse }]);
  expect(await plan.setPriorities(await student(), [{ kind: "obligation", id: talk }])).toEqual({ status: "gone" });
});

it("applies a Task's own daily limit over its Course's, and the Course's over the global one", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-13", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 180);
  const courseId = (await plan.view(p)).obligations[0]!.courseId;

  expect(await plan.setCourseLimit(p, courseId, 60)).toEqual({ status: "ok" });
  expect((await plan.view(p)).proposal.moves.map(m => m.kind === "create" && [m.start, m.end])).toEqual([
    [at("2026-11-09 09:00"), at("2026-11-09 10:00")], [at("2026-11-10 09:00"), at("2026-11-10 10:00")],
    [at("2026-11-11 09:00"), at("2026-11-11 10:00")],
  ]);
  const task = await plan.addTask(p, { title: "Beweise", obligationId: sheet });
  if (task.status !== "ok") throw new Error(task.status);
  await plan.estimate(p, { kind: "task", id: task.id }, 180);
  expect(await plan.setTaskLimit(p, task.id, 90)).toEqual({ status: "ok" });
  expect((await plan.view(p)).proposal.moves.map(m => m.kind === "create" && [m.start, m.end])).toEqual([
    [at("2026-11-09 09:00"), at("2026-11-09 10:30")], [at("2026-11-10 09:00"), at("2026-11-10 10:30")],
  ]);
  expect(await plan.setCourseLimit(p, courseId, 10)).toEqual({ status: "invalid" });
});

it("never plans into a one-off span of Protected Time, such as a trip", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-13", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 60);

  const trip = await plan.addProtectedTime(p, { start: at("2026-11-09 00:00"), end: at("2026-11-11 00:00") });
  expect(trip).toMatchObject({ status: "ok" });
  const view = await plan.view(p);

  expect(view.proposal.moves).toEqual([expect.objectContaining({ start: at("2026-11-11 09:00"), end: at("2026-11-11 10:00") })]);
  expect(view.limits.protectedTime).toEqual([{ id: expect.any(String), start: at("2026-11-09 00:00"), end: at("2026-11-11 00:00") }]);
  expect(await plan.addProtectedTime(p, { start: at("2026-11-11 00:00"), end: at("2026-11-09 00:00") })).toEqual({ status: "invalid" });
});

it("serves Fixed Events to the planning scope as operational Facts, apart from course material", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const shift = await plan.addFixedEvent(p, { title: "Schicht", start: at("2026-11-10 17:00"), end: at("2026-11-10 21:00") });
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", "BEGIN:VEVENT", "UID:l@test", "DTSTAMP:20261101T000000Z",
    "SUMMARY:Analysis I", "DTSTART:20261111T080000Z", "DTEND:20261111T100000Z", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const calendar = await plan.addCalendar(p, { name: "Stundenplan.ics", ics });
  if (shift.status !== "ok" || calendar.status !== "ok") throw new Error("refused");
  const reader = createKnowledgeReader({ db: runtime, keys: createSourceKeys({ activeVersion: "v1", masters: { v1: randomBytes(32) } }), delegation, clock,
    embedder: { model: "unused", dims: 1, relevanceFloor: 1, estimateMicroUsd: () => 1, embed: async () => { throw new Error("Fact queries never embed"); } } });

  const result = await reader.retrieve(p, { planning: true }, { kind: "facts", types: ["fixed_event"] });

  if (result.status !== "ok") throw new Error(result.status);
  expect(result.items.map(i => [i.channel, i.label, i.provenance])).toEqual([
    ["operational", "Fixed Event (entered by the student)", { kind: "entry" }],
    ["operational", "Fixed Event from Stundenplan.ics", { kind: "calendar", calendarId: calendar.id, name: "Stundenplan.ics" }],
  ]);
  expect(result.render().data).toMatch(/^<<<BEGIN operational [0-9a-f]{16}>>>\n\[S1\] Fixed Event \(entered by the student\)\nSchicht, /);
  const ref = result.items[1]!.cite;
  await plan.removeCalendar(p, calendar.id);
  expect((await reader.cite(p, [ref])).get(ref)).toBe("gone");
});
