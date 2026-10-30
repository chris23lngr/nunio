import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, type LanguageModel } from "ai";

/**
 * Claude models OpenRouter serves from zero-retention endpoints (spike f); Covered Models stay excluded.
 * Prices are OpenRouter's, in micro-USD per million tokens, as of 2026-10-31; update them when OpenRouter does.
 */
const allowlist = {
  "anthropic/claude-haiku-5.5": { input: 100_000, output: 500_000, upstream: ["Amazon Bedrock", "Google"] },
  "anthropic/claude-sonnet-5.5": { input: 2_000_000, output: 10_000_000, upstream: ["Amazon Bedrock", "Google"] },
  "anthropic/claude-opus-5.5": { input: 4_000_000, output: 20_000_000, upstream: ["Amazon Bedrock", "Google"] },
} as const;

export type ModelId = keyof typeof allowlist;

const maxOutputTokens = 8_000;

/** ADR-0011 starting defaults, each to be confirmed by evaluations before the pilot. */
const defaults = {
  extraction: "anthropic/claude-haiku-5.5",
  classification: "anthropic/claude-haiku-5.5",
  agent: "anthropic/claude-sonnet-5.5",
  explanation: "anthropic/claude-sonnet-5.5",
  feedback: "anthropic/claude-sonnet-5.5",
  planning: "anthropic/claude-opus-5.5",
} as const satisfies Record<string, ModelId>;

export type Task = keyof typeof defaults;

/** Where a model processes student data (ADR-0012); shown wherever a model is chosen or audited. */
export interface DataHandlingLabel {
  provider: "OpenRouter";
  /** The zero-retention upstream providers OpenRouter may route to. */
  upstream: readonly string[];
  /** International until EU routing is revisited before the pilot (ADR-0012 amendment). */
  routing: "international";
  zeroRetention: true;
}

export interface RegisteredModel {
  id: ModelId;
  label: DataHandlingLabel;
  model: LanguageModel;
  /**
   * Spread into every call. Retries are off: `meter` and Temporal own retrying, so a retry never runs
   * outside a fresh reservation. Callers still pass `meter`'s `abortSignal`.
   */
  callSettings: { maxOutputTokens: number; maxRetries: 0 };
  /** An upper bound for `meter`: the input plus the full output budget, rounded up to whole micro-USD. */
  estimateMicroUsd(inputTokens: number): number;
}

export interface Models {
  /** Throws for any ID outside the allowlist. */
  byId(id: string): RegisteredModel;
  forTask(task: Task): RegisteredModel;
}

export function createModels({ apiKey, baseURL, fetch }: {
  apiKey: string;
  baseURL: string;
  /** Lets a test see the exact request bodies sent to OpenRouter. */
  fetch?: typeof globalThis.fetch;
}): Models {
  const openrouter = createOpenRouter({ apiKey, baseURL, fetch });
  const isAllowed = (id: string): id is ModelId => Object.hasOwn(allowlist, id);
  const models: Models = {
    forTask: task => models.byId(defaults[task]),
    byId(id) {
      if (!isAllowed(id)) throw new Error(`Model ${JSON.stringify(id)} is not in the model allowlist`);
      return {
        id,
        label: { provider: "OpenRouter", upstream: [...allowlist[id].upstream], routing: "international", zeroRetention: true },
        model: openrouter.chat(id, { provider: { zdr: true, data_collection: "deny" } }),
        callSettings: { maxOutputTokens, maxRetries: 0 },
        estimateMicroUsd: inputTokens =>
          Math.ceil((inputTokens * allowlist[id].input + maxOutputTokens * allowlist[id].output) / 1_000_000),
      };
    },
  };
  return models;
}

/**
 * Whether a failed call certainly incurred no usage, so `meter` may release its reservation: the provider
 * answered with a 4xx rejection other than a timeout. Network failures and 5xx responses stay uncertain.
 */
export function isDefiniteFailure(error: unknown): boolean {
  if (!APICallError.isInstance(error) || error.statusCode === undefined) return false;
  return error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408;
}
