import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Principal, Responsibilities } from "@nunio/delegation";
import { createResponsibilities, principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Courses } from "./courses.js";
import { createCourses } from "./courses.js";
import type { Facts } from "./facts.js";
import { createFacts } from "./facts.js";
import { createProjects } from "./projects.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
let courses: Courses;
let facts: Facts;
let responsibilities: Responsibilities;
const scheduled: string[] = [];
const now = new Date("2026-11-10T10:00:00Z");

beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
  const clock = { now: () => now };
  facts = createFacts({
    db: runtime,
    keys: createSourceKeys({
      activeVersion: "v1",
      masters: { v1: randomBytes(32) },
    }),
    clock,
  });
  responsibilities = createResponsibilities({
    db: runtime,
    clock,
    schedules: {
      create: async () => {},
      pause: async (id) => void scheduled.push(`pause ${id}`),
      unpause: async (id) => void scheduled.push(`unpause ${id}`),
      delete: async (id) => void scheduled.push(`delete ${id}`),
    },
  });
  courses = createCourses({ db: runtime, clock, facts, responsibilities });
}, 180_000);
afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
});

async function student(): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({
    data: { id, email: `${id}@example.com`, name: "Student" },
  });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  return principal.fromSession({ studentId: id });
}

/** A Course nunio proposed from a Source; arranged directly, as extraction would leave it. */
async function proposed(
  p: Principal,
  input: {
    title: string;
    code?: string | null;
    status?: "proposed" | "rejected";
  },
) {
  const id = randomUUID();
  const code = input.code ?? null;
  await admin.course.create({
    data: {
      id,
      studentId: (p as { studentId: string }).studentId,
      title: input.title,
      code,
      matchTitle: input.title.toLocaleLowerCase("de"),
      matchCode: code?.toLocaleLowerCase("de") ?? null,
      status: input.status ?? "proposed",
      semester: "2026-ws",
      color: "rose",
    },
  });
  return id;
}

async function created(
  p: Principal,
  input: { title: string; code?: string | null; semester?: string },
) {
  const result = await courses.create(p, {
    code: null,
    semester: "2026-ws",
    ...input,
  });
  if (result.status !== "ok") throw new Error(result.status);
  return result.id;
}

it("lists a created Course in its Semester as the student's own", async () => {
  const p = await student();
  const id = await created(p, {
    title: " Statistik II ",
    code: "STA2",
    semester: "2026-ss",
  });

  const listed = await courses.list(p);
  expect(listed.current).toBe("2026-ws");
  expect(listed.courses).toEqual([
    expect.objectContaining({
      id,
      title: "Statistik II",
      code: "STA2",
      semester: "2026-ss",
      status: "accepted",
      entered: true,
      archived: false,
      next: null,
    }),
  ]);
});

it("gives each new Course a color no other Course in its Semester has, while one is free", async () => {
  const p = await student();
  for (const title of ["A", "B", "C", "D", "E", "F", "G", "H"])
    await created(p, { title, semester: "2026-ws" });

  const colors = (await courses.list(p)).courses.map((c) => c.color);
  expect(new Set(colors)).toEqual(
    new Set([
      "rose",
      "orange",
      "amber",
      "emerald",
      "teal",
      "blue",
      "violet",
      "fuchsia",
    ]),
  );
});

it("refuses a new Course whose code or title another Course already has, naming that Course", async () => {
  const p = await student();
  const statistik = await proposed(p, { title: "Statistik II", code: "STA2" });
  const rejected = await proposed(p, {
    title: "Mikroökonomik",
    status: "rejected",
  });

  expect(
    await courses.create(p, {
      title: "Statistics",
      code: " sta2 ",
      semester: "2026-ws",
    }),
  ).toEqual({
    status: "clash",
    course: {
      id: statistik,
      title: "Statistik II",
      status: "proposed",
      archived: false,
    },
  });
  expect(
    await courses.create(p, {
      title: "MIKROÖKONOMIK",
      code: null,
      semester: "2026-ws",
    }),
  ).toEqual({
    status: "clash",
    course: {
      id: rejected,
      title: "Mikroökonomik",
      status: "rejected",
      archived: false,
    },
  });
  expect((await courses.list(p)).courses.map((c) => c.id)).toEqual([statistik]);
});

