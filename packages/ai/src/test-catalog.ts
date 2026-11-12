import type { ModelConfig } from "./models.js";

/** Test-only Model Catalog rows for the task defaults, at OpenRouter's 2026-10-31 base prices. */
function row(
  key: string,
  providerModelId: string,
  input: number,
  output: number,
): ModelConfig {
  return {
    key,
    providerModelId,
    reasoningEffort: "high",
    maxOutputTokens: 8_000,
    prices: [
      {
        minPromptTokens: 0,
        inputMicroUsdPerMTok: input,
        outputMicroUsdPerMTok: output,
      },
    ],
    upstream: ["Amazon Bedrock", "Google"],
  };
}

export const haiku = row(
  "haiku-5.5-reasoning-high",
  "anthropic/claude-haiku-5.5",
  100_000,
  500_000,
);
export const sonnet = row(
  "sonnet-5.5-reasoning-high",
  "anthropic/claude-sonnet-5.5",
  2_000_000,
  10_000_000,
);
export const opus = row(
  "opus-5.5-reasoning-high",
  "anthropic/claude-opus-5.5",
  4_000_000,
  20_000_000,
);

export const testCatalog: readonly ModelConfig[] = [haiku, sonnet, opus];
