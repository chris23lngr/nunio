import { randomBytes, randomUUID } from "node:crypto";
import type { Extracted, Extractor, Page } from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Delegation, Principal } from "@nunio/delegation";
import { createDelegation, principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Courses } from "./courses.js";
import { createCourses } from "./courses.js";
import type { Facts } from "./facts.js";
import { createFacts } from "./facts.js";
import type { SourceStorage, Sources } from "./sources.js";
import { createSources } from "./sources.js";

// Course assignment: the student binds a Source to a Course at upload or by "Kurs ändern", and Review suggests merging
// Courses that look alike.
let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
let sources: Sources;
let facts: Facts;
let courses: Courses;
let delegation: Delegation;
const now = new Date("2026-11-11T12:00:00Z");
const storage: SourceStorage = {
  async upload(id) {
    return {
      url: `https://storage.invalid/${id}`,
      headers: {},
      expiresAt: new Date(Date.now() + 300_000),
    };
  },
  async download(id, key) {
    return {
      url: `https://storage.invalid/${id}`,
      keyBase64: key.toString("base64"),
      etag: "etag",
    };
  },
  async promote() {},
  async remove() {},
};
beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
  const keys = createSourceKeys({
    activeVersion: "v1",
    masters: { v1: randomBytes(32) },
  });
  const clock = { now: () => now };
  sources = createSources({ db: runtime, keys, storage, clock });
  facts = createFacts({ db: runtime, keys, clock });
  courses = createCourses({
    db: runtime,
    clock,
    facts,
    responsibilities: {
      pauseForCourse: async () => {},
      endForCourse: async () => {},
    },
  });
  delegation = createDelegation({ db: runtime, aiEnabled: () => true });
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
  await admin.allowance.create({
    data: { studentId: id, limitMicroUsd: 5_000_000 },
  });
  return principal.fromSession({ studentId: id });
}

type CourseChoice = Parameters<Sources["upload"]>[1]["course"];

/** Uploads a PDF with the student's Course choice and ingests it, as the worker would. */
async function upload(
  p: Principal,
  title: string,
  pages: Page[],
  course?: CourseChoice,
) {
  const result = await sources.upload(p, {
    title,
    bytes: 100,
    type: "application/pdf",
    course,
  });
  if (result.status !== "ok") throw new Error(`upload ${result.status}`);
  await sources.complete(p, result.source.id);
  const ingested = await sources.ingest(p, result.source.id, {
    parse: async () => ({ pages }),
    delegation,
    embedder: {
      model: "test-embedding",
      dims: 3,
      relevanceFloor: 0.3,
      estimateMicroUsd: () => 1,
      embed: async (texts) => ({
        vectors: texts.map(() => [1, 0, 0]),
        usage: { microUsd: 1 },
      }),
    },
    scans: {
      estimateMicroUsd: () => 1,
      read: async () => ({ text: "", usage: { microUsd: 1 } }),
    },
  });
  if (ingested.status !== "ready") throw new Error(`ingest ${ingested.status}`);
  return result.source;
}

function scripted(...results: Extracted[]): Extractor {
  return {
    model: "test-extractor",
    windows: (pages) => pages.map((page) => [page]),
    estimateMicroUsd: () => 10,
    async extract() {
      const value = results.shift();
      if (!value) throw new Error("no scripted result left");
      return { value, usage: { microUsd: 5 } };
    },
  };
}
const extract = (p: Principal, sourceId: string, ...results: Extracted[]) =>
  facts.extract(p, sourceId, { delegation, extractor: scripted(...results) });

const slides = "Kapitel 2: Stetigkeit\nAbgabe Blatt 3: 20.11., 12 Uhr";
const sheet3 = {
  course: "Analysis",
  kind: "assignment" as const,
  title: "Übungsblatt 3",
  key: "Übungsblatt 3",
  due: {
    date: "2026-11-20",
    time: "12:00",
    timeZone: "Europe/Berlin",
    text: "20.11., 12 Uhr",
  },
  destination: null,
  page: 1,
  quote: "Abgabe Blatt 3: 20.11., 12 Uhr",
  uncertainty: null,
};
const topic = {
  course: "Analysis",
  type: "topic" as const,
  key: "Stetigkeit",
  value: "Stetigkeit",
  page: 1,
  quote: "Kapitel 2: Stetigkeit",
  uncertainty: null,
};
/** What the model reads from slides that name their Course loosely, if at all. */
const fromSlides: Extracted = {
  courses: [
    { code: null, title: "Analysis", page: 1, quote: "Kapitel 2: Stetigkeit" },
  ],
  obligations: [sheet3],
  facts: [topic],
};