it("refuses a Course without a title, with an overlong one, or outside the Semesters it offers", async () => {
  const p = await student();
  for (const input of [
    { title: "  ", code: null, semester: "2026-ws" },
    { title: "x".repeat(501), code: null, semester: "2026-ws" },
    { title: "Analysis I", code: null, semester: "2019-ws" },
    { title: "Analysis I", code: null, semester: "winter" },
  ])
    expect(await courses.create(p, input)).toEqual({ status: "invalid" });
  expect((await courses.list(p)).courses).toEqual([]);
});

/** An Obligation the student entered under a Course, due on `date` (and `time`, Berlin). */
async function entered(
  p: Principal,
  courseId: string,
  kind: "exam" | "assignment",
  title: string,
  date: string | null,
  time: string | null = null,
) {
  const result = await facts.enterObligation(p, {
    course: { id: courseId },
    kind,
    title,
    due: { date, time, timeZone: null },
    destination: null,
  });
  if (result.status !== "ok") throw new Error(result.status);
  return result.id;
}

it("shows the earliest Obligation still ahead, marking one not yet reviewed", async () => {
  const p = await student();
  const id = await created(p, { title: "Analysis I" });
  const ref = (obligationId: string) => ({
    kind: "obligation" as const,
    id: obligationId,
  });
  await entered(p, id, "assignment", "Blatt 1", "2026-11-09", "12:00");
  await entered(p, id, "assignment", "Blatt 2", "2026-11-10", "09:00");
  await facts.reject(
    p,
    ref(await entered(p, id, "assignment", "Blatt 3", "2026-11-12")),
  );
  await facts.reportSubmitted(
    p,
    await entered(p, id, "assignment", "Blatt 4", "2026-11-13"),
    true,
  );
  await entered(p, id, "assignment", "Projekt", null);
  const restored = await entered(
    p,
    id,
    "assignment",
    "Blatt 5",
    "2026-11-20",
    "12:00",
  );
  await facts.reject(p, ref(restored));
  await facts.restore(p, ref(restored));
  await entered(p, id, "exam", "Klausur", "2027-02-12");

  const next = async () => (await courses.list(p)).courses[0]!.next;
  expect(await next()).toEqual({
    id: restored,
    kind: "assignment",
    title: "Blatt 5",
    due: { date: "2026-11-20", time: "12:00", timeZone: "Europe/Berlin" },
    unreviewed: true,
  });
  await facts.reject(p, ref(restored));
  expect(await next()).toEqual(
    expect.objectContaining({
      title: "Klausur",
      due: expect.objectContaining({ date: "2027-02-12", time: null }),
      unreviewed: false,
    }),
  );
});

it("edits a Course's name, Semester and color; the student's own Course is matched by its new name", async () => {
  const p = await student();
  const id = await created(p, { title: "Analysis I", code: "MA1" });

  expect(
    await courses.edit(p, id, {
      title: "Analysis 1",
      code: "MA-101",
      semester: "2027-ss",
      color: "teal",
    }),
  ).toEqual({ status: "ok" });
  expect((await courses.list(p)).courses).toEqual([
    expect.objectContaining({
      title: "Analysis 1",
      code: "MA-101",
      semester: "2027-ss",
      color: "teal",
    }),
  ]);
  expect(
    (
      await courses.create(p, {
        title: "analysis 1",
        code: null,
        semester: "2026-ws",
      })
    ).status,
  ).toBe("clash");
  expect(
    (
      await courses.create(p, {
        title: "Analysis I",
        code: "MA1",
        semester: "2026-ws",
      })
    ).status,
  ).toBe("ok");
});

