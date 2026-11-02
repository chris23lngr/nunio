import { randomBytes, randomUUID } from "node:crypto";
import { SourceModelRejected, type Extracted, type Extractor, type Page } from "@nunio/ai";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { createDelegation, principal, type Delegation, type Principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createFacts, type Facts } from "./facts.js";
import { createSources, type Sources, type SourceStorage } from "./sources.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
let sources: Sources;
let facts: Facts;
let delegation: Delegation;
const now = new Date("2026-11-02T12:00:00Z");
const storage: SourceStorage = {
  async upload(id) { return { url: `https://storage.invalid/${id}`, headers: {}, expiresAt: new Date(Date.now() + 300_000) }; },
  async download(id, key) { return { url: `https://storage.invalid/${id}`, keyBase64: key.toString("base64"), etag: "etag" }; },
  async promote() {},
  async remove() {},
};
beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
  const keys = createSourceKeys({ activeVersion: "v1", masters: { v1: randomBytes(32) } });
  sources = createSources({ db: runtime, keys, storage });
  facts = createFacts({ db: runtime, keys, clock: { now: () => now } });
  delegation = createDelegation({ db: runtime, aiEnabled: () => true });
}, 180_000);
afterAll(async () => { await runtime?.$disconnect(); await admin?.$disconnect(); await database?.stop(); });

async function student(): Promise<Principal & { kind: "student" }> {
  const id = randomUUID();
  await admin.user.create({ data: { id, email: `${id}@example.com`, name: "Student" } });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  await admin.allowance.create({ data: { studentId: id, limitMicroUsd: 5_000_000 } });
  return principal.fromSession({ studentId: id }) as Principal & { kind: "student" };
}

/** Seeds a ready Source through the Sources interface. */
async function readySource(p: Principal, title: string, pages: Page[]) {
  const upload = await sources.upload(p, { title, bytes: 100, type: "application/pdf" });
  if (upload.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, upload.source.id);
  const result = await sources.ingest(p, upload.source.id, {
    parse: async () => ({ pages }), delegation,
    embedder: { model: "test-embedding", dims: 3, estimateMicroUsd: () => 1,
      embed: async texts => ({ vectors: texts.map(() => [1, 0, 0]), usage: { microUsd: 1 } }) },
    scans: { estimateMicroUsd: () => 1, read: async () => ({ text: "", usage: { microUsd: 1 } }) },
  });
  if (result.status !== "ready") throw new Error(`ingestion ${result.status}`);
  return upload.source.id;
}

/** A scripted Extractor: one window per page, each returning the next scripted result. */
function scripted(...results: Extracted[]): Extractor {
  return {
    model: "test-extractor",
    windows: pages => pages.map(page => [page]),
    estimateMicroUsd: () => 10,
    async extract() {
      const value = results.shift();
      if (!value) throw new Error("no scripted result left");
      return { value, usage: { microUsd: 5 } };
    },
  };
}
const empty: Extracted = { courses: [], obligations: [], facts: [] };
const analysis = { code: "MA-101", title: "Analysis I", page: 1, quote: "MA-101 Analysis I" };
const sheet3 = {
  course: "MA-101", kind: "assignment" as const, title: "Übungsblatt 3", key: "Übungsblatt 3",
  due: { date: "2026-11-20", time: "12:00", timeZone: null, text: "Abgabe Blatt 3: 20.11., 12 Uhr" },
  destination: "Moodle", page: 1, quote: "Abgabe Blatt 3: 20.11., 12 Uhr", uncertainty: null,
};

it("stores grounded Obligations under a proposed Course and shows them for review with their passage", async () => {
  const p = await student();
  const sourceId = await readySource(p, "Analysis.pdf", [{ page: 1, text: "MA-101 Analysis I\nAbgabe Blatt 3: 20.11., 12 Uhr über Moodle." }]);

  const result = await facts.extract(p, sourceId, { extractor: scripted({ ...empty, courses: [analysis], obligations: [sheet3] }), delegation });

  expect(result).toEqual({ status: "done", dropped: 0 });
  expect(await facts.review(p)).toEqual({
    courses: [{
      id: expect.any(String), code: "MA-101", title: "Analysis I", status: "proposed",
      obligations: [{
        id: expect.any(String), kind: "assignment", title: "Übungsblatt 3", state: "unreviewed",
        due: { date: "2026-11-20", time: "12:00", timeZone: "Europe/Berlin", text: "Abgabe Blatt 3: 20.11., 12 Uhr" },
        destination: "Moodle", uncertainty: "Time zone assumed",
        provenance: { kind: "source", sourceId, title: "Analysis.pdf", page: 1, quote: "Abgabe Blatt 3: 20.11., 12 Uhr" },
      }],
      facts: [],
    }],
  });
});

