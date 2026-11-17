import { expect, it } from "vitest";
import { parseCourseLabels } from "./labels.js";

const sha = (digit: string) => digit.repeat(64);
const file = (...rows: string[]) =>
  [
    "Kurs: Signale und Systeme",
    "",
    "| ID | SHA-256 | Art |",
    "| --- | --- | --- |",
    `| einfuehrung | ${sha("a")} | organisation |`,
    `| modul | ${sha("b")} | modul |`,
    `| vl-01 | ${sha("c")} | folien |`,
    "",
    "| Thema | Aliase | Fundstellen | optional |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");

it("reads a Course's documents in upload order and its Topics with their places", () => {
  expect(
    parseCourseLabels(
      file(
        "| Fourier-Transformation | Fouriertransformation; Fourier transform | modul 2; vl-01 4–6, 9 | |",
        "| Fensterfunktionen | | vl-01 16 | ja |",
      ),
    ),
  ).toEqual({
    course: "Signale und Systeme",
    documents: [
      { id: "einfuehrung", sha256: sha("a"), kind: "organisation" },
      { id: "modul", sha256: sha("b"), kind: "modul" },
      { id: "vl-01", sha256: sha("c"), kind: "folien" },
    ],
    topics: [
      {
        course: "Signale und Systeme",
        aliases: [
          "Fourier-Transformation",
          "Fouriertransformation",
          "Fourier transform",
        ],
        places: [
          { document: "modul", pages: [2] },
          { document: "vl-01", pages: [4, 5, 6, 9] },
        ],
        optional: false,
      },
      {
        course: "Signale und Systeme",
        aliases: ["Fensterfunktionen"],
        places: [{ document: "vl-01", pages: [16] }],
        optional: true,
      },
    ],
  });
});

it.each([
  ["too few cells", "| Fourier-Transformation | | vl-01 4 |"],
  ["no Thema", "| | Fourier transform | vl-01 4 | |"],
  ["an empty alias", "| Fourier-Transformation | Fourier; ; | vl-01 4 | |"],
  ["no Fundstelle", "| Fourier-Transformation | | | |"],
  ["a Fundstelle without pages", "| Fourier-Transformation | | vl-01 | |"],
  ["unreadable pages", "| Fourier-Transformation | | vl-01 vier | |"],
  ["a reversed page range", "| Fourier-Transformation | | vl-01 7–5 | |"],
  ["page 0", "| Fourier-Transformation | | vl-01 0 | |"],
  ["an unknown document", "| Fourier-Transformation | | vl-09 4 | |"],
  ["a boolean other than ja", "| Fourier-Transformation | | vl-01 4 | nein |"],
])("rejects a Topic row with %s, naming its line", (_, row) => {
  expect(() => parseCourseLabels(file(row))).toThrow("line 11");
});

it("rejects a Thema labelled twice, naming the second line", () => {
  expect(() =>
    parseCourseLabels(
      file(
        "| Fourier-Transformation | | vl-01 4 | |",
        "| fourier-transformation | | vl-01 5 | |",
      ),
    ),
  ).toThrow("line 12");
});

it.each([
  ["too few cells", `| vl-02 | ${sha("d")} |`],
  ["a malformed SHA-256", "| vl-02 | abc | folien |"],
  ["an unknown Art", `| vl-02 | ${sha("d")} | skript |`],
  ["a repeated ID", `| vl-01 | ${sha("d")} | folien |`],
])("rejects a document row with %s, naming its line", (_, row) => {
  const text = file().replace("\n\n| Thema", `\n${row}\n\n| Thema`);
  expect(() => parseCourseLabels(text)).toThrow("line 8");
});