it("renames a Course nunio proposed without changing what later Sources match it by", async () => {
  const p = await student();
  const id = await proposed(p, { title: "Stat. II", code: "STA2" });
  await facts.decideCourse(p, id, "accept");
  const analysis = await created(p, { title: "Analysis I", code: "MA1" });

  expect(await courses.edit(p, id, { title: "analysis i" })).toEqual(
    expect.objectContaining({
      status: "clash",
      course: expect.objectContaining({ id: analysis }),
    }),
  );
  expect(await courses.edit(p, id, { code: "ma1" })).toEqual(
    expect.objectContaining({ status: "clash" }),
  );

  expect(
    await courses.edit(p, id, { title: "Statistik II", code: null }),
  ).toEqual({ status: "ok" });
  expect((await courses.list(p)).courses.find((c) => c.id === id)).toEqual(
    expect.objectContaining({ title: "Statistik II", code: null }),
  );
  expect(
    (
      await courses.create(p, {
        title: "Stat. II",
        code: null,
        semester: "2026-ws",
      })
    ).status,
  ).toBe("clash");
  expect(
    (
      await courses.create(p, {
        title: "Anything",
        code: "STA2",
        semester: "2026-ws",
      })
    ).status,
  ).toBe("clash");
});

it("keeps a Semester no longer offered on edits that leave it alone", async () => {
  const p = await student();
  const id = await created(p, { title: "Analysis I" });
  // Created long ago: its Semester is outside the four years offered now.
  await admin.course.update({ where: { id }, data: { semester: "2019-ws" } });

  expect(
    await courses.edit(p, id, { title: "Analysis 1", semester: "2019-ws" }),
  ).toEqual({
    status: "ok",
  });
  expect(await courses.edit(p, id, { semester: "2018-ws" })).toEqual({
    status: "invalid",
  });
  expect((await courses.list(p)).courses[0]).toEqual(
    expect.objectContaining({ title: "Analysis 1", semester: "2019-ws" }),
  );
});

it("lists Courses in overview order: soonest Obligation first, then by title, Archived ones last", async () => {
  const p = await student();
  const archived = await created(p, { title: "Mikroökonomik" });
  await entered(p, archived, "exam", "Klausur", "2026-11-11");
  await courses.archive(p, archived);
  await created(p, { title: "Lineare Algebra" });
  await created(p, { title: "Datenbanken" });
  const statistik = await created(p, { title: "Statistik II" });
  await entered(p, statistik, "exam", "Klausur", "2027-02-12");
  const analysis = await created(p, { title: "Analysis I" });
  await entered(p, analysis, "assignment", "Blatt 3", "2026-11-20", "12:00");

  expect((await courses.list(p)).courses.map((c) => c.title)).toEqual([
    "Analysis I",
    "Statistik II",
    "Datenbanken",
    "Lineare Algebra",
    "Mikroökonomik",
  ]);
});

it("refuses an edit that is invalid, clashes, or targets a Course that is not the student's", async () => {
  const p = await student();
  const id = await created(p, { title: "Analysis I" });
  const other = await created(p, { title: "Lineare Algebra" });
  const stranger = await created(await student(), { title: "Analysis II" });

  expect(await courses.edit(p, id, { title: " " })).toEqual({
    status: "invalid",
  });
  expect(await courses.edit(p, id, { color: "black" })).toEqual({
    status: "invalid",
  });
  expect(await courses.edit(p, id, { semester: "2019-ws" })).toEqual({
    status: "invalid",
  });
  expect(await courses.edit(p, id, { title: "lineare algebra" })).toEqual(
    expect.objectContaining({
      status: "clash",
      course: expect.objectContaining({ id: other }),
    }),
  );
  expect(await courses.edit(p, stranger, { title: "Mine now" })).toEqual({
    status: "gone",
  });
});

/** A Study Block for an Obligation; arranged directly, as the Plan would place it. */
async function block(
  p: Principal,
  obligationId: string,
  start: string,
  locked = false,
) {
  await admin.studyBlock.create({
    data: {
      id: randomUUID(),
      studentId: (p as { studentId: string }).studentId,
      obligationId,
      start: new Date(start),
      end: new Date(new Date(start).getTime() + 3_600_000),
      placedBy: "nunio",
      lockedAt: locked ? now : null,
    },
  });
}

async function keepOrganized(p: Principal, courseId: string) {
  const result = await responsibilities.create(p, {
    preset: "keep_course_organized",
    courseId,
    budgetMicroUsd: 1_000_000,
  });
  if (result.status !== "ok") throw new Error(result.status);
  return result.id;
}