async function ownCourse(p: Principal, title: string, code: string | null) {
  const created = await courses.create(p, { title, code, semester: "2026-ws" });
  if (created.status !== "ok") throw new Error(created.status);
  return created.id;
}
const reviewed = async (p: Principal) => (await facts.review(p)).courses;

it("puts everything a bound Source holds under its Course, proposing none and dropping nothing for an unknown name", async () => {
  const p = await student();
  const analysis = await ownCourse(p, "Analysis I", "MA-101");
  const source = await upload(p, "Folien 2.pdf", [{ page: 1, text: slides }], {
    id: analysis,
  });

  const result = await extract(p, source.id, fromSlides);

  expect(result).toMatchObject({ status: "done", dropped: 0 });
  expect(await reviewed(p)).toEqual([
    expect.objectContaining({
      id: analysis,
      status: "accepted",
      obligations: [expect.objectContaining({ title: "Übungsblatt 3" })],
      facts: [expect.objectContaining({ value: "Stetigkeit" })],
    }),
  ]);
});

it("creates a new Course named at upload once, accepted in the current Semester, and binds every file of the upload to it", async () => {
  const p = await student();
  const first = await upload(p, "Folien 1.pdf", [{ page: 1, text: slides }], {
    title: " Analysis I ",
    code: "MA-101",
  });
  const second = await upload(p, "Folien 2.pdf", [{ page: 1, text: slides }], {
    id: first.courseId!,
  });

  await extract(p, first.id, fromSlides);
  await extract(p, second.id, fromSlides);

  expect(second.courseId).toBe(first.courseId);
  expect((await courses.list(p)).courses).toEqual([
    expect.objectContaining({
      id: first.courseId,
      title: "Analysis I",
      code: "MA-101",
      status: "accepted",
      semester: "2026-ws",
      entered: true,
    }),
  ]);
  expect(await reviewed(p)).toEqual([
    expect.objectContaining({
      obligations: [
        expect.objectContaining({
          values: [
            expect.objectContaining({
              citations: [
                expect.objectContaining({ sourceId: first.id }),
                expect.objectContaining({ sourceId: second.id }),
              ],
            }),
          ],
        }),
      ],
    }),
  ]);
});

it("refuses an upload bound to a Course that is not accepted, Archived, another student's, or new without a title", async () => {
  const p = await student();
  const proposed = await upload(p, "Syllabus.pdf", [{ page: 1, text: slides }]);
  await extract(p, proposed.id, fromSlides);
  const [analysis] = await reviewed(p);
  const archived = await ownCourse(p, "Statistik II", null);
  await courses.archive(p, archived);
  const foreign = await ownCourse(await student(), "Lineare Algebra", null);
  const attempt = (course: CourseChoice) =>
    sources.upload(p, {
      title: "Folien.pdf",
      bytes: 100,
      type: "application/pdf",
      course,
    });

  expect(await attempt({ id: analysis!.id })).toEqual({ status: "gone" });
  expect(await attempt({ id: foreign })).toEqual({ status: "gone" });
  expect(await attempt({ id: archived })).toEqual({
    status: "course_archived",
  });
  expect(await attempt({ title: "  ", code: null })).toEqual({
    status: "invalid",
  });
  expect((await sources.list(p)).map((source) => source.title)).toEqual([
    "Syllabus.pdf",
  ]);
});

it("moves a bound Source with its Course when merged, and keeps it, unbound, when its Course is deleted", async () => {
  const p = await student();
  const from = await ownCourse(p, "Analysis 1", null);
  const into = await ownCourse(p, "Analysis I", "MA-101");
  const source = await upload(p, "Folien.pdf", [{ page: 1, text: slides }], {
    id: from,
  });
  const boundTo = async () =>
    (await sources.list(p)).find((s) => s.id === source.id)?.courseId;

  await facts.mergeCourses(p, from, into);
  expect(await boundTo()).toBe(into);

  await courses.delete(p, into);
  expect(await boundTo()).toBeNull();
  await extract(p, source.id, fromSlides);
  expect((await reviewed(p)).map((course) => course.title)).toEqual([
    "Analysis",
  ]);
});

