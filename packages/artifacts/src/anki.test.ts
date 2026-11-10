import { describe, expect, it } from "vitest";
import { toAnkiTsv } from "./anki.js";

// File headers and quoting follow the Anki manual, "Text Files" (docs.ankiweb.net/importing/text-files.html).
const headers = [
  "#separator:Tab",
  "#html:false",
  "#notetype:Basic",
  "#columns:Front\tBack\tTags\tGUID",
  "#tags column:3",
  "#guid column:4",
].join("\n");

describe("toAnkiTsv", () => {
  it("writes one note per card after Anki's file headers, keeping German characters as they are", () => {
    expect(
      toAnkiTsv("art-1", [
        {
          id: "1",
          front: "Gleichmäßige Konvergenz",
          back: "Größer als ε für kein x",
          tags: ["Analysis I", "Gleichmäßige Konvergenz"],
        },
      ]),
    ).toBe(
      `${headers}\nGleichmäßige Konvergenz\tGrößer als ε für kein x\tAnalysis_I Gleichmäßige_Konvergenz\tnunio-art-1-1\n`,
    );
  });

  it.each([
    ["a tab", "Satz\tBeweis", '"Satz\tBeweis"'],
    ["a newline", "Erste Zeile\nZweite Zeile", '"Erste Zeile\nZweite Zeile"'],
    ["a carriage return", "Zeile\r\nNoch eine", '"Zeile\r\nNoch eine"'],
    ["quotes", 'Der "Satz" von Bolzano', '"Der ""Satz"" von Bolzano"'],
    ["nothing special", "Satz von Bolzano", "Satz von Bolzano"],
  ])("quotes a field with %s, doubling its quotes", (_, back, written) => {
    const row = toAnkiTsv("art-1", [
      { id: "1", front: "Vorne", back, tags: [] },
    ]).slice(headers.length + 1);

    expect(row).toBe(`Vorne\t${written}\t\tnunio-art-1-1\n`);
  });

  it("quotes a tags field whose Topic name holds a quote", () => {
    const row = toAnkiTsv("art-1", [
      { id: "1", front: "Vorne", back: "Hinten", tags: ['Der "Satz"'] },
    ]).slice(headers.length + 1);

    expect(row).toBe('Vorne\tHinten\t"Der_""Satz"""\tnunio-art-1-1\n');
  });

  it("gives each card a GUID from its Artifact and card, so a re-import updates the note however its text changed", () => {
    const before = toAnkiTsv("art-7", [
      { id: "3", front: "Alt", back: "Alt", tags: [] },
    ]);
    const after = toAnkiTsv("art-7", [
      { id: "3", front: "Neu", back: "Neu", tags: ["Neu"] },
    ]);

    expect(before.trimEnd().split("\t").at(-1)).toBe("nunio-art-7-3");
    expect(after.trimEnd().split("\t").at(-1)).toBe("nunio-art-7-3");
  });
});
