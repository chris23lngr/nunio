import { describe, expect, it } from "vitest";
import { summaryOf } from "./agent-runs.js";

describe("an Agent Run's summary", () => {
  it("is plain text without links, citation tags or Markdown", () => {
    expect(
      summaryOf(
        "## Ergebnis\n**Deine Klausur** ist am 3. März [S2]. Mehr: https://example.com/a  und www.example.com",
      ),
    ).toBe("Ergebnis\nDeine Klausur ist am 3. März. Mehr: und");
  });

  it("is cut to at most 600 characters, at a word", () => {
    const summary = summaryOf("Wort ".repeat(200));

    expect(summary.length).toBeLessThanOrEqual(600);
    expect(summary.endsWith(" Wort…")).toBe(true);
  });
});
