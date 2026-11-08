import { randomBytes, randomUUID } from "node:crypto";
import { SourceModelRejected, type Extracted, type Extractor, type Page } from "@nunio/ai";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { createDelegation, principal, type Delegation, type Principal } from "@nunio/delegation";
import { createSourceKeys, type SourceKeys } from "@nunio/keys";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createFacts, type Facts } from "./facts.js";
import { createSources, type Sources, type SourceStorage } from "./sources.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
let sources: Sources;
let facts: Facts;
let delegation: Delegation;
let keys: SourceKeys;
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
  keys = createSourceKeys({ activeVersion: "v1", masters: { v1: randomBytes(32) } });
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
    embedder: { model: "test-embedding", dims: 3, relevanceFloor: 0.3, estimateMicroUsd: () => 1,
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

  expect(result).toEqual({ status: "done", dropped: 0, reviewableAfterMs: expect.any(Number) });
  expect(await facts.review(p)).toEqual({
    courses: [{
      id: expect.any(String), code: "MA-101", title: "Analysis I", status: "proposed",
      obligations: [{
        id: expect.any(String), kind: "assignment", title: "Übungsblatt 3", state: "unreviewed",
        due: { date: "2026-11-20", time: "12:00", timeZone: "Europe/Berlin", text: "Abgabe Blatt 3: 20.11., 12 Uhr" },
        destination: "Moodle", uncertainty: "Time zone assumed",
        provenance: { kind: "source", sourceId, title: "Analysis.pdf", page: 1, quote: "Abgabe Blatt 3: 20.11., 12 Uhr" },
        disagreement: false, unsupported: null,
        values: [{ due: { date: "2026-11-20", time: "12:00", timeZone: "Europe/Berlin" }, overruled: false,
          citations: [{ extractionId: expect.any(String), sourceId, title: "Analysis.pdf", page: 1, quote: "Abgabe Blatt 3: 20.11., 12 Uhr" }] }],
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

  expect(result).toEqual(expect.objectContaining({ status: "done", dropped: 4 }));
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

  expect(result).toEqual(expect.objectContaining({ status: "done", dropped: 0 }));
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
  expect([await admin.obligationExtraction.count(derived), await admin.factExtraction.count(derived), await admin.sourceCourse.count(derived),
    await admin.obligation.count({ where: { studentId: p.studentId } })]).toEqual([0, 0, 0, 0]);
});

it("confirms and rejects items and Courses for their owner only, folding away whatever is rejected", async () => {
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

  expect((await facts.review(p)).courses).toEqual([
    expect.objectContaining({ id: course!.id, status: "accepted", obligations: [
      expect.objectContaining({ id: first!.id, state: "confirmed" }), expect.objectContaining({ id: second!.id, state: "rejected" })] }),
    // A rejected Course keeps no items in review: they stay hidden until it is restored.
    expect.objectContaining({ id: other!.id, status: "rejected", obligations: [], facts: [] }),
  ]);
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
      provenance: { kind: "source", sourceId, title: "Analysis.pdf", page: 1, quote: "gleichmäßige Konvergenz" },
      disagreement: false, unsupported: null,
      values: [{ value: "Gleichmäßige Konvergenz", overruled: false,
        citations: [{ extractionId: expect.any(String), sourceId, title: "Analysis.pdf", page: 1, quote: "gleichmäßige Konvergenz" }] }] },
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

it("reports the time from the upload request to a reviewable result", async () => {
  const p = await student();
  const sourceId = await readySource(p, "Analysis.pdf", [{ page: 1, text: "MA-101 Analysis I" }]);
  const later = createFacts({ db: runtime, keys, clock: { now: () => new Date(Date.now() + 90_000) } });

  const result = await later.extract(p, sourceId, { delegation, extractor: scripted({ ...empty, courses: [analysis] }) });

  if (result.status !== "done") throw new Error(result.status);
  expect(result.reviewableAfterMs).toBeGreaterThanOrEqual(90_000);
  expect(result.reviewableAfterMs).toBeLessThan(120_000);
});

/** A ready Source stating Blatt 3's deadline as `text`, extracted with that deadline. */
async function sheet3Source(p: Principal, title: string, due = sheet3.due) {
  const sourceId = await readySource(p, title, [{ page: 1, text: `MA-101 Analysis I\n${due.text}` }]);
  await facts.extract(p, sourceId, { delegation, extractor: scripted({ ...empty, courses: [analysis],
    obligations: [{ ...sheet3, due, quote: due.text }] }) });
  return sourceId;
}
const sheet3Later = { date: "2026-11-27", time: "12:00", timeZone: null, text: "Abgabe Blatt 3 verschoben: 27.11., 12 Uhr" };
async function sheet3Item(p: Principal) {
  const [course] = (await facts.review(p)).courses;
  return course!.obligations.find(o => o.kind === "assignment")!;
}

it("shows one item for Sources that agree, citing each of them", async () => {
  const p = await student();
  const first = await sheet3Source(p, "Analysis.pdf");
  const second = await sheet3Source(p, "Übersicht.pdf");

  const item = await sheet3Item(p);

  expect(item).toEqual(expect.objectContaining({ disagreement: false, values: [{
    due: { date: "2026-11-20", time: "12:00", timeZone: "Europe/Berlin" }, overruled: false,
    citations: [expect.objectContaining({ sourceId: first }), expect.objectContaining({ sourceId: second })] }] }));
});

it("flags a Source that disagrees and returns a confirmed item to review", async () => {
  const p = await student();
  await sheet3Source(p, "Analysis.pdf");
  await facts.confirm(p, { kind: "obligation", id: (await sheet3Item(p)).id });
  await sheet3Source(p, "Nachtrag.pdf", sheet3Later);

  const item = await sheet3Item(p);

  expect(item.state).toBe("unreviewed");
  expect(item.disagreement).toBe(true);
  expect(item.values.map(value => [value.due.date, value.overruled, value.citations.map(c => c.title)]))
    .toEqual([["2026-11-20", false, ["Analysis.pdf"]], ["2026-11-27", false, ["Nachtrag.pdf"]]]);
});

it("resolves a disagreement with the value the student uses, until a Source brings yet another value", async () => {
  const p = await student();
  await sheet3Source(p, "Analysis.pdf");
  await sheet3Source(p, "Nachtrag.pdf", sheet3Later);
  const flagged = await sheet3Item(p);
  const later = flagged.values[1]!.citations[0]!.extractionId;

  expect(await facts.use(p, { kind: "obligation", id: flagged.id }, later)).toEqual({ status: "ok" });
  const resolved = await sheet3Item(p);
  expect([resolved.state, resolved.disagreement, resolved.due.date, resolved.values.map(value => value.overruled)])
    .toEqual(["confirmed", false, "2026-11-27", [true, false]]);

  await sheet3Source(p, "Analysis Kopie.pdf");
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ state: "confirmed", disagreement: false }));
  await sheet3Source(p, "Nachtrag 2.pdf", { ...sheet3Later, date: "2026-12-04", text: "Abgabe Blatt 3 verschoben: 04.12., 12 Uhr" });
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ state: "unreviewed", disagreement: true }));
});