it("archives a Course: its future Study Blocks go, Locked ones too, and its Responsibility is Paused until the student resumes it", async () => {
  const p = await student();
  const id = await created(p, { title: "Statistik II" });
  const exam = await entered(p, id, "exam", "Klausur", "2027-02-12");
  await block(p, exam, "2026-11-09T09:00:00Z");
  await block(p, exam, "2026-11-12T09:00:00Z");
  await block(p, exam, "2026-11-19T09:00:00Z", true);
  const responsibility = await keepOrganized(p, id);

  expect(await courses.impact(p, id)).toEqual({
    obligations: 1,
    tasks: 0,
    studyBlocks: 3,
    futureStudyBlocks: 2,
    responsibilities: 1,
  });
  expect(await courses.archive(p, id)).toEqual({ status: "ok" });

  expect((await courses.list(p)).courses[0]).toEqual(
    expect.objectContaining({ archived: true }),
  );
  expect(await courses.impact(p, id)).toEqual(
    expect.objectContaining({ studyBlocks: 1, futureStudyBlocks: 0 }),
  );
  expect(await responsibilities.view(p, responsibility)).toEqual(
    expect.objectContaining({ state: "paused", pausedBy: "course_archived" }),
  );
  expect(scheduled).toContain(`pause ${responsibility}`);

  expect(await courses.unarchive(p, id)).toEqual({ status: "ok" });
  expect((await courses.list(p)).courses[0]).toEqual(
    expect.objectContaining({ archived: false }),
  );
  expect((await responsibilities.view(p, responsibility))?.state).toBe(
    "paused",
  );
});

it("deletes a Course with everything only in it, ending its Responsibilities; Projects stay without it", async () => {
  const p = await student();
  const id = await created(p, { title: "Statistik II" });
  const kept = await created(p, { title: "Analysis I" });
  const exam = await entered(p, id, "exam", "Klausur", "2027-02-12");
  await block(p, exam, "2026-11-12T09:00:00Z");
  const responsibility = await keepOrganized(p, id);
  const projects = createProjects({ db: runtime });
  const project = await projects.create(p, {
    name: "Prüfungsphase",
    courseIds: [id, kept],
    obligationId: exam,
  });
  if (project.status !== "ok") throw new Error(project.status);

  expect(await courses.delete(p, id)).toEqual({ status: "ok" });

  expect((await courses.list(p)).courses.map((c) => c.id)).toEqual([kept]);
  expect(await courses.impact(p, id)).toBeNull();
  expect((await responsibilities.view(p, responsibility))?.state).toBe("ended");
  expect(await projects.list(p)).toEqual([
    expect.objectContaining({
      id: project.id,
      courseIds: [kept],
      obligationId: null,
    }),
  ]);
  expect(await courses.delete(p, id)).toEqual({ status: "gone" });
});

const studentIdOf = (p: Principal) => (p as { studentId: string }).studentId;

/** A Chat over the given Courses with one message per entry, arranged directly as the Chat would leave it. */
async function chat(
  p: Principal,
  courseIds: string[],
  messages: { role: "student" | "assistant"; at: string }[],
) {
  const studentId = studentIdOf(p);
  const id = randomUUID();
  await admin.chat.create({ data: { id, studentId } });
  for (const courseId of courseIds)
    await admin.chatCourse.create({
      data: { chatId: id, courseId, studentId },
    });
  for (const message of messages)
    await admin.chatMessage.create({
      data: {
        id: randomUUID(),
        chatId: id,
        studentId,
        role: message.role,
        content: Buffer.from("Wie läuft die Klausur ab?"),
        createdAt: new Date(message.at),
      },
    });
  return id;
}

const lastActivity = async (p: Principal) =>
  Object.fromEntries(
    (await courses.list(p)).courses.map((c) => [c.title, c.lastActivityAt]),
  );

it("dates a Course's last activity by the student's latest question in a Chat over it", async () => {
  const p = await student();
  const id = await created(p, { title: "Statistik II" });
  await created(p, { title: "Analysis I" });
  await chat(
    p,
    [id],
    [
      { role: "student", at: "2026-11-09T08:00:00Z" },
      { role: "student", at: "2026-11-09T09:00:00Z" },
      { role: "assistant", at: "2026-11-09T09:01:00Z" },
    ],
  );

  expect(await lastActivity(p)).toEqual({
    "Statistik II": new Date("2026-11-09T09:00:00Z"),
    "Analysis I": null,
  });
});

