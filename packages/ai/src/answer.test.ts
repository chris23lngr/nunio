import type { UIMessageChunk } from "ai";
import { jsonSchema, tool } from "ai";
import { expect, it } from "vitest";
import { createAnswerer } from "./answer.js";
import type { Models } from "./models.js";
import { createModels } from "./models.js";
import { sonnet, testCatalog } from "./test-catalog.js";

/** Chat answers come from whichever Model the student chose; these tests use the explanation default. */
const answererFrom = (models: Models) =>
  createAnswerer(models.forTask("explanation"));

const encoder = new TextEncoder();
const event = (data: unknown) =>
  encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
const content = (text: string) => ({
  id: "gen-1",
  choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
});
const finished = (reason: string, cost?: number) => ({
  id: "gen-1",
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
  usage: {
    prompt_tokens: 1000,
    completion_tokens: 200,
    total_tokens: 1200,
    ...(cost === undefined ? {} : { cost }),
  },
});

/** A provider that streams `events` as OpenRouter's SSE, recording each request body. */
function streaming(
  events: unknown[],
  bodies: Record<string, unknown>[] = [],
): typeof fetch {
  return async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const data of events) controller.enqueue(event(data));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
  };
}

const search = tool({
  description: "Searches the material",
  inputSchema: jsonSchema<{ query: string }>({
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  }),
  execute: async () => ({ found: 0 }),
});

it("sends the instructions apart from the conversation, which it sends as given", async () => {
  const bodies: Record<string, unknown>[] = [];
  const answerer = answererFrom(
    createModels({
      apiKey: "test",
      baseURL: "https://provider.invalid",
      catalog: testCatalog,
      fetch: streaming([content("Am 10. Februar."), finished("stop")], bodies),
    }),
  );

  await answerer.step(
    {
      messages: [
        { role: "user", content: "Wann ist die Klausur?" },
        { role: "assistant", content: "Am 10. Februar." },
        { role: "user", content: "Und um wie viel Uhr?" },
      ],
      tools: {},
      last: false,
    },
    { signal: AbortSignal.timeout(1000), write: () => {} },
  );

  const body = bodies[0] as {
    model: string;
    messages: { role: string; content: unknown }[];
  };
  const text = (m: { content: unknown }) =>
    typeof m.content === "string"
      ? m.content
      : (m.content as { text?: string }[])
          .map((part) => part.text ?? "")
          .join("");
  expect(body.model).toBe("anthropic/claude-sonnet-5.5");
  expect(body.messages[0]!.role).toBe("system");
  expect(text(body.messages[0]!)).not.toContain("Klausur");
  expect(body.messages.slice(1).map((m) => [m.role, text(m)])).toEqual([
    ["user", "Wann ist die Klausur?"],
    ["assistant", "Am 10. Februar."],
    ["user", "Und um wie viel Uhr?"],
  ]);
});

it("offers the tools without forcing one, routing a Chat only to endpoints that support them", async () => {
  const bodies: Record<string, unknown>[] = [];
  const answerer = createAnswerer(
    createModels({
      apiKey: "test",
      baseURL: "https://provider.invalid",
      catalog: testCatalog,
      fetch: streaming([content("Am 10. Februar."), finished("stop")], bodies),
    }).fromConfig(sonnet),
  );
  const step = {
    messages: [{ role: "user" as const, content: "Wann ist die Klausur?" }],
    tools: { searchMaterial: search },
  };
  const options = { signal: AbortSignal.timeout(1000), write: () => {} };

  await answerer.step({ ...step, last: false }, options);
  await answerer.step({ ...step, last: true }, options);

  expect(
    bodies.map((body) => ({
      provider: body.provider,
      tool_choice: body.tool_choice,
      tools: (body.tools as { function: { name: string } }[]).map(
        (tool) => tool.function.name,
      ),
    })),
  ).toEqual([
    {
      provider: {
        zdr: true,
        data_collection: "deny",
        require_parameters: true,
      },
      tool_choice: "auto",
      tools: ["searchMaterial"],
    },
    {
      provider: {
        zdr: true,
        data_collection: "deny",
        require_parameters: true,
      },
      tool_choice: "none",
      tools: ["searchMaterial"],
    },
  ]);
});

