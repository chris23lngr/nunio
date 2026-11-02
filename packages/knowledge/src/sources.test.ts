import { randomUUID } from "node:crypto";
import { randomBytes } from "node:crypto";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { createDelegation, principal, type Principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createSources, type SourceStorage, type Ingestion } from "./sources.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
const objects = new Map<string, Buffer>();
const storage: SourceStorage = {
  async upload(id, key) { return { url: `https://storage.invalid/${id}`, headers: { key: key.toString("base64") }, expiresAt: new Date(Date.now() + 300_000) }; },
  async download(id, key) { return { url: `https://storage.invalid/${id}`, keyBase64: key.toString("base64"), etag: "test-etag" }; },
  async promote(id) { objects.set(`sources/${id}`, objects.get(id)!); objects.delete(id); },
  async remove(id) { objects.delete(id); objects.delete(`sources/${id}`); },
};
let sources: ReturnType<typeof createSources>;
beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
  sources = createSources({ db: runtime, keys: createSourceKeys({ activeVersion: "v1", masters: { v1: randomBytes(32) } }), storage });
}, 180_000);
afterAll(async () => { await runtime?.$disconnect(); await admin?.$disconnect(); await database?.stop(); });
async function student(revoked = false): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({ data: { id, email: `${id}@example.com`, name: "Student" } });
  await admin.pilotEntitlement.create({ data: { studentId: id, ...(revoked ? { revokedAt: new Date(), revokedBy: "founder" } : {}) } });
  return principal.fromSession({ studentId: id });
}
it("starts a PDF upload only for an entitled student and lists it only to its owner", async () => {
  const owner = await student();
  const other = await student();
  const result = await sources.upload(owner, { title: "Syllabus.pdf", bytes: 100, type: "application/pdf" });
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error("upload refused");
  expect(result.upload.url).toMatch(/^https:/);
  expect(await sources.list(owner)).toEqual([expect.objectContaining({ id: result.source.id, status: "uploading" })]);
  expect(await sources.list(other)).toEqual([]);
  expect(await sources.upload(await student(true), { title: "Syllabus.pdf", bytes: 100, type: "application/pdf" }))
    .toEqual({ status: "refused", reason: "not_entitled" });
});

it("encrypts ingested passages, then deletion immediately removes them and refuses another owner's ID", async () => {
  const p = await student();
  if (p.kind !== "student") throw new Error("student");
  await admin.allowance.create({ data: { studentId: p.studentId, limitMicroUsd: 5_000_000 } });
  const upload = await sources.upload(p, { title: "Exam.pdf", bytes: 100, type: "application/pdf" });
  if (upload.status !== "ok") throw new Error("upload refused");
  objects.set(upload.source.id, Buffer.from("PDF"));
  expect(await sources.complete(p, upload.source.id)).toEqual({ status: "ok" });
  const result = await sources.ingest(p, upload.source.id, {
    parse: async () => ({ pages: [{ page: 1, text: "Prüfung am 12. März in Raum H1." }] }),
    embedder: { model: "test-embedding", dims: 3, estimateMicroUsd: () => 10,
      embed: async () => ({ vectors: [[1, 0, 0]], usage: { microUsd: 2 } }) },
    scans: { estimateMicroUsd: () => 10, read: async () => ({ text: "scan", usage: { microUsd: 2 } }) },
    delegation: createDelegation({ db: runtime, aiEnabled: () => true }),
  });
  expect(result).toEqual({ status: "ready" });
  expect(await sources.list(p)).toEqual([expect.objectContaining({ status: "ready" })]);
  expect(await sources.remove(await student(), upload.source.id)).toEqual({ status: "gone" });
  expect(await sources.remove(p, upload.source.id)).toEqual({ status: "deleted", cleanupAfter: expect.any(Date) });
  expect(await sources.list(p)).toEqual([]);
  await sources.purge(p, upload.source.id);
  expect(objects.has(`sources/${upload.source.id}`)).toBe(false);
});

