import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel, LanguageModelUsage, ProviderMetadata } from "ai";
import { APICallError } from "ai";
import type { PriceTier } from "./prices.js";
import { isCoveredModel, tierAt } from "./prices.js";

/**
 * Models come from the Model Catalog, which the database owns: each row is one Model, an exact, immutable
 * call configuration (provider model, reasoning effort, output budget) under a neutral key such as
 * `sonnet-5.5-reasoning-high`, with the prices and upstreams last synced from OpenRouter's zero-retention
 * endpoints (`fetchZeroRetentionPrices`). This package stays database-free: callers pass the rows in.
 * Covered Models stay excluded (ADR-0011, ADR-0012).
 */

export type ReasoningEffort = "low" | "medium" | "high";

/** One Model Catalog row. */
export interface ModelConfig {
  key: string;
  /** The OpenRouter model ID, such as `anthropic/claude-sonnet-5.5`. */
  providerModelId: string;
  reasoningEffort: ReasoningEffort;
  maxOutputTokens: number;
  /** Ascending by `minPromptTokens`; the first tier starts at 0. */
  prices: readonly PriceTier[];
  upstream: readonly string[];
}

/** Haiku 5.5 spends most of an 8k budget on reasoning over a long window, truncating the structured answer. */
/** A page's transcription and figure lines stay well below 8k tokens, so a scan reserves far less than extraction. */
const taskOutputTokens: Partial<Record<Task, number>> = {
  extraction: 32_000,
  scan: 8_000,
};
/** Generous per-text allowance for role markers and message framing around the text's own tokens. */
const framingTokens = 200;
const encoder = new TextEncoder();

/** ADR-0011 starting defaults, as Model Catalog keys, each to be confirmed by evaluations before the pilot. */
export const taskModels = {
  extraction: "haiku-5.5-reasoning-high",
  scan: "haiku-5.5-reasoning-high",
  classification: "haiku-5.5-reasoning-high",
  estimation: "haiku-5.5-reasoning-high",
  agent: "sonnet-5.5-reasoning-high",
  explanation: "sonnet-5.5-reasoning-high",
  feedback: "sonnet-5.5-reasoning-high",
  planning: "opus-5.5-reasoning-high",
} as const satisfies Record<string, string>;

export type Task = keyof typeof taskModels;

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
  /** The Model Catalog key. */
  key: string;
  label: DataHandlingLabel;
  model: LanguageModel;
  /**
   * Spread into every call. Retries are off: `meter` and Temporal own retrying, so a retry never runs
   * outside a fresh reservation. Callers still pass `meter`'s `abortSignal`.
   */
  callSettings: { maxOutputTokens: number; maxRetries: 0 };
  /**
   * An upper bound for `meter`, rounded up to whole micro-USD. Pass every text the request sends: system
   * prompt, messages, and any output schema. A token covers at least one UTF-8 byte, so each text's byte
   * length plus a framing allowance bounds its tokens; the full output budget is added on top, all at the
   * price tier that input bound reaches. Text only.
   */
  estimateMicroUsd(texts: readonly string[]): number;
  /**
   * What a finished call cost, for `meter` to settle: OpenRouter's reported cost, or its token counts at
   * the catalog's prices, at the tier its input tokens reach, when no cost was reported. Rounded up to
   * whole micro-USD.
   */
  actualMicroUsd(result: {
    usage: LanguageModelUsage;
    providerMetadata?: ProviderMetadata;
  }): number;
}

export interface Models {
  /** The Model a catalog row describes, as chosen per request (Chat). */
  fromConfig(config: ModelConfig): RegisteredModel;
  /** The catalog's Model for a task's default key. Throws when the catalog lacks it. */
  forTask(task: Task): RegisteredModel;
}