it("lets a Correction win over every Source, flagging later disagreement until the student keeps it or uses the new value", async () => {
  const p = await student();
  await sheet3Source(p, "Analysis.pdf");
  const { id } = await sheet3Item(p);
  const ref = { kind: "obligation" as const, id };
  const mine = { title: "Blatt 3 (Gruppe B)", due: { date: "2026-11-21", time: "10:00", timeZone: null }, destination: "Briefkasten" };

  for (const date of ["2026-02-30", "2026-13-01"]) {
    expect(await facts.correct(p, ref, { ...mine, due: { date, time: null, timeZone: null } })).toEqual({ status: "invalid" });
  }
  expect(await facts.correct(p, ref, { ...mine, due: { date: null, time: "10:00", timeZone: null } })).toEqual({ status: "invalid" });
  expect(await facts.correct(p, ref, mine)).toEqual({ status: "ok" });
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ state: "confirmed", disagreement: false, title: "Blatt 3 (Gruppe B)",
    due: { date: "2026-11-21", time: "10:00", timeZone: "Europe/Berlin", text: null }, destination: "Briefkasten",
    uncertainty: null, provenance: { kind: "correction" } }));

  await sheet3Source(p, "Nachtrag.pdf", sheet3Later);
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ state: "confirmed", disagreement: true, title: "Blatt 3 (Gruppe B)" }));
  expect(await facts.keepMine(p, ref)).toEqual({ status: "ok" });
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ disagreement: false, title: "Blatt 3 (Gruppe B)" }));

  const later = (await sheet3Item(p)).values.find(value => value.due.date === "2026-11-27")!.citations[0]!.extractionId;
  expect(await facts.use(p, ref, later)).toEqual({ status: "ok" });
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ state: "confirmed", disagreement: false, title: "Übungsblatt 3",
    due: expect.objectContaining({ date: "2026-11-27" }), provenance: expect.objectContaining({ kind: "source", title: "Nachtrag.pdf" }) }));
});

