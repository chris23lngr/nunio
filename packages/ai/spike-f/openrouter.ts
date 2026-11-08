// Spike f (docs/operations/spike-results.md): OpenRouter models from the environment. International
// routing for now (ADR-0012 amendment); every request is restricted to zero-retention endpoints.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { EmbeddingModel, LanguageModel } from "ai";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (packages/ai/.env.staging)`);
  return value;
}

/** `fetch` lets a test see the exact request bodies sent to OpenRouter. */
export function spikeModels({
  fetch,
}: {
  fetch?: typeof globalThis.fetch;
} = {}): {
  chat: LanguageModel;
  embedding: EmbeddingModel;
} {
  const openrouter = createOpenRouter({
    apiKey: required("OPENROUTER_API_KEY"),
    baseURL: required("OPENROUTER_BASE_URL"),
    fetch,
  });
  const routing = { provider: { zdr: true, data_collection: "deny" as const } };
  return {
    chat: openrouter.chat(required("OPENROUTER_CHAT_MODEL"), routing),
    embedding: openrouter.textEmbeddingModel(
      required("OPENROUTER_EMBEDDING_MODEL"),
      routing,
    ),
  };
}
