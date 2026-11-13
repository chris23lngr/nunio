// Phase 14 Chat search eval (ADR-0019). Public handbook excerpts only.
// Asks the retrieval eval's questions, each in a fresh Chat, through the real tool loop and the Chat default Model,
// so the model chooses whether and what to search. Measures how often it answers a question about the material
// without searching, whether its searches reach the expected page, and whether it cites it. Build the workspace
// first, then from the repo root:
//   apps/worker/node_modules/.bin/tsx --env-file=packages/ai/.env.staging apps/worker/evals/chat-search.ts
import { writeFile } from "node:fs/promises";
import { createAnswerer, createModels } from "@nunio/ai";
import { createChats } from "@nunio/chat";
import type { KnowledgeReader } from "@nunio/knowledge";
import { createFacts, createKnowledgeReader } from "@nunio/knowledge";
import { createPlan } from "@nunio/planning";
import type { EvalDocument } from "./retrieval/documents.ts";
import { startRetrievalEval } from "./retrieval/documents.ts";

const chatModel = {
  key: "sonnet-5.5-reasoning-high",
  providerModelId: "anthropic/claude-sonnet-5.5",
  reasoningEffort: "high" as const,
  maxOutputTokens: 8_000,
};
const concurrency = 4;

const { provider, catalog, embedder, db, keys, delegation, documents, close } =
  await startRetrievalEval([chatModel]);
const reader = createKnowledgeReader({
  db,
  keys,
  embedder,
  delegation,
  clock: { now: () => new Date() },
});
/** The pages each search returned, per Chat, as the model was given them. */
const found = new Map<string, number[][]>();
const watched: KnowledgeReader = {
  ...reader,
  async retrieve(p, scope, query) {
    const retrieval = await reader.retrieve(p, scope, query);
    if (retrieval.status === "ok" && "chatId" in scope)
      found.set(scope.chatId, [
        ...(found.get(scope.chatId) ?? []),
        retrieval.items.flatMap((item) =>
          item.kind === "passage" ? [item.provenance.location.page] : [],
        ),
      ]);
    return retrieval;
  },
};
const clock = { now: () => new Date() };
const plan = createPlan({ db, facts: createFacts({ db, keys, clock }), clock });
const chats = createChats({
  db,
  keys,
  reader: watched,
  delegation,
  plan,
  clock,
  // The evals measure answers, so a Chat starts no Artifact here.
  artifacts: { request: async () => ({ status: "refused", reason: "gone" }) },
  startArtifactRun: async () => {},
});
const answerer = createAnswerer(
  createModels({ ...provider, catalog }).fromConfig(
    catalog.find((row) => row.key === chatModel.key)!,
  ),
);

/** Asks `text` in a new Chat over the document, as a student would. */
async function ask(document: EvalDocument, text: string) {
  const chat = await chats.create(document.p, {
    courseIds: [],
    sourceIds: [document.sourceId],
  });
  if (chat.status !== "ok")
    throw new Error(`${document.id}: chat ${chat.status}`);
  const used = async () =>
    (await delegation.allowance(document.p)).usedMicroUsd;
  const before = await used();
  const result = await chats
    .ask(document.p, chat.id, text, answerer)
    .catch((error: unknown) => ({
      status: "failed" as const,
      error: String(error),
    }));
  const costMicroUsd = (await used()) - before;
  if (result.status !== "ok")
    return {
      error: "error" in result ? result.error : JSON.stringify(result),
      costMicroUsd,
    };
  return {
    searches: result.message.parts.flatMap((part) =>
      part.type === "tool-searchMaterial" ? [part.input.query] : [],
    ),
    foundPages: found.get(chat.id) ?? [],
    citedPages: [
      ...new Set(
        result.message.citations.flatMap(({ provenance }) =>
          provenance !== "gone" && provenance.kind === "source"
            ? [provenance.location.page]
            : [],
        ),
      ),
    ],
    answer: result.message.text,
    costMicroUsd,
  };
}

/** Runs `work` over `items`, `concurrency` at a time, keeping their order. */
async function pooled<T, R>(items: T[], work: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]!);
        console.log(JSON.stringify(results[index]));
      }
    }),
  );
  return results;
}

const [answerable, unanswerable] = await (async () => {
  try {
    const answerable = await pooled(
      documents.flatMap((document) =>
        document.questions.map((question) => ({ document, question })),
      ),
      async ({ document, question }) => {
        const asked = await ask(document, question.text);
        return {
          document: document.id,
          question: question.text,
          expected: question.pages,
          ...asked,
          ...("error" in asked
            ? {}
            : {
                foundExpected: asked.foundPages.some((pages) =>
                  pages.some((page) => question.pages.includes(page)),
                ),
                citesExpected: asked.citedPages.some((page) =>
                  question.pages.includes(page),
                ),
              }),
        };
      },
    );
    const unanswerable = await pooled(
      documents.flatMap((document) =>
        document.unanswerable.map((text) => ({ document, text })),
      ),
      async ({ document, text }) => ({
        document: document.id,
        question: text,
        ...(await ask(document, text)),
      }),
    );
    return [answerable, unanswerable] as const;
  } finally {
    await close();
  }
})();

const ratio = (a: number, b: number) =>
  b ? Math.round((a / b) * 1000) / 1000 : null;
const answered = answerable.filter((r) => !("error" in r));
const declined = unanswerable.filter((r) => !("error" in r));
const searchCount = (r: { searches?: string[] }) => r.searches?.length ?? 0;
const cost = [...answerable, ...unanswerable].reduce(
  (sum, r) => sum + r.costMicroUsd,
  0,
);
const report = {
  checkedAt: new Date().toISOString(),
  chatModel: chatModel.key,
  embeddingModel: embedder.model,
  relevanceFloor: embedder.relevanceFloor,
  labels: "draft, pending founder spot-check",
  routing: provider.baseURL.includes("eu.openrouter") ? "eu" : "international",
  summary: {
    questions: answerable.length,
    unanswerable: unanswerable.length,
    failed:
      answerable.length -
      answered.length +
      (unanswerable.length - declined.length),
    /** Questions about the material the model answered without searching: should be near zero. */
    answeredWithoutSearch: ratio(
      answered.filter((r) => searchCount(r) === 0).length,
      answered.length,
    ),
    /** One of the model's searches returned a passage on the expected page. */
    searchRecall: ratio(
      answered.filter((r) => r.foundExpected).length,
      answered.length,
    ),
    /** The answer cites a passage on the expected page. */
    citationRecall: ratio(
      answered.filter((r) => r.citesExpected).length,
      answered.length,
    ),
    averageSearches: ratio(
      answered.reduce((sum, r) => sum + searchCount(r), 0),
      answered.length,
    ),
    /** Unanswerable questions answered without any Citation, as a proxy for saying the material does not say. */
    unanswerableWithoutCitation: ratio(
      declined.filter((r) => !r.citedPages?.length).length,
      declined.length,
    ),
    costMicroUsd: cost,
    missed: answered.filter((r) => !r.foundExpected).map((r) => r.question),
  },
  questions: answerable,
  unanswerable,
};
await writeFile(
  new URL(
    "../../../docs/operations/phase-14-chat-search-eval.json",
    import.meta.url,
  ),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report.summary, null, 2));
