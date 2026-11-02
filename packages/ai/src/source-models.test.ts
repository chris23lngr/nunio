import { expect, it } from "vitest";
import { createEmbedder } from "./source-models.js";

it("embeds through a zero-retention request and reports its actual cost", async () => {
  const bodies: Record<string, unknown>[] = [];
  const embedder = createEmbedder({ apiKey: "test", baseURL: "https://provider.invalid", fetch: async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ data: [{ index: 0, embedding: Array(1024).fill(0.1) }], usage: { prompt_tokens: 10, total_tokens: 10, cost: 0.000001 } });
  } });
  const result = await embedder.embed(["Prüfung im März"], { signal: AbortSignal.timeout(1000) });
  expect(result.vectors[0]).toHaveLength(1024);
  expect(result.usage.microUsd).toBe(1);
  expect(bodies[0]).toMatchObject({ model: "baai/bge-m3", provider: { zdr: true, data_collection: "deny" } });
});
