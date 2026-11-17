import { expect, it } from "vitest";
import { calibrationSample, parseJudgement, scoreTopics } from "./topics.js";

const label = (overrides = {}) => ({
  course: "analysis",
  aliases: ["uniform convergence"],
  places: [{ document: "vl-01", pages: [1] }],
  optional: false,
  ...overrides,
});
const topic = (course = "analysis", documents = ["vl-01"]) => ({
  course,
  key: "Konvergenz",
  value: "Konvergenz",
  documents,
});

it("uses judged matches once and only within their Course, counting repeats as duplicates", () => {
  expect(
    scoreTopics([label()], [topic("other"), topic(), topic()], [0, 0, 0]),
  ).toEqual({
    labelled: 1,
    extracted: 3,
    scored: 3,
    matched: 1,
    precision: 1 / 3,
    recall: 1,
    duplicates: 1,
    logistics: [],
  });
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

it("counts unmatched Topics citing each logistics document", () => {
  expect(
    scoreTopics(
      [label()],
      [
        topic("analysis", ["organisation", "vl-01"]),
        topic("analysis", ["organisation"]),
        topic("analysis", ["organisation", "vl-01"]),
        topic("analysis", ["vl-01"]),
      ],
      [0, null, null, null],
      ["organisation", "einfuehrung"],
    ).logistics,
  ).toEqual([
    { document: "organisation", falseTopics: 2 },
    { document: "einfuehrung", falseTopics: 0 },
  ]);
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