it("drops and counts items whose quote is not on their page or whose Course is unknown, tolerating line-break hyphenation", async () => {
  const p = await student();
  const sourceId = await readySource(p, "Analysis.pdf", [
    { page: 1, text: "MA-101 Analysis I\nAbgabe Blatt 3: 20.11., 12 Uhr" },
    { page: 2, text: "Die Klausur findet am 10.02.2027 statt. Prüfungs-\nanmeldung bis 15.01.2027." },
  ]);
  const invented = { ...sheet3, title: "Übungsblatt 9", key: "Übungsblatt 9", quote: "Abgabe Blatt 9: 27.11." };
  const wrongPage = { ...sheet3, title: "Übungsblatt 4", key: "Übungsblatt 4", page: 2 };
  const orphan = { ...sheet3, course: "Lineare Algebra", key: "Übungsblatt 1" };
  const registration = { ...sheet3, kind: "registration" as const, title: "Prüfungsanmeldung", key: "Prüfungsanmeldung",
    due: { date: "2027-01-15", time: null, timeZone: null, text: "bis 15.01.2027" }, destination: null,
    page: 2, quote: "Prüfungsanmeldung bis 15.01.2027" };

  const result = await facts.extract(p, sourceId, { delegation, extractor: scripted(
    { ...empty, courses: [analysis], obligations: [sheet3, invented, orphan] },
    { ...empty, courses: [{ ...analysis, page: 2 }], obligations: [wrongPage, registration] },
  ) });

  expect(result).toEqual({ status: "done", dropped: 4 });
  const [course] = (await facts.review(p)).courses;
  expect(course?.obligations.map(o => o.title)).toEqual(["Übungsblatt 3", "Prüfungsanmeldung"]);
});

it("matches Courses across windows and Sources by code, then title, and never merges an unclear match", async () => {
  const p = await student();
  const first = await readySource(p, "Analysis.pdf", [{ page: 1, text: "MA-101 Analysis I\nAbgabe Blatt 3: 20.11., 12 Uhr" }]);
  await facts.extract(p, first, { delegation, extractor: scripted({ ...empty, courses: [analysis], obligations: [sheet3] }) });

  const second = await readySource(p, "Übersicht.pdf", [
    { page: 1, text: "MA-101 Analysis 1 (Vorlesung)" },
    { page: 2, text: "MA-101 Analysis 1, Übung. Lineare Algebra. MA-102 Analysis I für Lehramt." },
  ]);
  const result = await facts.extract(p, second, { delegation, extractor: scripted(
    { ...empty, courses: [{ code: "MA-101", title: "Analysis 1", page: 1, quote: "MA-101 Analysis 1" }] },
    { ...empty, courses: [
      { code: "MA-101", title: "Analysis 1", page: 2, quote: "MA-101 Analysis 1" },
      { code: null, title: "Lineare Algebra", page: 2, quote: "Lineare Algebra" },
      { code: "MA-102", title: "Analysis I", page: 2, quote: "MA-102 Analysis I" },
    ] },
  ) });

  expect(result).toEqual({ status: "done", dropped: 0 });
  expect((await facts.review(p)).courses.map(c => [c.code, c.title, c.obligations.length]))
    .toEqual([["MA-101", "Analysis I", 1], ["MA-102", "Analysis I", 0], [null, "Lineare Algebra", 0]]);
});

it("fails without storing any Facts when the Allowance runs out part-way, leaving the Source ready", async () => {
  const p = await student();
  await admin.allowance.update({ where: { studentId: p.studentId }, data: { limitMicroUsd: 12 } });
  const sourceId = await readySource(p, "Analysis.pdf", [
    { page: 1, text: "MA-101 Analysis I\nAbgabe Blatt 3: 20.11., 12 Uhr" },
    { page: 2, text: "Die Klausur findet am 10.02.2027 statt." },
  ]);

  const result = await facts.extract(p, sourceId, { delegation,
    extractor: scripted({ ...empty, courses: [analysis], obligations: [sheet3] }, empty) });

  expect(result).toEqual({ status: "failed" });
  expect(await facts.review(p)).toEqual({ courses: [] });
  expect(await sources.list(p)).toEqual([expect.objectContaining({ id: sourceId, status: "ready", extraction: "failed" })]);
});

it("deleting a Source removes its extracted rows, and an extraction it interrupts stores nothing", async () => {
  const p = await student();
  const page = { page: 1, text: "MA-101 Analysis I\nAbgabe Blatt 3: 20.11., 12 Uhr" };
  const extracted = { ...empty, courses: [analysis], obligations: [sheet3] };
  const done = await readySource(p, "Analysis.pdf", [page]);
  await facts.extract(p, done, { delegation, extractor: scripted(extracted) });
  const interrupted = await readySource(p, "Analysis 2.pdf", [page]);
  const deleting = scripted(extracted);
  const extract = deleting.extract;
  deleting.extract = async (window, options) => { await sources.remove(p, interrupted); return extract(window, options); };

  expect(await facts.extract(p, interrupted, { delegation, extractor: deleting })).toEqual({ status: "stopped" });
  await sources.remove(p, done);

  expect(await facts.review(p)).toEqual({ courses: [] });
  // Deletion is not observable through review, which hides deleted Sources anyway: assert the rows are gone.
  const derived = { where: { sourceId: { in: [done, interrupted] } } };
  expect([await admin.obligation.count(derived), await admin.fact.count(derived), await admin.sourceCourse.count(derived)]).toEqual([0, 0, 0]);
});

