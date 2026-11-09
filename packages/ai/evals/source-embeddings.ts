// Synthetic material only. Run from repo root:
// node --env-file=packages/ai/.env.staging packages/ai/evals/source-embeddings.ts
import { writeFile } from "node:fs/promises";

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
const base = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
const headers = {
  Authorization: `Bearer ${apiKey}`,
  "content-type": "application/json",
};
const passages = [
  "Analysis I: Die schriftliche Prüfung findet am 12. März um 9 Uhr in Raum H1 statt.",
  "Biologie: Das Laborprotokoll zur Photosynthese ist bis zum 20. Februar einzureichen.",
  "Informatik: Jede Woche muss ein Programmierblatt abgegeben werden; sechs bestandene Blätter sind Voraussetzung für die Klausur.",
  "Geschichte: Die Hausarbeit hat einen Umfang von 15 Seiten; Abgabe am 30. September.",
  "Physics: The laboratory report on optics is due on 15 June. Submit a PDF through the course portal.",
  "Economics: The oral examination lasts twenty minutes and accounts for the entire course grade.",
  "Chemistry: Safety training must be completed before the first laboratory session.",
  "Literature: Students present a ten-minute analysis of a poem in the final seminar.",
];
const questions = [
  "Wann und wo ist die Analysis-Klausur?",
  "Bis wann muss ich das Photosynthese-Protokoll abgeben?",
  "Wie viele Programmierblätter brauche ich für die Klausurzulassung?",
  "Wie lang ist die Geschichts-Hausarbeit und wann ist Abgabe?",
  "When is the optics report due and how do I submit it?",
  "How long is the economics exam and how is it weighted?",
  "What must I do before attending the chemistry lab?",
  "What presentation is required in the literature seminar?",
  "Where is the calculus exam and what time does it start?",
  "Wann ist der Physik-Laborbericht fällig?",
];
const expected = [0, 1, 2, 3, 4, 5, 6, 7, 0, 4];
const get = async (path: string) => {
  const res = await fetch(`${base}${path}`, { headers });
  if (!res.ok) throw new Error(`Catalog check failed (${res.status})`);
  return (await res.json()) as { data: Record<string, unknown>[] };
};
const catalog = (await get("/embeddings/models")).data;
const zdr = (await get("/endpoints/zdr")).data;
const scores = [];
for (const model of ["baai/bge-m3", "amazon/titan-embed-text-v2"]) {
  const card = catalog.find((row) => row.id === model);
  const endpoints = zdr.filter((row) => row.model_id === model);
  if (!card || card.expiration_date || !endpoints.length) {
    scores.push({ model, available: false });
    continue;
  }
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      input: [...passages, ...questions],
      encoding_format: "float",
      provider: { zdr: true, data_collection: "deny" },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    scores.push({ model, available: false, status: res.status });
    continue;
  }
  const data = (await res.json()) as {
    data: { index: number; embedding: number[] }[];
    usage: unknown;
  };
  const vectors = data.data
    .sort((a, b) => a.index - b.index)
    .map((row) => row.embedding);
  const cosine = (a: number[], b: number[]) =>
    a.reduce((sum, n, i) => sum + n * b[i]!, 0) /
    (Math.hypot(...a) * Math.hypot(...b));
  const ranks = questions.map(
    (_q, index) =>
      passages
        .map((_p, p) => ({
          p,
          score: cosine(vectors[index + passages.length]!, vectors[p]!),
        }))
        .sort((a, b) => b.score - a.score)
        .findIndex((row) => row.p === expected[index]) + 1,
  );
  scores.push({
    model,
    available: true,
    dimensions: vectors[0]!.length,
    queryCount: questions.length,
    recallAt1: ranks.filter((r) => r === 1).length / ranks.length,
    recallAt3: ranks.filter((r) => r <= 3).length / ranks.length,
    ranks,
    pricing: card.pricing,
    expirationDate: card.expiration_date ?? null,
    zdrProviders: endpoints.map((row) => row.provider_name),
    usage: data.usage,
  });
}
const result = {
  checkedAt: new Date().toISOString(),
  synthetic: true,
  routing: base.includes("eu.openrouter") ? "eu" : "international",
  limitations:
    "Ten synthetic questions over eight short passages; pilot thresholds and representative syllabi still need founder evaluation.",
  scores,
};
await writeFile(
  new URL(
    "../../../docs/operations/phase-5-embedding-eval.json",
    import.meta.url,
  ),
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result, null, 2));