it("refuses completion and ingestion after a pending deletion request", async () => {
  const p = await student();
  if (p.kind !== "student") throw new Error("student");
  const uploaded = await sources.upload(p, { title: "Exam.pdf", bytes: 100, type: "application/pdf" });
  if (uploaded.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, uploaded.source.id);
  await admin.deletionRequest.create({ data: { studentId: p.studentId } });
  expect(await sources.complete(p, uploaded.source.id)).toEqual({ status: "refused", reason: "deletion_pending" });
  expect(await sources.upload(p, { title: "New.pdf", bytes: 100, type: "application/pdf" }))
    .toEqual({ status: "refused", reason: "deletion_pending" });
  const result = await sources.ingest(p, uploaded.source.id, ingestion({
    parse: async () => { throw new Error("must not reach parser"); },
  }));
  expect(result).toEqual({ status: "stopped" });
  expect(await sources.remove(p, uploaded.source.id)).toMatchObject({ status: "deleted" });
});
function ingestion(overrides: Partial<Ingestion> = {}): Ingestion {
  return {
    parse: async () => ({ pages: [{ page: 1, text: "The exam is in room H1." }] }),
    embedder: { model: "test", dims: 3, estimateMicroUsd: () => 10,
      embed: async () => ({ vectors: [[1, 0, 0]], usage: { microUsd: 1 } }) },
    scans: { estimateMicroUsd: () => 10, read: async () => ({ text: "Scan", usage: { microUsd: 1 } }) },
    delegation: createDelegation({ db: runtime, aiEnabled: () => true }), ...overrides,
  };
}
it("does not publish or resurrect a Source deleted while embeddings are in flight", async () => {
  const p = await student();
  if (p.kind !== "student") throw new Error("student");
  await admin.allowance.create({ data: { studentId: p.studentId, limitMicroUsd: 5_000_000 } });
  const uploaded = await sources.upload(p, { title: "Race.pdf", bytes: 100, type: "application/pdf" });
  if (uploaded.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, uploaded.source.id);
  const result = await sources.ingest(p, uploaded.source.id, ingestion({ embedder: {
    model: "test", dims: 3, estimateMicroUsd: () => 10, embed: async () => {
      await sources.remove(p, uploaded.source.id);
      return { vectors: [[1, 0, 0]], usage: { microUsd: 1 } };
    },
  } }));
  expect(result).toEqual({ status: "stopped" });
  expect(await sources.list(p)).toEqual([]);
  expect(await sources.complete(p, uploaded.source.id)).toEqual({ status: "gone" });
});
it("publishes once when completion or ingestion is repeated", async () => {
  const p = await student();
  if (p.kind !== "student") throw new Error("student");
  await admin.allowance.create({ data: { studentId: p.studentId, limitMicroUsd: 5_000_000 } });
  const uploaded = await sources.upload(p, { title: "Repeat.pdf", bytes: 100, type: "application/pdf" });
  if (uploaded.status !== "ok") throw new Error("upload refused");
  await Promise.all([sources.complete(p, uploaded.source.id), sources.complete(p, uploaded.source.id)]);
  let calls = 0;
  const deps = ingestion({ embedder: { model: "test", dims: 3, estimateMicroUsd: () => 10,
    embed: async () => { calls++; return { vectors: [[1, 0, 0]], usage: { microUsd: 1 } }; } } });
  const results = await Promise.all([sources.ingest(p, uploaded.source.id, deps), sources.ingest(p, uploaded.source.id, deps)]);
  expect(results.map(r => r.status).sort()).toEqual(["ready", "stopped"]);
  expect(calls).toBe(1);
});

it("keeps deletion retryable if durable cleanup cannot be dispatched", async () => {
  const p = await student();
  const uploaded = await sources.upload(p, { title: "Retry.pdf", bytes: 100, type: "application/pdf" });
  if (uploaded.status !== "ok") throw new Error("upload refused");
  await expect(sources.removeWithCleanup(p, uploaded.source.id, async () => { throw new Error("Temporal unavailable"); }))
    .rejects.toThrow("Temporal unavailable");
  expect(await sources.list(p)).toEqual([expect.objectContaining({ id: uploaded.source.id })]);
});

