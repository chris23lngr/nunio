// Phase 7 German retrieval eval (docs/design/knowledge-retrieval.md). Public handbook excerpts only.
// Runs the real read path: parser code in-process (host qpdf/Poppler), a throwaway Postgres, real ingestion and
// query embeddings through OpenRouter, and `retrieve` with its score floor. Build the workspace first, then from the repo root:
//   apps/worker/node_modules/.bin/tsx --env-file=packages/ai/.env.staging apps/worker/evals/retrieval.ts
import { writeFile } from "node:fs/promises";
import { createChats } from "@nunio/chat";
import { createFacts, createKnowledgeReader } from "@nunio/knowledge";
import { createPlan } from "@nunio/planning";
import { startRetrievalEval } from "./retrieval/documents.ts";

const { provider, embedder, db, keys, delegation, documents, close } =
  await startRetrievalEval();
// The floor is disabled here so every score is seen; recall and false positives are then computed per candidate floor.
const reader = createKnowledgeReader({
  db,
  keys,
  embedder: { ...embedder, relevanceFloor: -1 },
  delegation,
  clock: { now: () => new Date() },
});
const clock = { now: () => new Date() };
const plan = createPlan({ db, facts: createFacts({ db, keys, clock }), clock });
const chats = createChats({ db, keys, reader, delegation, plan, clock });
const limit = 10,
  ks = [1, 3, 5, 8] as const,
  candidates = [0.3, 0.4, 0.45, 0.5, 0.55, 0.6];
const unanswerable: { document: string; question: string; topScore: number }[] =
  [];

const round = (score: number) => Math.round(score * 1000) / 1000;
const results = [];
try {
  for (const labelled of documents) {
    const { p } = labelled;
    const chat = await chats.create(p, {
      courseIds: [],
      sourceIds: [labelled.sourceId],
    });
    if (chat.status !== "ok")
      throw new Error(`${labelled.id}: chat ${chat.status}`);
    for (const question of labelled.questions) {
      const retrieval = await reader.retrieve(
        p,
        { chatId: chat.id },
        { kind: "passages", text: question.text, limit },
      );
      if (retrieval.status !== "ok")
        throw new Error(`${labelled.id}: retrieval ${retrieval.status}`);
      const passages = retrieval.items.flatMap((item) =>
        item.kind === "passage" ? [item] : [],
      );
      const hit = passages.findIndex((item) =>
        question.pages.includes(item.provenance.location.page),
      );
      const result = {
        document: labelled.id,
        question: question.text,
        expected: question.pages,
        rank: hit + 1 || null,
        hitScore: hit < 0 ? null : round(passages[hit]!.score),
        pages: passages.map((item) => item.provenance.location.page),
        scores: passages.map((item) => round(item.score)),
      };
      console.log(JSON.stringify(result));
      results.push(result);
    }
    for (const text of labelled.unanswerable) {
      const retrieval = await reader.retrieve(
        p,
        { chatId: chat.id },
        { kind: "passages", text, limit: 1 },
      );
      if (retrieval.status !== "ok")
        throw new Error(`${labelled.id}: retrieval ${retrieval.status}`);
      const top = retrieval.items[0];
      unanswerable.push({
        document: labelled.id,
        question: text,
        topScore: top?.kind === "passage" ? round(top.score) : 0,
      });
    }
  }
} finally {
  await close();
}

const ratio = (a: number, b: number) =>
  b ? Math.round((a / b) * 1000) / 1000 : null;
/** Recall@k at a floor: the expected page is within k and its passage clears the floor. */
const recallAt = (k: number, floor: number) =>
  ratio(
    results.filter(
      (r) => r.rank !== null && r.rank <= k && r.hitScore! >= floor,
    ).length,
    results.length,
  );
const report = {
  checkedAt: new Date().toISOString(),
  embeddingModel: embedder.model,
  relevanceFloor: embedder.relevanceFloor,
  limit,
  labels: "draft, pending founder spot-check",
  routing: provider.baseURL.includes("eu.openrouter") ? "eu" : "international",
  summary: {
    questions: results.length,
    unanswerable: unanswerable.length,
    /** At the model's configured floor. */
    ...Object.fromEntries(
      ks.map((k) => [`recallAt${k}`, recallAt(k, embedder.relevanceFloor)]),
    ),
    /** Unanswerable questions that still return a passage at the configured floor. */
    falsePositiveRate: ratio(
      unanswerable.filter((u) => u.topScore >= embedder.relevanceFloor).length,
      unanswerable.length,
    ),
    calibration: candidates.map((floor) => ({
      floor,
      recallAt8: recallAt(8, floor),
      falsePositiveRate: ratio(
        unanswerable.filter((u) => u.topScore >= floor).length,
        unanswerable.length,
      ),
    })),
    missed: results.filter((r) => r.rank === null).map((r) => r.question),
  },
  questions: results,
  unanswerable,
};
await writeFile(
  new URL(
    "../../../docs/operations/phase-7-retrieval-eval.json",
    import.meta.url,
  ),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report.summary, null, 2));