it("applies the same review rules to Facts, comparing their normalized value", async () => {
  const p = await student();
  const roomSource = async (title: string, room: string) => {
    const sourceId = await readySource(p, title, [{ page: 1, text: `MA-101 Analysis I\nKlausur in Raum ${room}` }]);
    await facts.extract(p, sourceId, { delegation, extractor: scripted({ ...empty, courses: [analysis], facts: [{ course: "MA-101",
      type: "exam_logistics", key: "exam.room", value: room, page: 1, quote: `Klausur in Raum ${room}`, uncertainty: null }] }) });
  };
  const room = async () => (await facts.review(p)).courses[0]!.facts[0]!;
  await roomSource("Analysis.pdf", "H1");
  const ref = { kind: "fact" as const, id: (await room()).id };
  await facts.confirm(p, ref);

  await roomSource("Kopie.pdf", "h1 ");
  expect(await room()).toEqual(expect.objectContaining({ state: "confirmed", disagreement: false }));
  await roomSource("Nachtrag.pdf", "H2");
  expect(await room()).toEqual(expect.objectContaining({ state: "unreviewed", disagreement: true }));

  expect(await facts.correct(p, ref, { value: " " })).toEqual({ status: "invalid" });
  expect(await facts.correct(p, ref, { value: "Audimax" })).toEqual({ status: "ok" });
  expect(await room()).toEqual(expect.objectContaining({ state: "confirmed", disagreement: false, value: "Audimax", provenance: { kind: "correction" } }));
  await roomSource("Nachtrag 2.pdf", "H3");
  expect(await room()).toEqual(expect.objectContaining({ disagreement: true }));
  await facts.keepMine(p, ref);
  expect(await room()).toEqual(expect.objectContaining({ disagreement: false, value: "Audimax" }));

  const h2 = (await room()).values.find(value => value.value === "H2")!.citations[0]!.extractionId;
  expect(await facts.use(p, ref, h2)).toEqual({ status: "ok" });
  expect(await room()).toEqual(expect.objectContaining({ state: "confirmed", disagreement: false, value: "H2" }));
});

it("keeps a rejected item rejected through later Sources until the student restores it", async () => {
  const p = await student();
  await sheet3Source(p, "Analysis.pdf");
  const ref = { kind: "obligation" as const, id: (await sheet3Item(p)).id };
  await facts.reject(p, ref);

  await sheet3Source(p, "Kopie.pdf");
  await sheet3Source(p, "Nachtrag.pdf", sheet3Later);
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ id: ref.id, state: "rejected" }));

  expect(await facts.restore(p, ref)).toEqual({ status: "ok" });
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ id: ref.id, state: "unreviewed", disagreement: true }));
});

it("restores a rejected Course as a proposal with its items", async () => {
  const p = await student();
  await sheet3Source(p, "Analysis.pdf");
  const [course] = (await facts.review(p)).courses;
  await facts.decideCourse(p, course!.id, "reject");

  expect(await facts.decideCourse(p, course!.id, "restore")).toEqual({ status: "ok" });
  expect((await facts.review(p)).courses).toEqual([expect.objectContaining({ id: course!.id, status: "proposed",
    obligations: [expect.objectContaining({ title: "Übungsblatt 3" })] })]);
});

