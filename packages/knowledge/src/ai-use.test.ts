import { describe, expect, it } from "vitest";
import type { AiUseRuleItem } from "./ai-use.js";
import { resolveAiUse } from "./ai-use.js";

const rule = (
  value: string,
  overrides: Partial<AiUseRuleItem> = {},
): AiUseRuleItem => ({
  value,
  uncertainty: null,
  disagreement: false,
  provenance: {
    kind: "source",
    sourceId: "syllabus",
    title: "Syllabus",
    page: 2,
    quote: `AI is ${value}.`,
  },
  ...overrides,
});

describe("resolveAiUse", () => {
  it.each([
    ["no rule anywhere", undefined, undefined, "unknown"],
    ["only the Course's rule", undefined, rule("forbidden"), "forbidden"],
    ["only the Obligation's rule", rule("allowed"), undefined, "allowed"],
    [
      "the Obligation's rule over the Course's",
      rule("conditional"),
      rule("forbidden"),
      "conditional",
    ],
    [
      "an uncertain Obligation rule, without falling back to the Course",
      rule("allowed", { uncertainty: "Only for the coding part?" }),
      rule("forbidden"),
      "unknown",
    ],
    [
      "a disputed rule",
      undefined,
      rule("allowed", { disagreement: true }),
      "unknown",
    ],
    ["a value that is not a class", undefined, rule("sometimes"), "unknown"],
  ])("%s", (_, obligationRule, courseRule, status) => {
    expect(resolveAiUse(obligationRule, courseRule).status).toBe(status);
  });

  it("says why it is unknown", () => {
    expect(resolveAiUse(undefined, undefined)).toEqual({
      status: "unknown",
      reason: "none",
    });
    expect(
      resolveAiUse(rule("allowed", { disagreement: true }), undefined),
    ).toEqual({ status: "unknown", reason: "disagreement" });
    expect(
      resolveAiUse(undefined, rule("allowed", { uncertainty: "?" })),
    ).toEqual({ status: "unknown", reason: "uncertain" });
  });

  it("quotes the Source's wording, and shows none for the student's own value", () => {
    const fromSource = resolveAiUse(undefined, rule("conditional"));
    if (fromSource.status === "unknown") throw new Error("unknown");
    expect(fromSource).toMatchObject({
      level: "course",
      provenance: {
        kind: "source",
        sourceId: "syllabus",
        title: "Syllabus",
        page: 2,
      },
    });
    expect(fromSource.text).toBe("AI is conditional.");
    expect(
      resolveAiUse(
        rule("forbidden", { provenance: { kind: "correction" } }),
        undefined,
      ),
    ).toEqual({
      status: "forbidden",
      level: "obligation",
      text: null,
      provenance: { kind: "correction" },
    });
  });
});
