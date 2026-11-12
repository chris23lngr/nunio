import { expect, it } from "vitest";
import { parseTopicLabels } from "./labels.js";

const file = (...rows: string[]) =>
  [
    "# dhbw-digitaltechnik",
    "",
    "Kurs: Digitaltechnik",
    "",
    "| Konzept | Aliase | Seiten | optional | nur Abbildung |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");

it("turns each row into a Topic label of the file's Course", () => {
  expect(
    parseTopicLabels(
      file(
        "| Quantisierung | Quantization; Quantisierungen | 3, 5–7 | | ja |",
        "| Abtastung | | 4 | ja | |",
      ),
    ),
  ).toEqual([
    {
      course: "Digitaltechnik",
      aliases: ["Quantisierung", "Quantization", "Quantisierungen"],
      pages: [3, 5, 6, 7],
      optional: false,
      figureOnly: true,
    },
    {
      course: "Digitaltechnik",
      aliases: ["Abtastung"],
      pages: [4],
      optional: true,
      figureOnly: false,
    },
  ]);
});

it.each([
  ["too few cells", "| Quantisierung | | 3 |"],
  ["no page", "| Quantisierung | | | | |"],
  ["unreadable pages", "| Quantisierung | | drei | | |"],
  ["a boolean other than ja", "| Quantisierung | | 3 | nein | |"],
  ["no concept", "| | Quantization | 3 | | |"],
])("rejects a row with %s, naming its line", (_, row) => {
  expect(() => parseTopicLabels(file(row))).toThrow("line 7");
});

it("rejects a concept labelled twice, naming the second line", () => {
  expect(() =>
    parseTopicLabels(
      file("| Quantisierung | | 3 | | |", "| quantisierung | | 5 | | |"),
    ),
  ).toThrow("line 8");
});

it("rejects an empty alias between separators, naming its line", () => {
  expect(() =>
    parseTopicLabels(file("| Quantisierung | Quantization; ; | 3 | | |")),
  ).toThrow("line 7");
});