it("keeps a Correction when its Source is deleted, and drops items and rejections only that Source supported", async () => {
  const p = await student();
  const sheet4 = { ...sheet3, title: "Übungsblatt 4", key: "Übungsblatt 4" }, sheet5 = { ...sheet3, title: "Übungsblatt 5", key: "Übungsblatt 5" };
  const sourceId = await readySource(p, "Analysis.pdf", [{ page: 1, text: "MA-101 Analysis I\nAbgabe Blatt 3: 20.11., 12 Uhr" }]);
  await facts.extract(p, sourceId, { delegation, extractor: scripted({ ...empty, courses: [analysis], obligations: [sheet3, sheet4, sheet5] }) });
  const [course] = (await facts.review(p)).courses;
  const byTitle = (title: string) => course!.obligations.find(o => o.title === title)!;
  await facts.correct(p, { kind: "obligation", id: byTitle("Übungsblatt 3").id },
    { title: "Blatt 3", due: { date: "2026-11-21", time: null, timeZone: null }, destination: null });
  await facts.reject(p, { kind: "obligation", id: byTitle("Übungsblatt 4").id });

  await sources.remove(p, sourceId);

  expect((await facts.review(p)).courses).toEqual([expect.objectContaining({ id: course!.id, obligations: [
    expect.objectContaining({ title: "Blatt 3", unsupported: "source_deleted", values: [], provenance: { kind: "correction" } })] })]);
});

it("combines a Source's repeated value into one citation on its first page, keeping a differing value apart", async () => {
  const p = await student();
  const sourceId = await readySource(p, "Analysis.pdf", [
    { page: 1, text: "MA-101 Analysis I\nAbgabe Blatt 3: 20.11., 12 Uhr" },
    { page: 2, text: `MA-101 Analysis I\nAbgabe Blatt 3: 20.11., 12 Uhr\n${sheet3Later.text}` },
  ]);
  await facts.extract(p, sourceId, { delegation, extractor: scripted(
    { ...empty, courses: [analysis], obligations: [{ ...sheet3, page: 2 }] },
    { ...empty, courses: [{ ...analysis, page: 2 }], obligations: [sheet3, { ...sheet3, due: sheet3Later, page: 2, quote: sheet3Later.text }] },
  ) });

  expect((await sheet3Item(p)).values.map(value => [value.due.date, value.citations.map(c => c.page)]))
    .toEqual([["2026-11-20", [1]], ["2026-11-27", [2]]]);
});

it("refuses another student's Correct, Keep mine, Use this and Restore without changing anything", async () => {
  const p = await student();
  await sheet3Source(p, "Analysis.pdf");
  const before = await facts.review(p);
  const item = before.courses[0]!.obligations[0]!;
  const ref = { kind: "obligation" as const, id: item.id };
  await facts.reject(p, ref);
  await facts.decideCourse(p, before.courses[0]!.id, "reject");
  const stranger = await student();

  expect([
    await facts.correct(stranger, ref, { title: "Mine", due: { date: null, time: null, timeZone: null }, destination: null }),
    await facts.keepMine(stranger, ref),
    await facts.use(stranger, ref, item.values[0]!.citations[0]!.extractionId),
    await facts.restore(stranger, ref),
    await facts.decideCourse(stranger, before.courses[0]!.id, "restore"),
  ]).toEqual(Array(5).fill({ status: "gone" }));
  await facts.decideCourse(p, before.courses[0]!.id, "restore");
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ state: "rejected", title: "Übungsblatt 3" }));
});

