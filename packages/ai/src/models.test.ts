import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { createModels, isDefiniteFailure } from "./index.js";

const models = createModels({
  apiKey: "test-key",
  baseURL: "https://openrouter.test/api/v1",
});

describe("the model registry", () => {
  it.each([
    "openai/gpt-5",
    "anthropic/claude-fable-5-1",
    "anthropic/claude-haiku-5.5:free",
    "",
  ])("rejects the model ID %j outside the allowlist", (id) => {
    expect(() => models.byId(id)).toThrow(/not in the model allowlist/);
  });

  // ADR-0011 starting defaults, confirmed by evaluations before the pilot.
  it.each([
    ["extraction", "anthropic/claude-haiku-5.5"],
    ["classification", "anthropic/claude-haiku-5.5"],
    ["estimation", "anthropic/claude-haiku-5.5"],
    ["agent", "anthropic/claude-sonnet-5.5"],
    ["explanation", "anthropic/claude-sonnet-5.5"],
    ["feedback", "anthropic/claude-sonnet-5.5"],
    ["planning", "anthropic/claude-opus-5.5"],
  ] as const)("defaults %s to %s", (task, id) => {
    expect(models.forTask(task).id).toBe(id);
  });

  it.each([
    "anthropic/claude-haiku-5.5",
    "anthropic/claude-sonnet-5.5",
    "anthropic/claude-opus-5.5",
  ])("labels %s with how it handles student data", (id) => {
    // ADR-0012 and its spike f amendment: international routing, zero retention, Bedrock or Google upstream.
    expect(models.byId(id).label).toEqual({
      provider: "OpenRouter",
      upstream: ["Amazon Bedrock", "Google"],
      routing: "international",
      zeroRetention: true,
    });
  });

  // OpenRouter prices per million tokens (input / output): Haiku $0.10 / $0.50, Sonnet $2 / $10, Opus $4 / $20.
  // A token covers at least one UTF-8 byte, so 10,000 bytes plus 200 tokens of message framing bound the input.
  it.each([
    ["anthropic/claude-haiku-5.5", 1_020 + 4_000],
    ["anthropic/claude-sonnet-5.5", 20_400 + 80_000],
    ["anthropic/claude-opus-5.5", 40_800 + 160_000],
  ])(
    "estimates %s from 10,000 bytes of German input plus its full 8k output budget",
    (id, microUsd) => {
      const input = "Prüfung".repeat(1_250); // "ü" takes two bytes: 8 bytes per word.

      expect(new TextEncoder().encode(input).byteLength).toBe(10_000);
      expect(models.byId(id).estimateMicroUsd([input])).toBe(microUsd);
    },
  );

  it("gives extraction a 32k output budget, because Haiku's reasoning tokens share it, and reserves for all of it", () => {
    const input = "Prüfung".repeat(1_250);
    const extraction = models.forTask("extraction");

    expect(extraction.callSettings.maxOutputTokens).toBe(32_000);
    expect(extraction.estimateMicroUsd([input])).toBe(1_020 + 16_000);
    expect(models.forTask("agent").callSettings.maxOutputTokens).toBe(8_000);
  });

  it("sends every request to zero-retention endpoints only, with a bounded output budget", async () => {
    const bodies: Record<string, unknown>[] = [];
    const recording = createModels({
      apiKey: "test-key",
      baseURL: "https://openrouter.test/api/v1",
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json(completion("pong"));
      },
    });
    const haiku = recording.byId("anthropic/claude-haiku-5.5");

    await generateText({
      model: haiku.model,
      ...haiku.callSettings,
      prompt: "Reply with: pong",
    });

    expect(bodies).toEqual([
      expect.objectContaining({
        model: "anthropic/claude-haiku-5.5",
        provider: { zdr: true, data_collection: "deny" },
        max_tokens: 8_000,
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
      });
      const haiku = reporting.byId("anthropic/claude-haiku-5.5");

      const result = await generateText({
        model: haiku.model,
        ...haiku.callSettings,
        prompt: "Reply with: pong",
      });

      expect(haiku.actualMicroUsd(result)).toBe(microUsd);
    },
  );

  it("prices the reported tokens when OpenRouter reports no cost", async () => {
    const silent = createModels({
      apiKey: "test-key",
      baseURL: "https://openrouter.test/api/v1",
      fetch: async () =>
        Response.json(
          completion("pong", { promptTokens: 1_000, completionTokens: 200 }),
        ),
    });
    const sonnet = silent.byId("anthropic/claude-sonnet-5.5");

    const result = await generateText({
      model: sonnet.model,
      ...sonnet.callSettings,
      prompt: "Reply with: pong",
    });

    // 1,000 input tokens at $2 per million plus 200 output tokens at $10 per million.
    expect(sonnet.actualMicroUsd(result)).toBe(2_000 + 2_000);
  });

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
    });
    const haiku = failing.byId("anthropic/claude-haiku-5.5");

    await expect(
      generateText({
        model: haiku.model,
        ...haiku.callSettings,
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
      });
      const haiku = rejecting.byId("anthropic/claude-haiku-5.5");

      const error = await generateText({
        model: haiku.model,
        ...haiku.callSettings,
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
    });
    const haiku = offline.byId("anthropic/claude-haiku-5.5");

    const error = await generateText({
      model: haiku.model,
      ...haiku.callSettings,
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
