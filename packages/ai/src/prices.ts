/** A price band: what a call costs once its prompt reaches `minPromptTokens`. */
export interface PriceTier {
  minPromptTokens: number;
  inputMicroUsdPerMTok: number;
  outputMicroUsdPerMTok: number;
}

/** A model's prices and upstream providers across all of OpenRouter's zero-retention endpoints for it. */
export interface SyncedModel {
  providerModelId: string;
  /** Ascending by `minPromptTokens`; the first tier starts at 0. */
  prices: PriceTier[];
  /** The providers serving its zero-retention endpoints, unique and sorted. */
  upstream: string[];
}

/** Covered Models require 30-day retention, so they stay excluded (ADR-0011, ADR-0012). */
export function isCoveredModel(providerModelId: string): boolean {
  return /(^|\/)claude-(fable|mythos)(-|$)/.test(providerModelId);
}

/**
 * Turns OpenRouter's `GET /endpoints/zdr` response into prices per model, Covered Models excluded. Each
 * tier takes the highest price any endpoint charges at that prompt length, so `meter`'s estimate stays an
 * upper bound wherever OpenRouter routes. Throws on a response it does not recognize rather than syncing
 * a wrong price.
 */
export function priceZeroRetentionEndpoints(
  response: unknown,
  /** The models to read; the rest of OpenRouter's list is ignored, however it is shaped. */
  only?: ReadonlySet<string>,
): Map<string, SyncedModel> {
  const data = (response as { data?: unknown } | null)?.data;
  if (!Array.isArray(data))
    throw new Error("Expected OpenRouter's zero-retention endpoints as {data}");
  const endpointsByModel = new Map<
    string,
    { provider: string; tiers: PriceTier[] }[]
  >();
  for (const endpoint of data as unknown[]) {
    const { model_id: model, provider_name: provider } = (endpoint ??
      {}) as Record<string, unknown>;
    if (typeof model !== "string" || typeof provider !== "string")
      throw new Error(
        `Malformed zero-retention endpoint ${JSON.stringify(endpoint)}`,
      );
    if (isCoveredModel(model) || (only && !only.has(model))) continue;
    const endpoints = endpointsByModel.get(model) ?? [];
    endpoints.push({ provider, tiers: endpointTiers(endpoint, model) });
    endpointsByModel.set(model, endpoints);
  }
  return new Map(
    [...endpointsByModel].map(([providerModelId, endpoints]) => {
      const starts = [
        ...new Set(
          endpoints.flatMap((e) => e.tiers.map((t) => t.minPromptTokens)),
        ),
      ].sort((a, b) => a - b);
      // An endpoint without a tier at some prompt length keeps charging its lower tier's price there.
      const prices = starts.map((minPromptTokens) => {
        const charged = endpoints.map((e) => tierAt(e.tiers, minPromptTokens));
        return {
          minPromptTokens,
          inputMicroUsdPerMTok: Math.max(
            ...charged.map((t) => t.inputMicroUsdPerMTok),
          ),
          outputMicroUsdPerMTok: Math.max(
            ...charged.map((t) => t.outputMicroUsdPerMTok),
          ),
        };
      });
      const upstream = [...new Set(endpoints.map((e) => e.provider))].sort();
      return [providerModelId, { providerModelId, prices, upstream }];
    }),
  );
}

/** Fetches and prices OpenRouter's zero-retention endpoints; the endpoint list needs no API key. */
export async function fetchZeroRetentionPrices({
  baseURL,
  fetch = globalThis.fetch,
  signal,
  only,
}: {
  baseURL: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
  /** See `priceZeroRetentionEndpoints`. */
  only?: ReadonlySet<string>;
}): Promise<Map<string, SyncedModel>> {
  const url = `${baseURL.replace(/\/+$/, "")}/endpoints/zdr`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`GET ${url} answered ${response.status}`);
  return priceZeroRetentionEndpoints(await response.json(), only);
}

/** The highest tier whose `minPromptTokens` a prompt of `promptTokens` reaches. */
export function tierAt(
  tiers: readonly PriceTier[],
  promptTokens: number,
): PriceTier {
  const tier = tiers.findLast((t) => t.minPromptTokens <= promptTokens);
  if (!tier) throw new Error("No price tier starts at 0 prompt tokens");
  return tier;
}

/** One endpoint's base price plus its long-context overrides, ascending. */
function endpointTiers(endpoint: unknown, model: string): PriceTier[] {
  const { pricing } = endpoint as {
    pricing?: { prompt?: unknown; completion?: unknown; overrides?: unknown };
  };
  const overrides = pricing?.overrides ?? [];
  if (!Array.isArray(overrides))
    throw new Error(`Malformed price overrides for ${model}`);
  const base: PriceTier = {
    minPromptTokens: 0,
    inputMicroUsdPerMTok: microUsdPerMTok(pricing?.prompt, model),
    outputMicroUsdPerMTok: microUsdPerMTok(pricing?.completion, model),
  };
  const tiers: PriceTier[] = [];
  /** Overrides with another condition, such as a time of day, may apply at any moment. */
  const anytime: PriceTier[] = [];
  for (const override of overrides as unknown[]) {
    const { min_prompt_tokens, prompt, completion } = (override ??
      {}) as Record<string, unknown>;
    const price = {
      inputMicroUsdPerMTok: microUsdPerMTok(prompt, model),
      outputMicroUsdPerMTok: microUsdPerMTok(completion, model),
    };
    if (min_prompt_tokens === undefined) {
      anytime.push({ minPromptTokens: 0, ...price });
      continue;
    }
    if (
      typeof min_prompt_tokens !== "number" ||
      !Number.isInteger(min_prompt_tokens) ||
      min_prompt_tokens <= 0
    )
      throw new Error(`Malformed price override for ${model}`);
    tiers.push({ minPromptTokens: min_prompt_tokens, ...price });
  }
  return [base, ...tiers]
    .sort((a, b) => a.minPromptTokens - b.minPromptTokens)
    .map((tier) => ({
      minPromptTokens: tier.minPromptTokens,
      inputMicroUsdPerMTok: Math.max(
        tier.inputMicroUsdPerMTok,
        ...anytime.map((t) => t.inputMicroUsdPerMTok),
      ),
      outputMicroUsdPerMTok: Math.max(
        tier.outputMicroUsdPerMTok,
        ...anytime.map((t) => t.outputMicroUsdPerMTok),
      ),
    }));
}

/** USD per token, as OpenRouter's decimal string, to whole micro-USD per million tokens, rounded up. */
function microUsdPerMTok(price: unknown, model: string): number {
  const usd =
    typeof price === "string" && price.trim() !== ""
      ? Number(price)
      : Number.NaN;
  if (!Number.isFinite(usd) || usd < 0)
    throw new Error(`Malformed price ${JSON.stringify(price)} for ${model}`);
  // toPrecision drops float noise such as 0.0000022 * 1e12 = 2200000.0000000005 before rounding up.
  return Math.ceil(Number((usd * 1e12).toPrecision(12)));
}