it("extracts a Source again on request, replacing its extractions and carrying review over by value", async () => {
  const p = await student();
  const text = `MA-101 Analysis I\nAbgabe Blatt 3: 20.11., 12 Uhr\n${sheet3Later.text}`;
  const sourceId = await readySource(p, "Analysis.pdf", [{ page: 1, text }]);
  const sheet = (n: number, due = sheet3.due) => ({ ...sheet3, title: `Übungsblatt ${n}`, key: `Übungsblatt ${n}`, due, quote: due.text });
  await facts.extract(p, sourceId, { delegation, extractor: scripted({ ...empty, courses: [analysis], obligations: [sheet(3), sheet(4), sheet(5)] }) });
  const item = async (title: string) => (await facts.review(p)).courses[0]!.obligations.find(o => o.title === title || o.values.length === 0)!;
  const ref = async (title: string) => ({ kind: "obligation" as const, id: (await item(title)).id });
  await facts.confirm(p, await ref("Übungsblatt 3"));
  await facts.confirm(p, await ref("Übungsblatt 4"));
  await facts.correct(p, await ref("Übungsblatt 5"), { title: "Blatt 5", due: { date: null, time: null, timeZone: null }, destination: null });

  expect(await facts.requestExtraction(p, sourceId)).toEqual({ status: "ok" });
  const result = await facts.extract(p, sourceId, { delegation,
    extractor: scripted({ ...empty, courses: [analysis], obligations: [sheet(3), sheet(4, sheet3Later)] }) });

  expect(result).toEqual({ status: "done", dropped: 0, reextractionMs: expect.any(Number) });
  expect(await item("Übungsblatt 3")).toEqual(expect.objectContaining({ state: "confirmed", disagreement: false,
    values: [expect.objectContaining({ citations: [expect.objectContaining({ sourceId })] })] }));
  expect(await item("Übungsblatt 4")).toEqual(expect.objectContaining({ state: "unreviewed", disagreement: false,
    values: [expect.objectContaining({ due: expect.objectContaining({ date: "2026-11-27" }) })] }));
  expect(await item("Blatt 5")).toEqual(expect.objectContaining({ unsupported: "not_found", values: [], provenance: { kind: "correction" } }));
});

it("keeps the previous review when extracting again fails, and refuses a request while running or for a Source that is gone", async () => {
  const p = await student();
  const sourceId = await sheet3Source(p, "Analysis.pdf");
  await facts.confirm(p, { kind: "obligation", id: (await sheet3Item(p)).id });
  const stranger = await student();
  expect(await facts.requestExtraction(stranger, sourceId)).toEqual({ status: "gone" });

  expect(await facts.requestExtraction(p, sourceId)).toEqual({ status: "ok" });
  const running = scripted();
  let whileRunning: unknown;
  running.extract = async () => { whileRunning = await facts.requestExtraction(p, sourceId); throw new SourceModelRejected("4xx"); };
  expect(await facts.extract(p, sourceId, { delegation, extractor: running })).toEqual({ status: "failed" });
  expect(whileRunning).toEqual({ status: "running" });

  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ state: "confirmed", title: "Übungsblatt 3" }));
  expect(await sources.list(p)).toEqual([expect.objectContaining({ id: sourceId, extraction: "failed" })]);
  await sources.remove(p, sourceId);
  expect(await facts.requestExtraction(p, sourceId)).toEqual({ status: "gone" });
});

const analysis1 = { code: null, title: "Analysis 1", page: 1, quote: "Analysis 1" };
/** A ready Source naming only "Analysis 1" (no code), stating Blatt 3's deadline as `due.text`. */
async function analysis1Source(p: Principal, title: string, due = sheet3.due, more: (typeof sheet3)[] = []) {
  const sourceId = await readySource(p, title, [{ page: 1, text: `Analysis 1\n${due.text}` }]);
  await facts.extract(p, sourceId, { delegation, extractor: scripted({ ...empty, courses: [analysis1],
    obligations: [{ ...sheet3, course: "Analysis 1", due, quote: due.text }, ...more.map(o => ({ ...o, course: "Analysis 1" }))] }) });
  return sourceId;
}
const courseNamed = async (p: Principal, title: string) => (await facts.review(p)).courses.find(c => c.title === title)!;

it("merges a Course into another, combining items with the same key, and sends later Sources naming it there", async () => {
  const p = await student();
  const first = await sheet3Source(p, "Analysis.pdf");
  const sheet4 = { ...sheet3, title: "Übungsblatt 4", key: "Übungsblatt 4", quote: sheet3.due.text };
  const second = await analysis1Source(p, "Übersicht.pdf", sheet3.due, [sheet4]);
  const [into, from] = [await courseNamed(p, "Analysis I"), await courseNamed(p, "Analysis 1")];

  expect(await facts.mergeCourses(p, from.id, into.id)).toEqual({ status: "ok" });

  const { courses } = await facts.review(p);
  expect(courses.map(c => [c.id, c.status])).toEqual([[into.id, "accepted"]]);
  expect(courses[0]!.obligations.map(o => [o.title, o.values.flatMap(v => v.citations.map(c => c.sourceId))]))
    .toEqual([["Übungsblatt 3", [first, second]], ["Übungsblatt 4", [second]]]);
  const third = await analysis1Source(p, "Nachtrag.pdf");
  expect((await facts.review(p)).courses.map(c => c.id)).toEqual([into.id]);
  expect((await sheet3Item(p)).values[0]!.citations.map(c => c.sourceId)).toEqual([first, second, third]);
});

