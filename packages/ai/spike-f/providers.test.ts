import { embedMany, generateText, Output } from "ai";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { openRouterConfigured, spikeModels } from "./openrouter.ts";

describe.skipIf(!openRouterConfigured)("OpenRouter (spike f)", () => {
  const models = openRouterConfigured ? spikeModels() : ({} as ReturnType<typeof spikeModels>);

  it("answers through a zero-retention Claude endpoint", async () => {
    const { text } = await generateText({ model: models.chat, prompt: "Reply with the single word: pong" });
    expect(text.toLowerCase()).toContain("pong");
  });

  // ADR-0011 rules: structured output without forcing a tool call.
  it("returns structured output through response_format, without tools", async () => {
    const bodies: unknown[] = [];
    const recording = spikeModels({
      fetch: (input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return fetch(input, init);
      },
    });
    const schema = z.object({ city: z.string(), country: z.string() });
    const { output } = await generateText({
      model: recording.chat,
      output: Output.object({ schema }),
      prompt: "Which city is the capital of Germany? Answer with the city and its country.",
    });
    expect(schema.parse(output)).toEqual({ city: "Berlin", country: "Germany" });

    const [body] = bodies;
    expect(body).toMatchObject({ response_format: { type: "json_schema" } });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
  });

  it("reads a cached prompt prefix on the second call", async () => {
    // Above Claude's minimum cacheable length; unique per run so the first call writes the cache.
    const reference = `Run ${Date.now()}.\n` + "Facts are recorded per Source and cited in answers. ".repeat(600);
    const ask = () =>
      generateText({
        model: models.chat,
        instructions: {
          role: "system",
          content: reference,
          providerOptions: { openrouter: { cacheControl: { type: "ephemeral" } } },
        },
        prompt: "Reply with the single word: ok",
      });

    await ask();
    const second = await ask();
    expect(second.usage.inputTokenDetails.cacheReadTokens).toBeGreaterThan(0);
  });

  it("embeds German text through a zero-retention endpoint", async () => {
    const { embeddings } = await embedMany({
      model: models.embedding,
      values: ["Die Photosynthese findet in den Chloroplasten statt.", "Wo findet die Photosynthese statt?"],
    });
    expect(embeddings).toHaveLength(2);
    expect(embeddings[0]).toHaveLength(1024);
  });
});