/** A Topic of the Course, arranged directly as extraction would leave it. */
async function topic(p: Principal, courseId: string, name: string) {
  const id = randomUUID();
  await admin.fact.create({
    data: {
      id,
      studentId: studentIdOf(p),
      courseId,
      type: "topic",
      matchKey: name.toLocaleLowerCase("de"),
    },
  });
  return id;
}

/** The student's answer to a Practice Item on the Topics, in a practice set of its own. */
async function answered(
  p: Principal,
  topicIds: string[],
  at: string,
  gradedAt: string | null = null,
) {
  const studentId = studentIdOf(p);
  const runId = randomUUID();
  const artifactId = randomUUID();
  await admin.run.create({ data: { id: runId, studentId } });
  await admin.artifact.create({
    data: {
      id: artifactId,
      studentId,
      kind: "practice_set",
      runId,
      request: { topicIds },
      status: "ready",
    },
  });
  await admin.practiceAttempt.create({
    data: {
      id: randomUUID(),
      studentId,
      artifactId,
      itemId: "item-1",
      topicIds,
      text: "Die Varianz ist das zweite zentrale Moment.",
      verdict: gradedAt ? "correct" : null,
      gradedAt: gradedAt ? new Date(gradedAt) : null,
      createdAt: new Date(at),
    },
  });
}

it("dates a Course's last activity by the student's latest practice answer on its Topics, graded or not", async () => {
  const p = await student();
  const statistics = await created(p, { title: "Statistik II" });
  const analysis = await created(p, { title: "Analysis I" });
  const variance = await topic(p, statistics, "Varianz");
  const integrals = await topic(p, analysis, "Integrale");
  await answered(p, [variance], "2026-11-08T10:00:00Z", "2026-11-10T09:00:00Z");
  await answered(p, [variance, integrals], "2026-11-09T07:30:00Z");

  expect(await lastActivity(p)).toEqual({
    "Statistik II": new Date("2026-11-09T07:30:00Z"),
    "Analysis I": new Date("2026-11-09T07:30:00Z"),
  });
});

it("dates a Course's last activity by the student's latest self-assessment of one of its Topics", async () => {
  const p = await student();
  const id = await created(p, { title: "Statistik II" });
  const variance = await topic(p, id, "Varianz");
  for (const [level, at] of [
    ["shaky", "2026-11-07T18:00:00Z"],
    ["solid", "2026-11-09T18:00:00Z"],
  ] as const)
    await admin.selfAssessment.create({
      data: {
        id: randomUUID(),
        studentId: studentIdOf(p),
        topicId: variance,
        level,
        createdAt: new Date(at),
      },
    });

  expect(await lastActivity(p)).toEqual({
    "Statistik II": new Date("2026-11-09T18:00:00Z"),
  });
});

/** A Source the student uploaded, bound to the Course. */
async function uploaded(
  p: Principal,
  courseId: string,
  at: string,
  deletedAt: string | null = null,
) {
  const id = randomUUID();
  await admin.source.create({
    data: {
      id,
      studentId: studentIdOf(p),
      courseId,
      title: "Skript.pdf",
      bytes: 1024,
      uploadExpiresAt: new Date(at),
      createdAt: new Date(at),
      deletedAt: deletedAt ? new Date(deletedAt) : null,
    },
  });
  return id;
}

it("dates a Course's last activity by the latest Source uploaded to it, not by deleted ones or Chats that only cite it", async () => {
  const p = await student();
  const id = await created(p, { title: "Statistik II" });
  const script = await uploaded(p, id, "2026-11-06T12:00:00Z");
  await uploaded(p, id, "2026-11-08T12:00:00Z", "2026-11-09T12:00:00Z");
  const citing = await chat(
    p,
    [],
    [{ role: "student", at: "2026-11-09T15:00:00Z" }],
  );
  await admin.chatSource.create({
    data: { chatId: citing, sourceId: script, studentId: studentIdOf(p) },
  });

  expect(await lastActivity(p)).toEqual({
    "Statistik II": new Date("2026-11-06T12:00:00Z"),
  });
});