it("moves a Correction only the merged Course has, and refuses a merge between differing Corrections", async () => {
  const p = await student();
  await sheet3Source(p, "Analysis.pdf");
  await analysis1Source(p, "Übersicht.pdf");
  const [into, from] = [await courseNamed(p, "Analysis I"), await courseNamed(p, "Analysis 1")];
  const ref = (course: typeof into) => ({ kind: "obligation" as const, id: course.obligations[0]!.id });
  const correction = (date: string) => ({ title: "Blatt 3", due: { date, time: null, timeZone: null }, destination: null });
  await facts.correct(p, ref(from), correction("2026-11-21"));
  await facts.correct(p, ref(into), correction("2026-11-22"));

  expect(await facts.mergeCourses(p, from.id, into.id)).toEqual({ status: "conflict", items: [ref(into)] });
  expect((await facts.review(p)).courses.map(c => c.status)).toEqual(["proposed", "proposed"]);

  await facts.use(p, ref(into), into.obligations[0]!.values[0]!.citations[0]!.extractionId);
  expect(await facts.mergeCourses(p, from.id, into.id)).toEqual({ status: "ok" });
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ id: ref(into).id, state: "confirmed", title: "Blatt 3",
    due: expect.objectContaining({ date: "2026-11-21" }), provenance: { kind: "correction" } }));
});

it("refuses merging a Course into itself, into a rejected or merged Course, or another student's Courses", async () => {
  const p = await student();
  await sheet3Source(p, "Analysis.pdf");
  await analysis1Source(p, "Übersicht.pdf");
  const lineare = await readySource(p, "LA.pdf", [{ page: 1, text: "Lineare Algebra" }]);
  await facts.extract(p, lineare, { delegation, extractor: scripted({ ...empty, courses: [{ code: null, title: "Lineare Algebra", page: 1, quote: "Lineare Algebra" }] }) });
  const [a, b, rejected] = [await courseNamed(p, "Analysis I"), await courseNamed(p, "Analysis 1"), await courseNamed(p, "Lineare Algebra")];
  await facts.decideCourse(p, rejected.id, "reject");
  const stranger = await student();

  expect([
    await facts.mergeCourses(p, a.id, a.id),
    await facts.mergeCourses(p, b.id, rejected.id),
    await facts.mergeCourses(stranger, b.id, a.id),
  ]).toEqual(Array(3).fill({ status: "gone" }));
  await facts.mergeCourses(p, b.id, a.id);
  expect([await facts.mergeCourses(p, b.id, a.id), await facts.mergeCourses(p, a.id, b.id)]).toEqual(Array(2).fill({ status: "gone" }));
});

const entry = { kind: "exam" as const, title: "Klausur", due: { date: "2027-02-12", time: "09:00", timeZone: null }, destination: null };

it("enters an Obligation by hand under an accepted Course or a new one, confirmed with Provenance entry", async () => {
  const p = await student();
  await sheet3Source(p, "Analysis.pdf");
  const analysisId = (await courseNamed(p, "Analysis I")).id;
  await facts.decideCourse(p, analysisId, "accept");

  const underAccepted = await facts.enterObligation(p, { ...entry, course: { id: analysisId } });
  const underNew = await facts.enterObligation(p, { ...entry, kind: "assignment", title: "Hausarbeit", due: { date: null, time: null, timeZone: null },
    destination: "Moodle", course: { title: "Lineare Algebra", code: "MA-102" } });

  expect([underAccepted, underNew]).toEqual([{ status: "ok", id: expect.any(String) }, { status: "ok", id: expect.any(String) }]);
  expect((await courseNamed(p, "Analysis I")).obligations.find(o => o.kind === "exam")).toEqual({
    id: underAccepted.status === "ok" ? underAccepted.id : "", kind: "exam", title: "Klausur", state: "confirmed",
    due: { date: "2027-02-12", time: "09:00", timeZone: "Europe/Berlin", text: null }, destination: null, uncertainty: null,
    provenance: { kind: "entry" }, disagreement: false, unsupported: null, values: [] });
  expect(await courseNamed(p, "Lineare Algebra")).toEqual(expect.objectContaining({ code: "MA-102", status: "accepted",
    obligations: [expect.objectContaining({ title: "Hausarbeit", destination: "Moodle", provenance: { kind: "entry" } })] }));
});

