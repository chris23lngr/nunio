// Re-judges a recorded report's Topics with the current judge, without extracting again:
//   apps/worker/node_modules/.bin/tsx --env-file=… apps/worker/evals/extraction/rejudge.ts in.json out.json
// Needs OPENROUTER_API_KEY and OPENROUTER_BASE_URL; spends only the judge calls (Sonnet 5.5).
import { readFile, writeFile } from "node:fs/promises";
import {
  createModels,
  createTopicJudge,
  fetchZeroRetentionPrices,
} from "@nunio/ai";
import type { ExtractedTopic, Judgement, TopicLabel } from "./topics.js";
import { parseJudgement, scoreTopics } from "./topics.js";

const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Usage: rejudge.ts report.json out.json");
const provider = {
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  baseURL: process.env.OPENROUTER_BASE_URL ?? "",
};
if (!provider.apiKey || !provider.baseURL)
  throw new Error("OPENROUTER_API_KEY and OPENROUTER_BASE_URL are required");
const sonnet = (
  await fetchZeroRetentionPrices({ baseURL: provider.baseURL })
).get("anthropic/claude-sonnet-5.5")!;
const judge = createTopicJudge(
  createModels({ ...provider, catalog: [] }).fromConfig({
    key: "sonnet-5.5-topic-judge",
    providerModelId: sonnet.providerModelId,
    reasoningEffort: "low",
    maxOutputTokens: 8_000,
    prices: sonnet.prices,
    upstream: sonnet.upstream,
  }),
);
const report = JSON.parse(await readFile(input, "utf8")) as {
  documents: {
    id: string;
    topics: unknown;
    topicJudgement?: {
      labels: TopicLabel[];
      extracted: ExtractedTopic[];
      decisions: Judgement | null;
      failure?: string | null;
      costMicroUsd: number;
    };
  }[];
};
let costMicroUsd = 0;
for (const document of report.documents) {
  const recorded = document.topicJudgement;
  if (!recorded?.decisions || !recorded.extracted.length) continue;
  const { labels, extracted } = recorded;
  const response = await judge.judge(
    { labels, extracted },
    { signal: AbortSignal.timeout(300_000) },
  );
  costMicroUsd += response.usage.microUsd;
  const decisions = parseJudgement(response.value, labels, extracted);
  document.topicJudgement = {
    ...recorded,
    decisions,
    costMicroUsd: response.usage.microUsd,
  };
  document.topics = scoreTopics(labels, extracted, decisions);
}
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Re-judged for USD ${(costMicroUsd / 1e6).toFixed(4)}`);