export function createModels({
  apiKey,
  baseURL,
  fetch,
  catalog,
}: {
  apiKey: string;
  baseURL: string;
  /** Lets a test see the exact request bodies sent to OpenRouter. */
  fetch?: typeof globalThis.fetch;
  /** The Model Catalog's rows, for the task defaults. */
  catalog: readonly ModelConfig[];
}): Models {
  catalog.forEach(refuseCoveredModel);
  const openrouter = createOpenRouter({ apiKey, baseURL, fetch });
  function modelFor(
    config: ModelConfig,
    outputTokens: number,
    /** Chat calls tools, so it is routed only to endpoints that support them (ADR-0018 amendment). */
    { chat = false } = {},
  ): RegisteredModel {
    refuseCoveredModel(config);
    const cost = (inputTokens: number, outputTokens: number) => {
      const tier = tierAt(config.prices, inputTokens);
      return Math.ceil(
        (inputTokens * tier.inputMicroUsdPerMTok +
          outputTokens * tier.outputMicroUsdPerMTok) /
          1_000_000,
      );
    };
    return {
      key: config.key,
      label: {
        provider: "OpenRouter",
        upstream: [...config.upstream],
        routing: "international",
        zeroRetention: true,
      },
      model: openrouter.chat(config.providerModelId, {
        provider: {
          zdr: true,
          data_collection: "deny",
          ...(chat ? { require_parameters: true } : {}),
        },
        reasoning: { effort: config.reasoningEffort },
        usage: { include: true },
      }),
      callSettings: { maxOutputTokens: outputTokens, maxRetries: 0 },
      estimateMicroUsd(texts) {
        const inputTokens = texts.reduce(
          (sum, text) => sum + encoder.encode(text).byteLength + framingTokens,
          0,
        );
        return cost(inputTokens, outputTokens);
      },
      actualMicroUsd({ usage, providerMetadata }) {
        const reported = (
          providerMetadata?.openrouter?.usage as { cost?: unknown } | undefined
        )?.cost;
        // toPrecision drops float noise such as 0.000123 * 1e6 = 123.00000000000001 before rounding up.
        if (typeof reported === "number")
          return Math.ceil(Number((reported * 1_000_000).toPrecision(12)));
        return cost(usage.inputTokens ?? 0, usage.outputTokens ?? 0);
      },
    };
  }
  return {
    fromConfig: (config) =>
      modelFor(config, config.maxOutputTokens, { chat: true }),
    forTask(task) {
      const config = catalog.find((c) => c.key === taskModels[task]);
      if (!config)
        throw new Error(
          `The Model Catalog has no model ${JSON.stringify(taskModels[task])} for the ${task} task`,
        );
      return modelFor(config, taskOutputTokens[task] ?? config.maxOutputTokens);
    },
  };
}

/** Covered Models require 30-day retention (ADR-0011, ADR-0012), whatever the catalog says. */
function refuseCoveredModel(config: ModelConfig): void {
  if (isCoveredModel(config.providerModelId))
    throw new Error(
      `Model ${JSON.stringify(config.key)} is a Covered Model (${config.providerModelId}), which stays excluded`,
    );
}

/**
 * Whether a failed call certainly incurred no usage, so `meter` may release its reservation: the provider
 * answered with a 4xx rejection other than a timeout. Network failures and 5xx responses stay uncertain.
 */
export function isDefiniteFailure(error: unknown): boolean {
  if (!APICallError.isInstance(error) || error.statusCode === undefined)
    return false;
  return (
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    error.statusCode !== 408
  );
}

/**
 * Whether a failed call is worth another, separately metered attempt: a rate limit (429), a timeout (408),
 * a provider error (5xx), or no answer at all (a lost connection or an aborted wait). Other 4xx are final.
 */
export function isTransientFailure(error: unknown): boolean {
  if (APICallError.isInstance(error) && error.statusCode !== undefined)
    return (
      error.statusCode === 429 ||
      error.statusCode === 408 ||
      error.statusCode >= 500
    );
  return true;
}