it("changes a read Source's Course and reads it again, moving what it holds there only once the reading is done", async () => {
  const p = await student();
  const source = await upload(p, "Folien.pdf", [{ page: 1, text: slides }]);
  await extract(p, source.id, fromSlides);
  const analysis = await ownCourse(p, "Analysis I", "MA-101");

  expect(await facts.changeCourse(p, source.id, { id: analysis })).toEqual({
    status: "ok",
  });
  expect((await reviewed(p)).map((course) => course.title)).toEqual([
    "Analysis",
    "Analysis I",
  ]);
  await extract(p, source.id, fromSlides);

  expect(await reviewed(p)).toEqual([
    expect.objectContaining({
      id: analysis,
      obligations: [expect.objectContaining({ title: "Übungsblatt 3" })],
      facts: [expect.objectContaining({ value: "Stetigkeit" })],
    }),
  ]);

  expect(await facts.changeCourse(p, source.id, null)).toEqual({
    status: "ok",
  });
  await extract(p, source.id, fromSlides);
  expect((await reviewed(p)).map((course) => course.title)).toEqual([
    "Analysis",
    "Analysis I",
  ]);
});

it("changes a Source's Course to a new one, and refuses while it is read, for a Source that is gone, or an unusable Course", async () => {
  const p = await student();
  const source = await upload(p, "Folien.pdf", [{ page: 1, text: slides }]);
  const archived = await ownCourse(p, "Statistik II", null);
  await courses.archive(p, archived);

  expect(await facts.changeCourse(p, source.id, { id: archived })).toEqual({
    status: "course_archived",
  });
  expect(
    await facts.changeCourse(p, source.id, { title: "", code: null }),
  ).toEqual({ status: "invalid" });
  expect(
    await facts.changeCourse(await student(), source.id, {
      title: "Analysis I",
      code: null,
    }),
  ).toEqual({ status: "gone" });
  await admin.source.update({
    where: { id: source.id },
    data: { extraction: "running" },
  });
  expect(
    await facts.changeCourse(p, source.id, { title: "Analysis I", code: null }),
  ).toEqual({ status: "running" });
  expect((await courses.list(p)).courses.map((c) => c.title)).toEqual([
    "Statistik II",
  ]);
  await admin.source.update({
    where: { id: source.id },
    data: { extraction: "done" },
  });

  expect(
    await facts.changeCourse(p, source.id, { title: "Analysis I", code: null }),
  ).toEqual({ status: "ok" });
  await extract(p, source.id, fromSlides);
  expect((await reviewed(p)).map((course) => course.title)).toEqual([
    "Analysis I",
    "Statistik II",
  ]);
  await sources.remove(p, source.id);
  expect(await facts.changeCourse(p, source.id, null)).toEqual({
    status: "gone",
  });
});

/** An unbound Source whose reading proposes a Course with this name. */
async function proposal(p: Principal, title: string, code: string | null) {
  const source = await upload(p, `${title}.pdf`, [{ page: 1, text: slides }]);
  await extract(p, source.id, {
    ...fromSlides,
    courses: [{ code, title, page: 1, quote: "Kapitel 2: Stetigkeit" }],
    obligations: [{ ...sheet3, course: title }],
  });
  return (await reviewed(p)).find((course) => course.title === title)!.id;
}

it("suggests merging a proposal into an alike Course of the same Semester, never a rejected, merged or other Semester's one", async () => {
  const p = await student();
  const analysis = await ownCourse(p, "Analysis I", null);
  const sameCode = await proposal(p, "Mathe für Informatik", "MA 101");
  const similar = await proposal(p, "Analysis 1", null);
  await courses.edit(p, analysis, { code: "ma-101" });
  const rejected = await proposal(p, "Analysis", null);
  await facts.decideCourse(p, rejected, "reject");
  const earlier = await courses.create(p, {
    title: "Analysis I.",
    code: null,
    semester: "2026-ss",
  });
  await proposal(p, "Lineare Algebra", null);

  expect(earlier.status).toBe("ok");
  const suggested = await courses.similar(p);
  expect(suggested).toHaveLength(2);
  expect(suggested).toEqual(
    expect.arrayContaining([
      { courseId: sameCode, intoId: analysis },
      { courseId: similar, intoId: analysis },
    ]),
  );

  await facts.mergeCourses(p, similar, analysis);
  expect(await courses.similar(p)).toEqual([
    { courseId: sameCode, intoId: analysis },
  ]);
});

it("never suggests a pair again once the student says they differ", async () => {
  const p = await student();
  const analysis = await ownCourse(p, "Analysis I", null);
  const similar = await proposal(p, "Analysis 1", null);

  expect(await courses.keepApart(p, similar, analysis)).toEqual({
    status: "ok",
  });
  expect(await courses.keepApart(p, analysis, similar)).toEqual({
    status: "ok",
  });
  expect(await courses.similar(p)).toEqual([]);
  expect(await courses.keepApart(await student(), similar, analysis)).toEqual({
    status: "gone",
  });
});
