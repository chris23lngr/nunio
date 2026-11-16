import { describe, expect, it } from "vitest";
import type { LevelAttempt, LevelSelfAssessment } from "./levels.js";
import { levelOf } from "./levels.js";

const day = (n: number) =>
  new Date(`2026-11-${String(n).padStart(2, "0")}T10:00:00Z`);
const attempt = (
  n: number,
  verdict: LevelAttempt["verdict"],
  topicIds = ["t1"],
): LevelAttempt => ({ at: day(n), verdict, topicIds });
const self = (
  n: number,
  level: LevelSelfAssessment["level"],
  topicId = "t1",
): LevelSelfAssessment => ({ at: day(n), level, topicId });

describe("levelOf", () => {
  it.each<[string, LevelAttempt[], LevelSelfAssessment[], string]>([
    ["no Evidence at all", [], [], "not_studied"],
    [
      "only Attempts, which never set the Level",
      [attempt(1, "correct"), attempt(2, "correct")],
      [],
      "not_studied",
    ],
    ["a weak Self-assessment", [], [self(1, "weak")], "weak"],
    [
      "a solid Self-assessment against incorrect Attempts",
      [attempt(1, "incorrect"), attempt(2, "incorrect")],
      [self(3, "solid")],
      "solid",
    ],
    [
      "the latest of several Self-assessments, by time",
      [],
      [self(4, "shaky"), self(1, "solid"), self(2, "weak")],
      "shaky",
    ],
    [
      "a Self-assessment back to not studied",
      [],
      [self(1, "solid"), self(2, "not_studied")],
      "not_studied",
    ],
    [
      "Evidence about another Topic only",
      [attempt(1, "correct", ["t2"])],
      [self(2, "solid", "t2")],
      "not_studied",
    ],
  ])("%s", (_, attempts, selfAssessments, level) => {
    expect(levelOf("t1", attempts, selfAssessments)).toMatchObject({
      topicId: "t1",
      level,
    });
  });

  it("shows the latest graded Attempt beside the Level, and when Evidence last supported it", () => {
    expect(
      levelOf(
        "t1",
        [
          attempt(5, "partial", ["t2", "t1"]),
          attempt(2, "correct"),
          attempt(6, null),
        ],
        [self(1, "shaky"), self(4, "solid")],
      ),
    ).toEqual({
      topicId: "t1",
      level: "solid",
      latestAttempt: { verdict: "partial", at: day(5) },
      lastEvidenceAt: day(5),
    });
    expect(levelOf("t1", [], [])).toEqual({
      topicId: "t1",
      level: "not_studied",
      latestAttempt: null,
      lastEvidenceAt: null,
    });
  });
});
