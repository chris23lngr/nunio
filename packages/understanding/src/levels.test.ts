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
  it.each<
    [string, LevelAttempt[], LevelSelfAssessment[], string, string | null]
  >([
    ["no Evidence at all", [], [], "not_yet_practiced", null],
    [
      "only a Self-assessment, which never moves the Level",
      [],
      [self(3, "solid")],
      "not_yet_practiced",
      null,
    ],
    ["one correct Attempt", [attempt(1, "correct")], [], "shaky", "shaky"],
    [
      "the two most recent Attempts correct",
      [attempt(1, "incorrect"), attempt(2, "correct"), attempt(3, "correct")],
      [],
      "solid",
      "solid",
    ],
    [
      "a partly correct Attempt after two correct ones",
      [attempt(1, "correct"), attempt(2, "correct"), attempt(3, "partial")],
      [],
      "shaky",
      "shaky",
    ],
    [
      "an ungraded Attempt, which does not count",
      [attempt(1, "correct"), attempt(2, "correct"), attempt(3, null)],
      [],
      "solid",
      "solid",
    ],
    [
      "Attempts given out of order, the most recent by time",
      [attempt(5, "correct"), attempt(1, "incorrect"), attempt(4, "correct")],
      [],
      "solid",
      "solid",
    ],
    [
      "a solid Self-assessment against shaky Attempts",
      [attempt(1, "incorrect"), attempt(2, "correct")],
      [self(3, "solid")],
      "disputed",
      "shaky",
    ],
    [
      "a shaky Self-assessment against solid Attempts",
      [attempt(1, "correct"), attempt(2, "correct")],
      [self(3, "shaky")],
      "disputed",
      "solid",
    ],
    [
      "a newer Self-assessment that agrees with the Attempts",
      [attempt(1, "incorrect")],
      [self(2, "solid"), self(4, "shaky")],
      "shaky",
      "shaky",
    ],
    [
      "an Attempt on an item about several Topics, counting for each",
      [attempt(1, "correct", ["t2", "t1"]), attempt(2, "correct", ["t1"])],
      [],
      "solid",
      "solid",
    ],
    [
      "Evidence about another Topic only",
      [attempt(1, "correct", ["t2"])],
      [self(2, "solid", "t2")],
      "not_yet_practiced",
      null,
    ],
  ])("%s", (_, attempts, selfAssessments, level, fromAttempts) => {
    expect(levelOf("t1", attempts, selfAssessments)).toMatchObject({
      topicId: "t1",
      level,
      fromAttempts,
    });
  });

  it("shows the latest Self-assessment beside the Level, and when Evidence last supported it", () => {
    expect(
      levelOf(
        "t1",
        [attempt(2, "correct"), attempt(6, null)],
        [self(1, "shaky"), self(4, "solid")],
      ),
    ).toEqual({
      topicId: "t1",
      level: "disputed",
      fromAttempts: "shaky",
      selfAssessment: "solid",
      lastEvidenceAt: day(4),
    });
    expect(levelOf("t1", [], [])).toEqual({
      topicId: "t1",
      level: "not_yet_practiced",
      fromAttempts: null,
      selfAssessment: null,
      lastEvidenceAt: null,
    });
  });
});
