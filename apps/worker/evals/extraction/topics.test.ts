import { expect, it } from "vitest";
import { calibrationSample, parseJudgement, scoreTopics } from "./topics.js";

const label = (overrides = {}) => ({
  course: "analysis",
  aliases: ["uniform convergence"],
  pages: [1],
  optional: false,
  figureOnly: false,
  ...overrides,
});
const topic = (course = "analysis") => ({
  course,
  key: "Konvergenz",
  value: "covered",
});

it("uses judged matches once and only within their Course", () => {
  expect(
    scoreTopics([label()], [topic("other"), topic(), topic()], [0, 0, 0]),
  ).toEqual({
    labelled: 1,
    extracted: 3,
    scored: 3,
    matched: 1,
    precision: 1 / 3,
    recall: 1,
    figureOnly: { labelled: 0, matched: 0, recall: null },
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

it("excludes optional matches from precision and optional labels from recall", () => {
  expect(
    scoreTopics(
      [label(), label({ optional: true }), label({ optional: true })],
      [topic(), topic(), topic()],
      [0, 1, 1],
    ),
  ).toMatchObject({
    labelled: 1,
    extracted: 3,
    scored: 2,
    matched: 1,
    precision: 0.5,
    recall: 1,
  });
});

it("reports recall separately for required figure-only Topics", () => {
  expect(
    scoreTopics(
      [
        label({ figureOnly: true }),
        label({ figureOnly: true }),
        label({ optional: true, figureOnly: true }),
        label(),
      ],
      [topic(), topic()],
      [0, 3],
    ),
  ).toMatchObject({
    recall: 2 / 3,
    figureOnly: { labelled: 2, matched: 1, recall: 0.5 },
  });
});

it("parses explicit IDs regardless of answer order", () => {
  expect(
    parseJudgement(
      '{"decisions":[{"topicId":2,"labelId":null},{"topicId":0,"labelId":0},{"topicId":1,"labelId":null}]}',
      [label()],
      [topic(), topic(), topic()],
    ),
  ).toEqual([0, null, null]);
});

it.each([
  "not JSON",
  "{}",
  '{"decisions":[{"topicId":4,"labelId":0}]}',
  '{"decisions":[{"topicId":0,"labelId":4}]}',
  '{"decisions":[{"topicId":0,"labelId":"0"}]}',
  '{"decisions":[{"topicId":0}]}',
  '{"decisions":[{"topicId":0,"labelId":0},{"topicId":0,"labelId":null}]}',
  '{"decisions":[{"topicId":0,"labelId":0}]}',
])(
  "rejects malformed, ambiguous or incomplete judge responses: %s",
  (response) => {
    expect(() =>
      parseJudgement(response, [label()], [topic(), topic()]),
    ).toThrow("Invalid Topic judgement");
  },
);

const decisions = ["a", "b", "c"].flatMap((deck) =>
  Array.from({ length: 8 }, (_, index) => ({
    deck,
    topicId: index,
    labelId: index < 4 ? 0 : null,
  })),
);
it("samples both decisions evenly across decks, reproducibly for a seed", () => {
  const sample = calibrationSample(decisions, 6, 42);
  expect(sample).toEqual(calibrationSample(decisions, 6, 42));
  expect(sample).toHaveLength(6);
  expect(new Set(sample).size).toBe(6);
  expect(sample.filter((d) => d.labelId !== null)).toHaveLength(3);
  expect(
    ["a", "b", "c"].map((deck) => sample.filter((d) => d.deck === deck).length),
  ).toEqual([2, 2, 2]);
  expect(sample).not.toEqual(calibrationSample(decisions, 6, 7));
});

it("fills from the remaining stratum and returns all candidates when fewer than n exist", () => {
  const few = [decisions[0]!, ...decisions.filter((d) => d.labelId === null)];
  expect(calibrationSample(few, 50, 42)).toHaveLength(13);
  expect(new Set(calibrationSample(few, 50, 42))).toEqual(new Set(few));
  expect(calibrationSample([], 50, 42)).toEqual([]);
  expect(calibrationSample(few, 0, 42)).toEqual([]);
});
