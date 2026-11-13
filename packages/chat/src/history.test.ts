import { expect, it } from "vitest";
import { historyFrom } from "./history.js";

const turn = (n: number, derivedFrom: string[] = []) => [
  { role: "student" as const, text: `Frage ${n}`, derivedFrom: [] },
  { role: "assistant" as const, text: `Antwort ${n}`, derivedFrom },
];

it("keeps the last 10 questions and answers, oldest first", () => {
  const messages = Array.from({ length: 12 }, (_, i) => turn(i + 1)).flat();

  const { turns } = historyFrom(messages);

  expect(turns).toHaveLength(10);
  expect(turns[0]).toEqual({ question: "Frage 3", answer: "Antwort 3" });
  expect(turns[9]).toEqual({ question: "Frage 12", answer: "Antwort 12" });
});

it("leaves out a withdrawn answer together with its question, and the Sources it drew on", () => {
  const [question, answer] = turn(2, ["deleted-source"]);
  const messages = [
    ...turn(1),
    question!,
    { ...answer!, text: null },
    ...turn(3),
  ];

  expect(historyFrom(messages)).toEqual({
    turns: [
      { question: "Frage 1", answer: "Antwort 1" },
      { question: "Frage 3", answer: "Antwort 3" },
    ],
    derivedFrom: [],
  });
});

it("removes citation tags, which each turn numbers anew", () => {
  const [question, answer] = turn(1);
  const messages = [
    question!,
    { ...answer!, text: "Am 10. Februar [S1], im Hörsaal 2 [S2]." },
  ];

  expect(historyFrom(messages).turns).toEqual([
    { question: "Frage 1", answer: "Am 10. Februar, im Hörsaal 2." },
  ]);
});

it("names every Source the kept answers drew on, so an answer given with them is withdrawn with them", () => {
  const messages = [
    ...turn(1, ["handbook"]),
    ...turn(2, ["handbook", "slides"]),
    ...turn(3),
  ];

  expect(historyFrom(messages).derivedFrom).toEqual(["handbook", "slides"]);
});
