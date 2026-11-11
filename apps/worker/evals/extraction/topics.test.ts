import { expect, it } from "vitest";
import { scoreTopics } from "./topics.js";

it("matches Topic aliases once and only within their Course", () => {
  expect(
    scoreTopics(
      [
        {
          course: "analysis",
          aliases: ["uniform convergence", "gleichmäßige Konvergenz"],
        },
      ],
      [
        {
          course: "analysis",
          key: "Gleichmäßige Konvergenz",
          value: "A description",
        },
        { course: "analysis", key: "uniform convergence", value: "" },
        { course: "other", key: "uniform convergence", value: "" },
      ],
    ),
  ).toEqual({
    labelled: 1,
    extracted: 3,
    matched: 1,
    precision: 1 / 3,
    recall: 1,
  });
});

it("recovers distinct Topic keys from Provenance when values repeat", async () => {
  const { topicKey } = await import("./topics.js");
  const raw = [
    {
      key: "backpropagation",
      value: "covered",
      page: 1,
      quote: "Backward pass",
    },
    {
      key: "tokenization",
      value: "covered",
      page: 2,
      quote: "Split text into tokens",
    },
  ];
  expect(
    topicKey(raw, "covered", [{ page: 2, quote: "Split text into tokens" }]),
  ).toBe("tokenization");
});
