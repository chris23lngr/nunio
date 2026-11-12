import { expect, it } from "vitest";
import { createModels } from "./models.js";
import { createMaker } from "./practice.js";
import { testCatalog } from "./test-catalog.js";

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
        prompt_tokens: 2000,
        completion_tokens: 800,
        total_tokens: 2800,
        cost: 0.012,
      },
    });
  };
}
const makerReplying = (
  bodies: Record<string, unknown>[],
  content: string,
  finishReason?: string,
) =>
  createMaker(
    createModels({
      apiKey: "test",
      baseURL: "https://provider.invalid",
      catalog: testCatalog,
      fetch: recorded(bodies, content, finishReason),
    }),
  );
const input = {
  topics: [{ id: "topic-1", name: "Gleichmäßige Konvergenz" }],
  data: "<data-1234>\n[S1] Skript, page 4\nEine Funktionenfolge konvergiert gleichmäßig, wenn …\n</data-1234>",
  tags: ["S1", "S2"],
};

it("makes a practice set from material sent as data apart from its instructions, keeping only the Topics and tags it was given", async () => {
  const bodies: Record<string, unknown>[] = [];
  const maker = makerReplying(
    bodies,
    JSON.stringify({
      items: [
        {
          topicIds: ["topic-1"],
          question: "Wann konvergiert eine Funktionenfolge gleichmäßig? [S1]",
          answer:
            "Wenn der Abstand zur Grenzfunktion gleichmäßig klein wird [S1] [S7].",
        },
        {
          topicIds: ["topic-9"],
          question: "Was ist ein Integral?",
          answer: "Eine Fläche.",
        },
        {
          topicIds: ["topic-1", "topic-9"],
          question: "Ist punktweise Konvergenz schwächer?",
          answer: "Ja [S2].",
        },
      ],
    }),
  );

  const made = await maker.practiceSet(input, {
    signal: new AbortController().signal,
  });

  expect(made.value.items).toEqual([
    {
      id: "1",
      topicIds: ["topic-1"],
      question: "Wann konvergiert eine Funktionenfolge gleichmäßig? [S1]",
      answer: "Wenn der Abstand zur Grenzfunktion gleichmäßig klein wird [S1].",
      cited: ["S1"],
    },
    {
      id: "2",
      topicIds: ["topic-1"],
      question: "Ist punktweise Konvergenz schwächer?",
      answer: "Ja [S2].",
      cited: ["S2"],
    },
  ]);
  expect(made.usage.microUsd).toBe(12_000);
  const [system, ...rest] = (
    bodies[0] as { messages: { role: string; content: unknown }[] }
  ).messages;
  expect(system!.role).toBe("system");
  expect(JSON.stringify(system)).not.toContain("<data-1234>");
  expect(JSON.stringify(rest)).toContain("<data-1234>");
  // Topic names are extracted text, so they are fenced like the material.
  expect(JSON.stringify(rest)).toMatch(
    /<topics-([0-9a-f]{32})>\\ntopic-1: Gleichmäßige Konvergenz\\n<\/topics-\1>/,
  );
  expect(maker.estimateMicroUsd(input)).toBeGreaterThan(0);
});

it("refuses a practice set the model did not finish", async () => {
  const maker = makerReplying([], JSON.stringify({ items: [] }), "length");

  await expect(
    maker.practiceSet(input, { signal: new AbortController().signal }),
  ).rejects.toThrow(/ended early/);
});

it("makes flashcards from fenced material, keeping only the Topics and tags it was given", async () => {
  const bodies: Record<string, unknown>[] = [];
  const maker = makerReplying(
    bodies,
    JSON.stringify({
      cards: [
        {
          topicIds: ["topic-1"],
          front: "Gleichmäßige Konvergenz",
          back: "Der Abstand zur Grenzfunktion wird überall\ngleichzeitig klein [S1] [S5].",
        },
        { topicIds: ["topic-7"], front: "Integral", back: "Fläche" },
      ],
    }),
  );

  const made = await maker.flashcards(input, {
    signal: new AbortController().signal,
  });

  expect(made).toEqual({
    value: {
      cards: [
        {
          id: "1",
          topicIds: ["topic-1"],
          front: "Gleichmäßige Konvergenz",
          back: "Der Abstand zur Grenzfunktion wird überall\ngleichzeitig klein [S1].",
          cited: ["S1"],
        },
      ],
    },
    usage: { microUsd: 12_000 },
  });
  const [system, ...rest] = (
    bodies[0] as { messages: { role: string; content: unknown }[] }
  ).messages;
  expect(JSON.stringify(system)).not.toContain("<data-1234>");
  expect(JSON.stringify(rest)).toContain("<data-1234>");
  expect(JSON.stringify(rest)).toMatch(/<topics-([0-9a-f]{32})>/);
});

it("refuses flashcards the model did not finish", async () => {
  const maker = makerReplying([], JSON.stringify({ cards: [] }), "length");

  await expect(
    maker.flashcards(input, { signal: new AbortController().signal }),
  ).rejects.toThrow(/ended early/);
});
