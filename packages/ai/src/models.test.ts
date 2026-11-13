import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import type { ModelConfig } from "./index.js";
import {
  createModels,
  isDefiniteFailure,
  isTransientFailure,
} from "./index.js";
import { haiku, opus, sonnet, testCatalog } from "./test-catalog.js";

const models = createModels({
  apiKey: "test-key",
  baseURL: "https://openrouter.test/api/v1",
  catalog: testCatalog,
});

/** A Haiku row with OpenRouter's long-context surcharge from 100k prompt tokens: $0.50 / $2.50 per million. */
const longContextHaiku: ModelConfig = {
  ...haiku,
  prices: [
    {
      minPromptTokens: 0,
      inputMicroUsdPerMTok: 100_000,
      outputMicroUsdPerMTok: 500_000,
    },
    {
      minPromptTokens: 100_000,
      inputMicroUsdPerMTok: 500_000,
      outputMicroUsdPerMTok: 2_500_000,
    },
  ],
};

describe("the model registry", () => {
  // ADR-0011 starting defaults, confirmed by evaluations before the pilot.
  it.each([
    ["extraction", "haiku-5.5-reasoning-high"],
    ["scan", "haiku-5.5-reasoning-high"],
    ["classification", "haiku-5.5-reasoning-high"],
    ["estimation", "haiku-5.5-reasoning-high"],
    ["agent", "sonnet-5.5-reasoning-high"],
    ["explanation", "sonnet-5.5-reasoning-high"],
    ["feedback", "sonnet-5.5-reasoning-high"],
    ["planning", "opus-5.5-reasoning-high"],
  ] as const)("defaults %s to the catalog's %s", (task, key) => {
    expect(models.forTask(task).key).toBe(key);
  });

  it("fails clearly when the catalog lacks a task's model", () => {
    const partial = createModels({
      apiKey: "test-key",
      baseURL: "https://openrouter.test/api/v1",
      catalog: [haiku, sonnet],
    });

    expect(() => partial.forTask("planning")).toThrow(
      /opus-5\.5-reasoning-high/,
    );
  });

  it.each(["anthropic/claude-fable-5-1", "anthropic/claude-mythos-5"])(
    "refuses a catalog holding the Covered Model %s",
    (providerModelId) => {
      expect(() =>
        createModels({
          apiKey: "test-key",
          baseURL: "https://openrouter.test/api/v1",
          catalog: [
            ...testCatalog,
            { ...sonnet, key: "covered", providerModelId },
          ],
        }),
      ).toThrow(/Covered Model/);
    },
  );

  it("refuses a Covered Model chosen per request", () => {
    expect(() =>
      models.fromConfig({
        ...sonnet,
        key: "fable-5.1-reasoning-high",
        providerModelId: "anthropic/claude-fable-5-1",
      }),
    ).toThrow(/Covered Model/);
  });

  it("labels a model with how its catalog row handles student data", () => {
    // ADR-0012 and its spike f amendment: international routing, zero retention, the row's upstreams.
    expect(
      models.fromConfig({ ...sonnet, upstream: ["Amazon Bedrock"] }).label,
    ).toEqual({
      provider: "OpenRouter",
      upstream: ["Amazon Bedrock"],
      routing: "international",
      zeroRetention: true,
    });
  });

  // Test catalog prices per million tokens (input / output): Haiku $0.10 / $0.50, Sonnet $2 / $10, Opus $4 / $20.
  // A token covers at least one UTF-8 byte, so 10,000 bytes plus 200 tokens of message framing bound the input.
  it.each([
    [haiku.key, haiku, 1_020 + 4_000],
    [sonnet.key, sonnet, 20_400 + 80_000],
    [opus.key, opus, 40_800 + 160_000],
  ])(
    "estimates %s from 10,000 bytes of German input plus its full 8k output budget",
    (_, config, microUsd) => {
      const input = "Prüfung".repeat(1_250); // "ü" takes two bytes: 8 bytes per word.

      expect(new TextEncoder().encode(input).byteLength).toBe(10_000);
      expect(models.fromConfig(config).estimateMicroUsd([input])).toBe(
        microUsd,
      );
    },
  );

  it("estimates at the long-context price once the input bound reaches its tier", () => {
    const model = models.fromConfig(longContextHaiku);

    // 99,799 bytes + 200 framing = 99,999 tokens at $0.10 (9,999.9) plus 8,000 output at $0.50 (4,000).
    expect(model.estimateMicroUsd(["x".repeat(99_799)])).toBe(14_000);
    // 99,800 bytes + 200 framing = 100,000 tokens at $0.50 (50,000) plus 8,000 output at $2.50 (20,000).
    expect(model.estimateMicroUsd(["x".repeat(99_800)])).toBe(70_000);
  });

  it("gives extraction a 32k output budget, because Haiku's reasoning tokens share it, and reserves for all of it", () => {
    const input = "Prüfung".repeat(1_250);
    const extraction = models.forTask("extraction");

    expect(extraction.callSettings.maxOutputTokens).toBe(32_000);
    expect(extraction.estimateMicroUsd([input])).toBe(1_020 + 16_000);
  });

  it("gives other tasks their catalog row's output budget", () => {
    const roomy = createModels({
      apiKey: "test-key",
      baseURL: "https://openrouter.test/api/v1",
      catalog: [haiku, { ...sonnet, maxOutputTokens: 12_000 }, opus],
    });

    expect(roomy.forTask("agent").callSettings.maxOutputTokens).toBe(12_000);
    expect(roomy.forTask("scan").callSettings.maxOutputTokens).toBe(8_000);
  });

  it("sends a catalog row's exact configuration, to zero-retention endpoints that support every parameter it sends", async () => {
    const bodies: Record<string, unknown>[] = [];
    const recording = createModels({
      apiKey: "test-key",
      baseURL: "https://openrouter.test/api/v1",
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json(completion("pong"));
      },
      catalog: testCatalog,
    });
    const model = recording.fromConfig({
      ...sonnet,
      key: "sonnet-5.5-reasoning-medium",
      reasoningEffort: "medium",
      maxOutputTokens: 4_000,
    });

    await generateText({
      model: model.model,
      ...model.callSettings,
      prompt: "Reply with: pong",
    });

    expect(model.key).toBe("sonnet-5.5-reasoning-medium");
    expect(bodies).toEqual([
      expect.objectContaining({
        model: "anthropic/claude-sonnet-5.5",
        provider: {
          zdr: true,
          data_collection: "deny",
          require_parameters: true,
        },
        reasoning: { effort: "medium" },
        max_tokens: 4_000,
        usage: { include: true },
      }),
    ]);
  });

  it.each([
    [0.0001234, 124],
    [0.000123, 123],
    [0.0007, 700],
  ])(
    "charges the cost OpenRouter reports for a call: $%f is %i micro-USD",
    async (cost, microUsd) => {
      const reporting = createModels({
        apiKey: "test-key",
        baseURL: "https://openrouter.test/api/v1",
        fetch: async () => Response.json(completion("pong", { cost })),
        catalog: testCatalog,
      });
      const model = reporting.fromConfig(haiku);

      const result = await generateText({
        model: model.model,
        ...model.callSettings,
        prompt: "Reply with: pong",
      });

      expect(model.actualMicroUsd(result)).toBe(microUsd);
    },
  );

  it.each([
    // 1,000 input tokens at $2 per million plus 200 output tokens at $10 per million.
    ["sonnet", sonnet, 1_000, 200, 2_000 + 2_000],
    // 150,000 input tokens reach the long-context tier: at $0.50 (75,000) plus 1,000 output at $2.50 (2,500).
    ["long-context haiku", longContextHaiku, 150_000, 1_000, 75_000 + 2_500],
    // 99,999 input tokens stay below it: at $0.10 (9,999.9) plus 1,000 output at $0.50 (500).
    ["long-context haiku", longContextHaiku, 99_999, 1_000, 10_500],
  ])(
    "prices the reported tokens of %s when OpenRouter reports no cost (%i in, %i out)",
    async (_, config, promptTokens, completionTokens, microUsd) => {
      const silent = createModels({
        apiKey: "test-key",
        baseURL: "https://openrouter.test/api/v1",
        fetch: async () =>
          Response.json(completion("pong", { promptTokens, completionTokens })),
        catalog: testCatalog,
      });
      const model = silent.fromConfig(config);

      const result = await generateText({
        model: model.model,
        ...model.callSettings,
        prompt: "Reply with: pong",
      });

      expect(model.actualMicroUsd(result)).toBe(microUsd);
    },
  );

  it("leaves retries to the caller: a failed request is sent once", async () => {
    let requests = 0;
    const failing = createModels({
      apiKey: "test-key",
      baseURL: "https://openrouter.test/api/v1",
      fetch: async () => {
        requests++;
        return Response.json(
          { error: { message: "upstream unavailable", code: 503 } },
          { status: 503 },
        );
      },
      catalog: testCatalog,
    });
    const model = failing.fromConfig(haiku);

    await expect(
      generateText({
        model: model.model,
        ...model.callSettings,
        prompt: "Reply with: pong",
      }),
    ).rejects.toThrow();
    expect(requests).toBe(1);
  });
});

