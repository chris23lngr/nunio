import { expect, it } from "vitest";
import { createEstimator } from "./estimation.js";
import { createModels } from "./models.js";

function recorded(bodies: Record<string, unknown>[], content: string, finishReason = "stop"): typeof fetch {
  return async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "gen-1", model: "anthropic/claude-haiku-5.5", object: "chat.completion", created: 0,
      choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content } }],
      usage: { prompt_tokens: 400, completion_tokens: 100, total_tokens: 500, cost: 0.0001 } });
  };
}

it("proposes an Estimate per Obligation through structured output, keeping titles out of the instructions", async () => {
  const bodies: Record<string, unknown>[] = [];
  const estimator = createEstimator(createModels({ apiKey: "test", baseURL: "https://provider.invalid", fetch: recorded(bodies,
    JSON.stringify({ estimates: [
      { index: 0, minutes: 240, rationale: "A weekly problem set with four proofs." },
      { index: 1, minutes: 0, rationale: "Invalid." },
      { index: 7, minutes: 60, rationale: "Unknown index." },
    ] })) }));
  const items = [
    { kind: "assignment" as const, title: "Übungsblatt 3", course: "Analysis I" },
    { kind: "exam" as const, title: "Klausur", course: "Analysis I" },
  ];

  const result = await estimator.estimate(items, { signal: AbortSignal.timeout(1000) });

  // Only well-formed estimates for items that were asked about survive, rounded up to whole half hours.
  expect(result).toEqual({ value: [{ minutes: 240, rationale: "A weekly problem set with four proofs." }, null], usage: { microUsd: 100 } });
  const body = bodies[0] as { model: string; response_format?: { type: string }; tools?: unknown; messages: { role: string; content: unknown }[] };
  expect(body).toMatchObject({ model: "anthropic/claude-haiku-5.5", response_format: { type: "json_schema" } });
  expect(body.tools).toBeUndefined();
  expect(JSON.stringify(body.messages.filter(m => m.role === "system"))).not.toContain("Übungsblatt");
  expect(JSON.stringify(body.messages.filter(m => m.role === "user"))).toMatch(/<items-([0-9a-f]{32})>.*Übungsblatt 3.*<\/items-\1>/s);
});

it("refuses a truncated answer rather than proposing part of it", async () => {
  const estimator = createEstimator(createModels({ apiKey: "test", baseURL: "https://provider.invalid",
    fetch: recorded([], "{\"estimates\": [", "length") }));
  await expect(estimator.estimate([{ kind: "exam", title: "Klausur", course: "Analysis I" }], { signal: AbortSignal.timeout(1000) }))
    .rejects.toThrow();
});
