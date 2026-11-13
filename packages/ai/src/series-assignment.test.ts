import { expect, it } from "vitest";
import { createModels } from "./models.js";
import { createSeriesAssigner } from "./series-assignment.js";
import { testCatalog } from "./test-catalog.js";

function recorded(
  bodies: Record<string, unknown>[],
  content: string,
): typeof fetch {
  return async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({
      id: "gen-1",
      model: "anthropic/claude-haiku-5.5",
      object: "chat.completion",
      created: 0,
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content },
        },
      ],
      usage: {
        prompt_tokens: 300,
        completion_tokens: 50,
        total_tokens: 350,
        cost: 0.00005,
      },
    });
  };
}

it("proposes a Course handle per Event Series, from titles, times and the Course list alone", async () => {
  const bodies: Record<string, unknown>[] = [];
  const assigner = createSeriesAssigner(
    createModels({
      apiKey: "test",
      baseURL: "https://provider.invalid",
      catalog: testCatalog,
      fetch: recorded(
        bodies,
        JSON.stringify({
          assignments: [
            { index: 0, course: "K1" },
            { index: 1, course: null },
            { index: 2, course: "K9" },
          ],
        }),
      ),
    }),
  );
  const input = {
    series: [
      {
        title: "OM Vorlesung",
        times: ["Mon 10:00–12:00", "Thu 14:00–16:00"],
        events: 28,
      },
      { title: "Schicht Café", times: ["Sat 09:00–13:00"], events: 12 },
      { title: "Tutorium", times: ["Wed 16:00–18:00"], events: 14 },
    ],
    courses: [
      { handle: "K1", title: "Operations Management", code: "OM" },
      { handle: "K2", title: "Analysis I", code: null },
    ],
  };

  const result = await assigner.assign(input, {
    signal: AbortSignal.timeout(1000),
  });

  // A handle the student's Courses do not have is no proposal.
  expect(result).toEqual({
    value: ["K1", null, null],
    usage: { microUsd: 50 },
  });
  const body = bodies[0] as { messages: { role: string; content: unknown }[] };
  expect(
    JSON.stringify(body.messages.filter((m) => m.role === "system")),
  ).not.toMatch(/OM Vorlesung|Operations Management/);
  expect(
    JSON.stringify(body.messages.filter((m) => m.role === "user")),
  ).toMatch(
    /<series-([0-9a-f]{32})>.*OM Vorlesung.*Mon 10:00–12:00.*Operations Management.*<\/series-\1>/s,
  );
});