it("streams a step's chunks before it completes, then settles at the reported cost", async () => {
  let finish = () => {};
  const ending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const chunks: UIMessageChunk[] = [];
  const answerer = answererFrom(
    createModels({
      apiKey: "test",
      baseURL: "https://provider.invalid",
      catalog: testCatalog,
      fetch: async () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(
                event({
                  id: "gen-1",
                  choices: [
                    {
                      index: 0,
                      delta: { reasoning: "Ich prüfe die Quelle." },
                      finish_reason: null,
                    },
                  ],
                }),
              );
              controller.enqueue(event(content("Eine Antwort [S1].")));
              await ending;
              controller.enqueue(event(finished("stop", 0.004)));
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    }),
  );
  const pending = answerer.step(
    {
      messages: [{ role: "user", content: "Wann?" }],
      tools: {},
      last: false,
    },
    { signal: AbortSignal.timeout(2000), write: (chunk) => chunks.push(chunk) },
  );
  try {
    await expect
      .poll(() => chunks.some((chunk) => chunk.type === "text-delta"), {
        timeout: 1000,
      })
      .toBe(true);
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "reasoning-delta",
        delta: "Ich prüfe die Quelle.",
      }),
    );
  } finally {
    finish();
  }
  const result = await pending;
  expect(result.value.finishReason).toBe("stop");
  expect(result.usage).toEqual({ microUsd: 4000 });
});

it("counts the conversation and the tools in its estimate", () => {
  const answerer = answererFrom(
    createModels({
      apiKey: "test",
      baseURL: "https://provider.invalid",
      catalog: testCatalog,
    }),
  );
  const question = {
    messages: [{ role: "user" as const, content: "Und um wie viel Uhr?" }],
    tools: {},
    last: false,
  };
  const followUp = {
    ...question,
    messages: [
      { role: "user" as const, content: "Wann ist die Klausur?" },
      { role: "assistant" as const, content: "Am 10. Februar." },
      ...question.messages,
    ],
  };

  expect(answerer.estimateMicroUsd(followUp)).toBeGreaterThan(
    answerer.estimateMicroUsd(question),
  );
  expect(
    answerer.estimateMicroUsd({ ...question, tools: { search } }),
  ).toBeGreaterThan(answerer.estimateMicroUsd(question));
});

for (const outcome of ["length", "missing-usage", "error", "eof"] as const) {
  it(`does not complete a step with ${outcome}`, async () => {
    const terminal =
      outcome === "error"
        ? { error: { message: "Unavailable", code: 500 } }
        : outcome === "missing-usage"
          ? {
              id: "gen-1",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            }
          : finished(outcome === "length" ? "length" : "stop");
    const answerer = answererFrom(
      createModels({
        apiKey: "test",
        baseURL: "https://provider.invalid",
        catalog: testCatalog,
        fetch: streaming([
          content("Ein Anfang"),
          ...(outcome === "eof" ? [] : [terminal]),
        ]),
      }),
    );
    await expect(
      answerer.step(
        {
          messages: [{ role: "user", content: "Wann?" }],
          tools: {},
          last: false,
        },
        { signal: AbortSignal.timeout(2000), write: () => {} },
      ),
    ).rejects.toThrow();
  });
}

it("names the Model it answers with, for the answer's record", () => {
  const answerer = answererFrom(
    createModels({
      apiKey: "test",
      baseURL: "https://provider.invalid",
      catalog: testCatalog,
    }),
  );
  expect(answerer.modelKey).toBe("sonnet-5.5-reasoning-high");
});