describe("isDefiniteFailure", () => {
  // 408 is a timeout, so the request may have been processed; only other 4xx rejections are certain.
  it.each([
    [400, true],
    [401, true],
    [402, true],
    [429, true],
    [408, false],
    [500, false],
    [503, false],
  ])(
    "treats a provider response with status %i as definite: %s",
    async (status, definite) => {
      const rejecting = createModels({
        apiKey: "test-key",
        baseURL: "https://openrouter.test/api/v1",
        fetch: async () =>
          Response.json(
            { error: { message: "rejected", code: status } },
            { status },
          ),
        catalog: testCatalog,
      });
      const model = rejecting.fromConfig(haiku);

      const error = await generateText({
        model: model.model,
        ...model.callSettings,
        prompt: "Reply with: pong",
      }).catch((e: unknown) => e);

      expect(isDefiniteFailure(error)).toBe(definite);
    },
  );

  it("does not treat a network failure as definite", async () => {
    const offline = createModels({
      apiKey: "test-key",
      baseURL: "https://openrouter.test/api/v1",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      catalog: testCatalog,
    });
    const model = offline.fromConfig(haiku);

    const error = await generateText({
      model: model.model,
      ...model.callSettings,
      prompt: "Reply with: pong",
    }).catch((e: unknown) => e);

    expect(isDefiniteFailure(error)).toBe(false);
  });
});