it("refuses revoked students at completion and ingestion, and rejects invalid upload declarations", async () => {
  const p = await student();
  if (p.kind !== "student") throw new Error("student");
  expect(await sources.upload(p, { title: "Bad.pdf", bytes: 20 * 1024 * 1024 + 1, type: "application/pdf" }))
    .toEqual({ status: "refused", reason: "invalid_upload" });
  expect(await sources.upload(p, { title: "Bad.docx", bytes: 100, type: "application/zip" }))
    .toEqual({ status: "refused", reason: "invalid_upload" });
  const uploaded = await sources.upload(p, { title: "Exam.pdf", bytes: 100, type: "application/pdf" });
  if (uploaded.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, uploaded.source.id);
  await admin.pilotEntitlement.update({ where: { studentId: p.studentId }, data: { revokedAt: new Date(), revokedBy: "founder" } });
  expect(await sources.complete(p, uploaded.source.id)).toEqual({ status: "refused", reason: "not_entitled" });
  expect(await sources.ingest(p, uploaded.source.id, ingestion())).toEqual({ status: "stopped" });
});
it("keeps parser failures out of sources and never invokes an embedding model", async () => {
  const p = await student();
  const uploaded = await sources.upload(p, { title: "Malformed.pdf", bytes: 100, type: "application/pdf" });
  if (uploaded.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, uploaded.source.id);
  expect(await sources.ingest(p, uploaded.source.id, ingestion({ parse: async () => { throw new Error("malformed PDF"); } })))
    .toEqual({ status: "failed" });
  expect(objects.has(`sources/${uploaded.source.id}`)).toBe(false);
  expect(await sources.list(p)).toEqual([expect.objectContaining({ status: "failed" })]);
});
async function ingestPages(pages: { page: number; text: string; imageBase64?: string }[]) {
  const p = await student();
  if (p.kind !== "student") throw new Error("student");
  await admin.allowance.create({ data: { studentId: p.studentId, limitMicroUsd: 5_000_000 } });
  const uploaded = await sources.upload(p, { title: "Scan.pdf", bytes: 100, type: "application/pdf" });
  if (uploaded.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, uploaded.source.id);
  const delegation = createDelegation({ db: runtime, aiEnabled: () => true });
  const metered: number[] = [];
  const read: Buffer[] = [];
  const embedded: string[] = [];
  const result = await sources.ingest(p, uploaded.source.id, ingestion({
    parse: async () => ({ pages }),
    delegation: { ...delegation, meter: (principal, estimate, call, options) => {
      metered.push(estimate.microUsd);
      return delegation.meter(principal, estimate, call, options);
    } },
    scans: { estimateMicroUsd: () => 7, read: async image => { read.push(image); return { text: "Klausur am 3. Juli", usage: { microUsd: 1 } }; } },
    embedder: { model: "test", dims: 3, estimateMicroUsd: () => 10,
      embed: async texts => { embedded.push(...texts); return { vectors: texts.map(() => [1, 0, 0]), usage: { microUsd: 1 } }; } },
  }));
  return { result, metered, read, embedded };
}
it("meters a scanned page's transcription and indexes its text", async () => {
  const png = Buffer.from("scanned page image");
  const { result, metered, read, embedded } = await ingestPages([{ page: 1, text: "", imageBase64: png.toString("base64") }]);
  expect(result).toEqual({ status: "ready" });
  expect(read).toEqual([png]);
  expect(metered).toEqual([7, 10]);
  expect(embedded).toEqual(["Klausur am 3. Juli"]);
});
it("keeps a page's extracted text when it is also transcribed", async () => {
  const { result, embedded } = await ingestPages([{ page: 1, text: "Raum H1",
    imageBase64: Buffer.from("page image").toString("base64") }]);
  expect(result).toEqual({ status: "ready" });
  expect(embedded.join("\n")).toContain("Raum H1");
  expect(embedded.join("\n")).toContain("Klausur am 3. Juli");
});
