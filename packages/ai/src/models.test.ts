import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { createModels, isDefiniteFailure } from "./index.js";

const models = createModels({ apiKey: "test-key", baseURL: "https://openrouter.test/api/v1" });

describe("the model registry", () => {
  it.each(["openai/gpt-5", "anthropic/claude-fable-5-1", "anthropic/claude-haiku-5.5:free", ""])(
    "rejects the model ID %j outside the allowlist", id => {
      expect(() => models.byId(id)).toThrow(/not in the model allowlist/);
    });

  // ADR-0011 starting defaults, confirmed by evaluations before the pilot.
  it.each([
    ["extraction", "anthropic/claude-haiku-5.5"],
    ["classification", "anthropic/claude-haiku-5.5"],
    ["agent", "anthropic/claude-sonnet-5.5"],
    ["explanation", "anthropic/claude-sonnet-5.5"],
    ["feedback", "anthropic/claude-sonnet-5.5"],
    ["planning", "anthropic/claude-opus-5.5"],
  ] as const)("defaults %s to %s", (task, id) => {
    expect(models.forTask(task).id).toBe(id);
  });

  it.each(["anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5"])(
    "labels %s with how it handles student data", id => {
      // ADR-0012 and its spike f amendment: international routing, zero retention, Bedrock or Google upstream.
      expect(models.byId(id).label).toEqual({
        provider: "OpenRouter", upstream: ["Amazon Bedrock", "Google"], routing: "international", zeroRetention: true,
      });
    });

  // OpenRouter prices per million tokens (input / output): Haiku $0.10 / $0.50, Sonnet $2 / $10, Opus $4 / $20.
  it.each([
    ["anthropic/claude-haiku-5.5", 1_000 + 4_000],
    ["anthropic/claude-sonnet-5.5", 20_000 + 80_000],
    ["anthropic/claude-opus-5.5", 40_000 + 160_000],
  ])("estimates %s at 10k input tokens plus its full 8k output budget", (id, microUsd) => {
    expect(models.byId(id).estimateMicroUsd(10_000)).toBe(microUsd);
  });

  it("sends every request to zero-retention endpoints only, with a bounded output budget", async () => {
    const bodies: Record<string, unknown>[] = [];
    const recording = createModels({
      apiKey: "test-key", baseURL: "https://openrouter.test/api/v1",
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json(completion("pong"));
      },
    });
    const haiku = recording.byId("anthropic/claude-haiku-5.5");

    await generateText({ model: haiku.model, ...haiku.callSettings, prompt: "Reply with: pong" });

    expect(bodies).toEqual([expect.objectContaining({
      model: "anthropic/claude-haiku-5.5",
      provider: { zdr: true, data_collection: "deny" },
      max_tokens: 8_000,
    })]);
  });

  it("leaves retries to the caller: a failed request is sent once", async () => {
    let requests = 0;
    const failing = createModels({
      apiKey: "test-key", baseURL: "https://openrouter.test/api/v1",
      fetch: async () => {
        requests++;
        return Response.json({ error: { message: "upstream unavailable", code: 503 } }, { status: 503 });
      },
    });
    const haiku = failing.byId("anthropic/claude-haiku-5.5");

    await expect(generateText({ model: haiku.model, ...haiku.callSettings, prompt: "Reply with: pong" })).rejects.toThrow();
    expect(requests).toBe(1);
  });
});

describe("isDefiniteFailure", () => {
  // 408 is a timeout, so the request may have been processed; only other 4xx rejections are certain.
  it.each([[400, true], [401, true], [402, true], [429, true], [408, false], [500, false], [503, false]])(
    "treats a provider response with status %i as definite: %s", async (status, definite) => {
      const rejecting = createModels({
        apiKey: "test-key", baseURL: "https://openrouter.test/api/v1",
        fetch: async () => Response.json({ error: { message: "rejected", code: status } }, { status }),
      });
      const haiku = rejecting.byId("anthropic/claude-haiku-5.5");

      const error = await generateText({ model: haiku.model, ...haiku.callSettings, prompt: "Reply with: pong" })
        .catch((e: unknown) => e);

      expect(isDefiniteFailure(error)).toBe(definite);
    });

  it("does not treat a network failure as definite", async () => {
    const offline = createModels({
      apiKey: "test-key", baseURL: "https://openrouter.test/api/v1",
      fetch: async () => { throw new TypeError("fetch failed"); },
    });
    const haiku = offline.byId("anthropic/claude-haiku-5.5");

    const error = await generateText({ model: haiku.model, ...haiku.callSettings, prompt: "Reply with: pong" })
      .catch((e: unknown) => e);

    expect(isDefiniteFailure(error)).toBe(false);
  });
});

function completion(content: string) {
  return {
    id: "gen-test", object: "chat.completion", created: 0, model: "anthropic/claude-haiku-5.5",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
  };
}