function completion(
  content: string,
  {
    promptTokens = 5,
    completionTokens = 1,
    cost,
  }: {
    promptTokens?: number;
    completionTokens?: number;
    cost?: number;
  } = {},
) {
  return {
    id: "gen-test",
    object: "chat.completion",
    created: 0,
    model: "anthropic/claude-haiku-5.5",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      ...(cost !== undefined && { cost }),
    },
  };
}

describe("isTransientFailure", () => {
  // Worth another metered attempt: a rate limit, a timeout, a provider error, or a lost connection.
  it.each([
    [429, true],
    [408, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [402, false],
  ])(
    "treats a provider response with status %i as transient: %s",
    async (status, transient) => {
      const rejecting = createModels({
        apiKey: "test-key",
        baseURL: "https://openrouter.test/api/v1",
        fetch: async () =>
          Response.json(
            { error: { message: "rejected", code: status } },
            { status },
          ),
        catalog: testCatalog,
      });
      const model = rejecting.fromConfig(haiku);
      const error = await generateText({
        model: model.model,
        ...model.callSettings,
        prompt: "Reply with: pong",
      }).catch((e: unknown) => e);
      expect(isTransientFailure(error)).toBe(transient);
    },
  );

  it("treats a lost connection and a timeout as transient", async () => {
    const offline = createModels({
      apiKey: "test-key",
      baseURL: "https://openrouter.test/api/v1",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      catalog: testCatalog,
    });
    const model = offline.fromConfig(haiku);
    const error = await generateText({
      model: model.model,
      ...model.callSettings,
      prompt: "Reply with: pong",
    }).catch((e: unknown) => e);
    expect(isTransientFailure(error)).toBe(true);
    expect(
      isTransientFailure(new DOMException("timed out", "TimeoutError")),
    ).toBe(true);
  });
});
