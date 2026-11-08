// Phase 7 German retrieval eval (docs/design/knowledge-retrieval.md). Public handbook excerpts only.
// Runs the real read path: parser code in-process (host qpdf/Poppler), a throwaway Postgres, real ingestion and
// query embeddings through OpenRouter, and `retrieve` with its score floor. Build the workspace first, then from the repo root:
//   apps/worker/node_modules/.bin/tsx --env-file=packages/ai/.env.staging apps/worker/evals/retrieval.ts
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createEmbedder, createModels, createScanReader } from "@nunio/ai";
import { createPool, createPrismaClient } from "@nunio/db";
import { startTestDatabase } from "@nunio/db/testing";
import { createDelegation, principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { createChats, createKnowledgeReader, createSources } from "@nunio/knowledge";
import { createParserServer } from "@nunio/parser/server";
import { parseSource } from "../src/source-activities.ts";

interface Source { url: string; pages?: [number, number] }
const exec = promisify(execFile);
const here = (path: string) => new URL(path, import.meta.url);
const set = JSON.parse(await readFile(here("./extraction/set.json"), "utf8")) as { documents: { id: string; source: Source | { file: string } }[] };
const labels = JSON.parse(await readFile(here("./retrieval/questions.json"), "utf8")) as
  { documents: { id: string; questions: { text: string; pages: number[] }[]; unanswerable: string[] }[] };
const cache = join(tmpdir(), "nunio-extraction-eval");
await mkdir(cache, { recursive: true });

async function bytesOf(id: string, source: Source) {
  const whole = join(cache, `${id}-whole.pdf`);
  if (!existsSync(whole)) {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`${id}: download failed (${response.status})`);
    await writeFile(whole, Buffer.from(await response.arrayBuffer()));
  }
  if (!source.pages) return readFile(whole);
  const [from, to] = source.pages, excerpt = join(cache, `${id}.pdf`);
  await exec("qpdf", [whole, "--pages", whole, `${from}-${to}`, "--", excerpt]);
  return readFile(excerpt);
}

const provider = { apiKey: process.env.OPENROUTER_API_KEY ?? "", baseURL: process.env.OPENROUTER_BASE_URL ?? "" };
if (!provider.apiKey || !provider.baseURL) throw new Error("OPENROUTER_API_KEY and OPENROUTER_BASE_URL are required");
const embedder = createEmbedder(provider), scans = createScanReader(createModels(provider));

const objects = new Map<string, Buffer>();
const parser = createParserServer({ storageEndpoint: "https://eval.invalid", quarantineBucket: "eval",
  fetch: async input => {
    const id = new URL(String(input)).pathname.split("/").pop()!;
    const bytes = objects.get(id);
    return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
  } });
await new Promise<void>(resolve => parser.listen(0, "127.0.0.1", resolve));
const parserHostport = `127.0.0.1:${(parser.address() as AddressInfo).port}`;

const database = await startTestDatabase();
const admin = createPrismaClient(createPool(database.connectionString));
const db = createPrismaClient(createPool(database.runtimeConnectionString));
const keys = createSourceKeys({ activeVersion: "eval", masters: { eval: Buffer.alloc(32, 7) } });
const sources = createSources({ db, keys, storage: {
  upload: async id => ({ url: `https://eval.invalid/eval/${id}`, headers: {}, expiresAt: new Date(Date.now() + 3_600_000) }),
  download: async (id, key) => ({ url: `https://eval.invalid/eval/${id}`, keyBase64: key.toString("base64"), etag: "eval" }),
  promote: async () => {}, remove: async () => {},
} });
const delegation = createDelegation({ db, aiEnabled: () => true });
// The floor is disabled here so every score is seen; recall and false positives are then computed per candidate floor.
const reader = createKnowledgeReader({ db, keys, embedder: { ...embedder, relevanceFloor: -1 }, delegation, clock: { now: () => new Date() } });
const chats = createChats({ db, keys, reader, delegation });
const limit = 10, ks = [1, 3, 5, 8] as const, candidates = [0.3, 0.4, 0.45, 0.5, 0.55, 0.6];
const unanswerable: { document: string; question: string; topScore: number }[] = [];