it("confirms and rejects items and Courses for their owner only, hiding whatever is rejected", async () => {
  const p = await student();
  const sourceId = await readySource(p, "Analysis.pdf", [{ page: 1, text: "MA-101 Analysis I\nAbgabe Blatt 3: 20.11., 12 Uhr\nLineare Algebra" }]);
  const sheet4 = { ...sheet3, title: "Übungsblatt 4", key: "Übungsblatt 4" };
  await facts.extract(p, sourceId, { delegation, extractor: scripted({ ...empty,
    courses: [analysis, { code: null, title: "Lineare Algebra", page: 1, quote: "Lineare Algebra" }], obligations: [sheet3, sheet4] }) });
  const [course, other] = (await facts.review(p)).courses;
  const [first, second] = course!.obligations;
  const stranger = await student();

  expect(await facts.confirm(stranger, { kind: "obligation", id: first!.id })).toEqual({ status: "gone" });
  expect(await facts.decideCourse(stranger, other!.id, "reject")).toEqual({ status: "gone" });
  expect(await facts.confirm(p, { kind: "obligation", id: first!.id })).toEqual({ status: "ok" });
  expect(await facts.reject(p, { kind: "obligation", id: second!.id })).toEqual({ status: "ok" });
  expect(await facts.decideCourse(p, course!.id, "accept")).toEqual({ status: "ok" });
  expect(await facts.decideCourse(p, other!.id, "reject")).toEqual({ status: "ok" });

  expect((await facts.review(p)).courses).toEqual([expect.objectContaining({ id: course!.id, status: "accepted",
    obligations: [expect.objectContaining({ id: first!.id, state: "confirmed" })] })]);
  expect(await facts.review(stranger)).toEqual({ courses: [] });
});

it("stores Topics, course rules and exam logistics with their passage", async () => {
  const p = await student();
  const sourceId = await readySource(p, "Analysis.pdf", [{ page: 1,
    text: "MA-101 Analysis I\nInhalte: gleichmäßige Konvergenz.\nZulassung: 50 % der Übungspunkte.\nKlausur in Raum H1." }]);
  await facts.extract(p, sourceId, { delegation, extractor: scripted({ ...empty, courses: [analysis], facts: [
    { course: "MA-101", type: "topic", key: "Gleichmäßige Konvergenz", value: "Gleichmäßige Konvergenz", page: 1,
      quote: "gleichmäßige Konvergenz", uncertainty: null },
    { course: "MA-101", type: "course_rule", key: "exam admission", value: "50 % der Übungspunkte für die Zulassung", page: 1,
      quote: "Zulassung: 50 % der Übungspunkte.", uncertainty: null },
    { course: "MA-101", type: "exam_logistics", key: "exam.room", value: "H1", page: 1, quote: "Klausur in Raum H1", uncertainty: "Raum kann sich ändern" },
    { course: "MA-101", type: "exam_logistics", key: "exam.aids", value: "Taschenrechner", page: 1, quote: "Taschenrechner erlaubt", uncertainty: null },
  ] }) });

  const [course] = (await facts.review(p)).courses;
  expect(course?.facts).toEqual([
    { id: expect.any(String), type: "topic", value: "Gleichmäßige Konvergenz", uncertainty: null, state: "unreviewed",
      provenance: { kind: "source", sourceId, title: "Analysis.pdf", page: 1, quote: "gleichmäßige Konvergenz" } },
    expect.objectContaining({ type: "course_rule", value: "50 % der Übungspunkte für die Zulassung" }),
    expect.objectContaining({ type: "exam_logistics", value: "H1", uncertainty: "Raum kann sich ändern" }),
  ]);
});

it("releases the reservation when the provider definitely rejected the call, and holds it when the outcome is unknown", async () => {
  const p = await student();
  const page = { page: 1, text: "MA-101 Analysis I" };
  const failing = (error: Error): Extractor => ({ ...scripted(), extract: async () => { throw error; } });
  const rejected = await readySource(p, "Rejected.pdf", [page]);
  const uncertain = await readySource(p, "Uncertain.pdf", [page]);

  expect(await facts.extract(p, rejected, { delegation, extractor: failing(new SourceModelRejected("4xx")) })).toEqual({ status: "failed" });
  expect((await delegation.allowance(p)).heldMicroUsd).toBe(0);
  expect(await facts.extract(p, uncertain, { delegation, extractor: failing(new Error("connection reset")) })).toEqual({ status: "failed" });
  expect((await delegation.allowance(p)).heldMicroUsd).toBe(10);
});
