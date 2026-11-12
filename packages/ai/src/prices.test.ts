import { describe, expect, it } from "vitest";
import zdr from "./fixtures/zdr-endpoints.json" with { type: "json" };
import {
  fetchZeroRetentionPrices,
  isCoveredModel,
  priceZeroRetentionEndpoints,
} from "./index.js";

describe("pricing OpenRouter's zero-retention endpoints", () => {
  it("prices each model at its most expensive endpoint, in micro-USD per million tokens", () => {
    // Sonnet costs $2 / $10 on two endpoints and $2.20 / $11 on the regional ones.
    expect(
      priceZeroRetentionEndpoints(zdr).get("anthropic/claude-sonnet-5.5"),
    ).toEqual({
      providerModelId: "anthropic/claude-sonnet-5.5",
      prices: [
        {
          minPromptTokens: 0,
          inputMicroUsdPerMTok: 2_200_000,
          outputMicroUsdPerMTok: 11_000_000,
        },
      ],
      upstream: ["Amazon Bedrock", "Google"],
    });
  });

  it("adds a long-context tier, priced at the most expensive endpoint's surcharge", () => {
    // Haiku: $0.11 / $0.55 regionally (vs $0.10 / $0.50 global), $0.55 / $2.75 from 100k prompt tokens.
    expect(
      priceZeroRetentionEndpoints(zdr).get("anthropic/claude-haiku-5.5")
        ?.prices,
    ).toEqual([
      {
        minPromptTokens: 0,
        inputMicroUsdPerMTok: 110_000,
        outputMicroUsdPerMTok: 550_000,
      },
      {
        minPromptTokens: 100_000,
        inputMicroUsdPerMTok: 550_000,
        outputMicroUsdPerMTok: 2_750_000,
      },
    ]);
  });

  it("keeps an endpoint without a long-context tier at its base price there", () => {
    const prices = priceZeroRetentionEndpoints({
      data: [
        endpoint("vendor/model", "A", "0.000001", "0.000005", [
          {
            min_prompt_tokens: 100_000,
            prompt: "0.000002",
            completion: "0.00001",
          },
        ]),
        endpoint("vendor/model", "B", "0.000003", "0.000015"),
      ],
    }).get("vendor/model")?.prices;

    expect(prices).toEqual([
      {
        minPromptTokens: 0,
        inputMicroUsdPerMTok: 3_000_000,
        outputMicroUsdPerMTok: 15_000_000,
      },
      {
        minPromptTokens: 100_000,
        inputMicroUsdPerMTok: 3_000_000,
        outputMicroUsdPerMTok: 15_000_000,
      },
    ]);
  });

  it("knows no price for a model without a zero-retention endpoint", () => {
    const prices = priceZeroRetentionEndpoints(zdr);

    expect(prices.has("anthropic/claude-haiku-4.5")).toBe(false);
    expect([...prices.keys()].sort()).toEqual([
      "anthropic/claude-haiku-5.5",
      "anthropic/claude-opus-5.5",
      "anthropic/claude-sonnet-5.5",
    ]);
  });

  it("drops Covered Models, which require 30-day retention", () => {
    expect(
      priceZeroRetentionEndpoints(zdr).has("anthropic/claude-fable-5-1"),
    ).toBe(false);
  });

  it.each([
    ["anthropic/claude-fable-5-1", true],
    ["anthropic/claude-mythos-5", true],
    ["anthropic/claude-sonnet-5.5", false],
    ["vendor/not-claude-fable", false],
  ])("treats %s as a Covered Model: %s", (id, covered) => {
    expect(isCoveredModel(id)).toBe(covered);
  });

  it.each([
    ["no data array", { endpoints: [] }],
    ["a null response", null],
    [
      "a non-numeric price",
      { data: [endpoint("vendor/model", "A", "free", "0.000005")] },
    ],
    [
      "a missing price",
      { data: [endpoint("vendor/model", "A", undefined, "0.000005")] },
    ],
    ["an endpoint without a model", { data: [{ provider_name: "A" }] }],
  ])("refuses a response with %s", (_, response) => {
    expect(() => priceZeroRetentionEndpoints(response)).toThrow();
  });
});

describe("pricing time-of-day overrides and unrelated models", () => {
  it("counts a time-of-day price at every prompt length, since it may apply at any moment", () => {
    // OpenRouter's live tencent/hy4-preview shape: a night price of $0.90 / $3 below the $0.80 / $2.50 base.
    const response = {
      data: [
        endpoint("anthropic/claude-test", "A", "0.0000008", "0.0000025", [
          {
            utc_start: 0,
            utc_end: 1600,
            prompt: "0.0000008",
            completion: "0.0000025",
          },
          {
            utc_start: 1600,
            utc_end: 0,
            prompt: "0.0000009",
            completion: "0.000003",
          },
        ]),
        endpoint("anthropic/claude-test", "B", "0.0000001", "0.0000001", [
          {
            min_prompt_tokens: 200_000,
            prompt: "0.000002",
            completion: "0.000004",
          },
        ]),
      ],
    };
    expect(
      priceZeroRetentionEndpoints(response).get("anthropic/claude-test")
        ?.prices,
    ).toEqual([
      {
        minPromptTokens: 0,
        inputMicroUsdPerMTok: 900_000,
        outputMicroUsdPerMTok: 3_000_000,
      },
      {
        minPromptTokens: 200_000,
        inputMicroUsdPerMTok: 2_000_000,
        outputMicroUsdPerMTok: 4_000_000,
      },
    ]);
  });

  it("reads only the models asked for, so another model's odd entry cannot stop the sync", () => {
    const response = {
      data: [
        endpoint("anthropic/claude-test", "A", "0.000001", "0.000002"),
        endpoint("other/broken", "B", "not a price", "0.000002"),
      ],
    };
    const prices = priceZeroRetentionEndpoints(
      response,
      new Set(["anthropic/claude-test"]),
    );
    expect([...prices.keys()]).toEqual(["anthropic/claude-test"]);
  });
});

describe("fetching zero-retention prices", () => {
  it.each([
    "https://openrouter.test/api/v1",
    "https://openrouter.test/api/v1/",
  ])("reads the endpoint list below %s", async (baseURL) => {
    const urls: string[] = [];

    const prices = await fetchZeroRetentionPrices({
      baseURL,
      fetch: async (input) => {
        urls.push(String(input));
        return Response.json(zdr);
      },
    });

    expect(urls).toEqual(["https://openrouter.test/api/v1/endpoints/zdr"]);
    expect(prices.get("anthropic/claude-opus-5.5")?.prices).toEqual([
      {
        minPromptTokens: 0,
        inputMicroUsdPerMTok: 4_400_000,
        outputMicroUsdPerMTok: 22_000_000,
      },
    ]);
  });

  it("fails when OpenRouter does not answer with the list", async () => {
    await expect(
      fetchZeroRetentionPrices({
        baseURL: "https://openrouter.test/api/v1",
        fetch: async () => new Response("unavailable", { status: 503 }),
      }),
    ).rejects.toThrow(/503/);
  });
});

function endpoint(
  model_id: string,
  provider_name: string,
  prompt: string | undefined,
  completion: string,
  overrides?: Record<string, unknown>[],
) {
  return {
    model_id,
    provider_name,
    pricing: { prompt, completion, ...(overrides && { overrides }) },
  };
}