const round = (score: number) => Math.round(score * 1000) / 1000;
const results = [];
try {
  for (const labelled of labels.documents) {
    const source = set.documents.find(d => d.id === labelled.id)?.source;
    if (!source || !("url" in source)) throw new Error(`${labelled.id}: not a fetched document in the extraction set`);
    const studentId = randomUUID();
    await admin.user.create({ data: { id: studentId, email: `${studentId}@eval.invalid`, name: "Eval" } });
    await admin.pilotEntitlement.create({ data: { studentId } });
    await admin.allowance.create({ data: { studentId, limitMicroUsd: 5_000_000 } });
    const p = principal.fromSession({ studentId });
    const bytes = await bytesOf(labelled.id, source);
    const upload = await sources.upload(p, { title: `${labelled.id}.pdf`, bytes: bytes.length, type: "application/pdf" });
    if (upload.status !== "ok") throw new Error(`${labelled.id}: upload ${upload.reason}`);
    objects.set(upload.source.id, bytes);
    await sources.complete(p, upload.source.id);
    const ingestion = await sources.ingest(p, upload.source.id, { delegation, embedder, scans,
      parse: input => parseSource(parserHostport, input, AbortSignal.timeout(600_000)) });
    if (ingestion.status !== "ready") throw new Error(`${labelled.id}: ingestion ${ingestion.status}`);
    const chat = await chats.create(p, { courseIds: [], sourceIds: [upload.source.id] });
    if (chat.status !== "ok") throw new Error(`${labelled.id}: chat ${chat.status}`);
    for (const question of labelled.questions) {
      const retrieval = await reader.retrieve(p, { chatId: chat.id }, { kind: "passages", text: question.text, limit });
      if (retrieval.status !== "ok") throw new Error(`${labelled.id}: retrieval ${retrieval.status}`);
      const passages = retrieval.items.flatMap(item => item.kind === "passage" ? [item] : []);
      const hit = passages.findIndex(item => question.pages.includes(item.provenance.location.page));
      const result = { document: labelled.id, question: question.text, expected: question.pages,
        rank: hit + 1 || null, hitScore: hit < 0 ? null : round(passages[hit]!.score),
        pages: passages.map(item => item.provenance.location.page), scores: passages.map(item => round(item.score)) };
      console.log(JSON.stringify(result));
      results.push(result);
    }
    for (const text of labelled.unanswerable) {
      const retrieval = await reader.retrieve(p, { chatId: chat.id }, { kind: "passages", text, limit: 1 });
      if (retrieval.status !== "ok") throw new Error(`${labelled.id}: retrieval ${retrieval.status}`);
      const top = retrieval.items[0];
      unanswerable.push({ document: labelled.id, question: text, topScore: top?.kind === "passage" ? round(top.score) : 0 });
    }
  }
} finally {
  await new Promise<void>(resolve => parser.close(() => resolve()));
  await db.$disconnect(); await admin.$disconnect(); await database.stop();
}

const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : null);
/** Recall@k at a floor: the expected page is within k and its passage clears the floor. */
const recallAt = (k: number, floor: number) =>
  ratio(results.filter(r => r.rank !== null && r.rank <= k && r.hitScore! >= floor).length, results.length);
const report = {
  checkedAt: new Date().toISOString(), embeddingModel: embedder.model, relevanceFloor: embedder.relevanceFloor, limit,
  labels: "draft, pending founder spot-check",
  routing: provider.baseURL.includes("eu.openrouter") ? "eu" : "international",
  summary: {
    questions: results.length,
    unanswerable: unanswerable.length,
    /** At the model's configured floor. */
    ...Object.fromEntries(ks.map(k => [`recallAt${k}`, recallAt(k, embedder.relevanceFloor)])),
    /** Unanswerable questions that still return a passage at the configured floor. */
    falsePositiveRate: ratio(unanswerable.filter(u => u.topScore >= embedder.relevanceFloor).length, unanswerable.length),
    calibration: candidates.map(floor => ({ floor, recallAt8: recallAt(8, floor),
      falsePositiveRate: ratio(unanswerable.filter(u => u.topScore >= floor).length, unanswerable.length) })),
    missed: results.filter(r => r.rank === null).map(r => r.question),
  },
  questions: results,
  unanswerable,
};
await writeFile(new URL("../../../docs/operations/phase-7-retrieval-eval.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.summary, null, 2));
