import { expect, it } from "vitest";
import { createAnswerer } from "./answer.js";
import { createModels } from "./models.js";

function recorded(
  bodies: Record<string, unknown>[],
  content: string,
  finishReason = "stop",
): typeof fetch {
  return async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({
      id: "gen-1",
      model: "anthropic/claude-sonnet-5.5",
      object: "chat.completion",
      created: 0,
      choices: [
        {
          index: 0,
          finish_reason: finishReason,
          message: { role: "assistant", content },
        },
      ],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 200,
        total_tokens: 1200,
        cost: 0.004,
      },
    });
  };
}

it("answers from a data message apart from the question, keeping only citation tags it was given", async () => {
  const bodies: Record<string, unknown>[] = [];
  const answerer = createAnswerer(
    createModels({
      apiKey: "test",
      baseURL: "https://provider.invalid",
      fetch: recorded(
        bodies,
        "Die Klausur ist am 10. Februar [S1], laut Aushang [S7].",
      ),
    }),
  );
  const data =
    "<<<BEGIN course_material 0123456789abcdef>>>\n[S1] Modulhandbuch, page 2\nKlausur am 10.02.\n<<<END course_material 0123456789abcdef>>>";

  const result = await answerer.answer(
    { question: "Wann ist die Klausur?", data, tags: ["S1"] },
    { signal: AbortSignal.timeout(1000) },
  );

  expect(result).toEqual({
    value: {
      text: "Die Klausur ist am 10. Februar [S1], laut Aushang.",
      cited: ["S1"],
    },
    usage: { microUsd: 4000 },
  });
  const body = bodies[0] as {
    model: string;
    messages: { role: string; content: unknown }[];
    tools?: unknown;
  };
  expect(body.model).toBe("anthropic/claude-sonnet-5.5");
  expect(body.tools).toBeUndefined();
  const text = (m: { content: unknown }) =>
    typeof m.content === "string"
      ? m.content
      : (m.content as { text?: string }[])
          .map((part) => part.text ?? "")
          .join("");
  const system = body.messages
    .filter((m) => m.role === "system")
    .map(text)
    .join("");
  const user = body.messages.filter((m) => m.role === "user").map(text);
  expect(system).not.toContain("Klausur am 10.02.");
  expect(user).toEqual([
    expect.stringContaining(data),
    "Wann ist die Klausur?",
  ]);
});

it("refuses a truncated answer rather than showing part of it", async () => {
  const answerer = createAnswerer(
    createModels({
      apiKey: "test",
      baseURL: "https://provider.invalid",
      fetch: recorded([], "Die Klausur ist am", "length"),
    }),
  );
  await expect(
    answerer.answer(
      { question: "Wann?", data: "", tags: [] },
      { signal: AbortSignal.timeout(1000) },
    ),
  ).rejects.toThrow();
});