it("refuses an invalid entry, a Course that is not accepted or not the student's, and a key the Course already has", async () => {
  const p = await student();
  await sheet3Source(p, "Analysis.pdf");
  const course = { id: (await courseNamed(p, "Analysis I")).id };

  expect(await facts.enterObligation(p, { ...entry, course })).toEqual({ status: "gone" });
  await facts.decideCourse(p, course.id, "accept");
  expect([
    await facts.enterObligation(p, { ...entry, course, due: { date: "2027-02-30", time: null, timeZone: null } }),
    await facts.enterObligation(p, { ...entry, course, title: " " }),
    await facts.enterObligation(p, { ...entry, course: { title: " ", code: null } }),
  ]).toEqual(Array(3).fill({ status: "invalid" }));
  expect(await facts.enterObligation(await student(), { ...entry, course })).toEqual({ status: "gone" });
  expect(await facts.enterObligation(p, { ...entry, course, kind: "assignment", title: "übungsblatt  3" })).toEqual({ status: "exists" });
});

it("lets a later Source attach to an entered Obligation like a Correction, which the student keeps or replaces", async () => {
  const p = await student();
  const entered = await facts.enterObligation(p, { kind: "assignment", title: "Übungsblatt 3",
    due: { date: "2026-11-21", time: null, timeZone: null }, destination: null, course: { title: "Analysis I", code: "MA-101" } });
  if (entered.status !== "ok") throw new Error(entered.status);
  const ref = { kind: "obligation" as const, id: entered.id };

  const sourceId = await sheet3Source(p, "Analysis.pdf");
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ id: entered.id, state: "confirmed", disagreement: true,
    provenance: { kind: "entry" }, values: [expect.objectContaining({ citations: [expect.objectContaining({ sourceId })] })] }));
  await facts.correct(p, ref, { title: "Blatt 3", due: { date: "2026-11-20", time: "12:00", timeZone: null }, destination: null });
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ title: "Blatt 3", disagreement: false, provenance: { kind: "entry" } }));

  await sources.remove(p, sourceId);
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ id: entered.id, unsupported: "source_deleted", provenance: { kind: "entry" } }));
  await sheet3Source(p, "Nachtrag.pdf", sheet3Later);
  await facts.use(p, ref, (await sheet3Item(p)).values[0]!.citations[0]!.extractionId);
  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ id: entered.id, title: "Übungsblatt 3", unsupported: null,
    provenance: expect.objectContaining({ kind: "source", title: "Nachtrag.pdf" }) }));
  // Once it follows a Source, correcting it again is a Correction, no longer the student's entry.
  await facts.correct(p, ref, { title: "Blatt 3", due: { date: "2026-11-28", time: null, timeZone: null }, destination: null });
  expect((await sheet3Item(p)).provenance).toEqual({ kind: "correction" });
});

it("keeps an entered Obligation an entry when a merge moves it onto the target's extracted item", async () => {
  const p = await student();
  await sheet3Source(p, "Analysis.pdf");
  await facts.enterObligation(p, { kind: "assignment", title: "Übungsblatt 3", due: { date: "2026-11-21", time: null, timeZone: null },
    destination: null, course: { title: "Analysis 1", code: null } });

  await facts.mergeCourses(p, (await courseNamed(p, "Analysis 1")).id, (await courseNamed(p, "Analysis I")).id);

  expect(await sheet3Item(p)).toEqual(expect.objectContaining({ provenance: { kind: "entry" }, due: expect.objectContaining({ date: "2026-11-21" }) }));
});
