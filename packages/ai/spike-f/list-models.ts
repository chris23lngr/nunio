// Spike f: Claude and embedding models with zero-data-retention endpoints on OpenRouter, as a
// Markdown table for docs/operations/spike-results.md. Usage, from packages/ai:
//   set -a; . ./.env.staging; set +a; node spike-f/list-models.ts
const api = "https://openrouter.ai/api/v1";
const headers = { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` };

interface ZdrEndpoint {
  model_id: string;
  provider_name: string;
  supported_parameters?: string[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${api}${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return ((await res.json()) as { data: T }).data;
}

// Covered Models stay excluded whatever their retention (ADR-0012).
const covered = /fable|mythos/i;

const zdr = await get<ZdrEndpoint[]>("/endpoints/zdr");
const embeddingIds = new Set((await get<{ id: string }[]>("/embeddings/models")).map((m) => m.id));

const byModel = new Map<string, { providers: Set<string>; structured: boolean }>();
for (const endpoint of zdr) {
  const isClaude = endpoint.model_id.startsWith("anthropic/");
  if (!(isClaude || embeddingIds.has(endpoint.model_id)) || covered.test(endpoint.model_id)) continue;
  const entry = byModel.get(endpoint.model_id) ?? { providers: new Set(), structured: false };
  entry.providers.add(endpoint.provider_name);
  entry.structured ||= Boolean(endpoint.supported_parameters?.includes("structured_outputs"));
  byModel.set(endpoint.model_id, entry);
}

console.log(`Zero-retention endpoints on OpenRouter, ${new Date().toISOString().slice(0, 10)}:\n`);
console.log("| Model | Kind | ZDR providers | `structured_outputs` |");
console.log("| --- | --- | --- | --- |");
for (const [id, { providers, structured }] of [...byModel].sort(([a], [b]) => a.localeCompare(b))) {
  const kind = embeddingIds.has(id) ? "embedding" : "chat";
  console.log(`| \`${id}\` | ${kind} | ${[...providers].sort().join(", ")} | ${kind === "chat" ? (structured ? "yes" : "no") : "–"} |`);
}
