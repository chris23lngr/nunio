export type LevelAttempt = {
  at: Date;
  /** Null while ungraded: such an Attempt says nothing yet. */
  verdict: "correct" | "partial" | "incorrect" | null;
  topicIds: string[];
};
export type Level = "not_studied" | "weak" | "shaky" | "solid";
export type LevelSelfAssessment = {
  at: Date;
  level: Level;
  topicId: string;
};
export type TopicLevel = {
  topicId: string;
  level: Level;
  /** Shown beside the Level only; it never moves it. */
  latestAttempt: {
    verdict: "correct" | "partial" | "incorrect";
    at: Date;
  } | null;
  lastEvidenceAt: Date | null;
};

const newestFirst = <T extends { at: Date }>(rows: T[]) =>
  [...rows].sort((a, b) => b.at.getTime() - a.at.getTime());

/**
 * One Topic's Understanding Level (GLOSSARY.md, ADR-0023): the student's latest Self-assessment, not studied without
 * one. Attempts never move it, and neither does time (ADR-0002).
 */
export function levelOf(
  topicId: string,
  attempts: LevelAttempt[],
  selfAssessments: LevelSelfAssessment[],
): TopicLevel {
  const graded = newestFirst(attempts).find(
    (a) => a.verdict && a.topicIds.includes(topicId),
  );
  const self = newestFirst(
    selfAssessments.filter((s) => s.topicId === topicId),
  )[0];
  const latest = [graded?.at, self?.at].filter((at) => at !== undefined);
  return {
    topicId,
    level: self?.level ?? "not_studied",
    latestAttempt: graded?.verdict
      ? { verdict: graded.verdict, at: graded.at }
      : null,
    lastEvidenceAt: latest.length
      ? new Date(Math.max(...latest.map((at) => at.getTime())))
      : null,
  };
}
