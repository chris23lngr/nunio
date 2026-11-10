export type LevelAttempt = {
  at: Date;
  /** Null while ungraded: such an Attempt says nothing yet. */
  verdict: "correct" | "partial" | "incorrect" | null;
  topicIds: string[];
};
export type LevelSelfAssessment = {
  at: Date;
  level: "shaky" | "solid";
  topicId: string;
};
export type TopicLevel = {
  topicId: string;
  level: "not_yet_practiced" | "shaky" | "solid" | "disputed";
  /** What the Attempts alone show; disputed is this against the Self-assessment. */
  fromAttempts: "shaky" | "solid" | null;
  selfAssessment: "shaky" | "solid" | null;
  lastEvidenceAt: Date | null;
};

const newestFirst = <T extends { at: Date }>(rows: T[]) =>
  [...rows].sort((a, b) => b.at.getTime() - a.at.getTime());

/**
 * One Topic's Understanding Level (GLOSSARY.md, ADR-0002). Only graded Attempts move it: solid when the two most
 * recent are correct, shaky otherwise; a Self-assessment that differs from them makes it disputed. Time never does.
 */
export function levelOf(
  topicId: string,
  attempts: LevelAttempt[],
  selfAssessments: LevelSelfAssessment[],
): TopicLevel {
  const graded = newestFirst(
    attempts.filter((a) => a.verdict && a.topicIds.includes(topicId)),
  );
  const self = newestFirst(
    selfAssessments.filter((s) => s.topicId === topicId),
  )[0];
  const fromAttempts = !graded.length
    ? null
    : graded.length >= 2 &&
        graded.slice(0, 2).every((a) => a.verdict === "correct")
      ? "solid"
      : "shaky";
  const latest = [graded[0]?.at, self?.at].filter((at) => at !== undefined);
  return {
    topicId,
    level: !fromAttempts
      ? "not_yet_practiced"
      : self && self.level !== fromAttempts
        ? "disputed"
        : fromAttempts,
    fromAttempts,
    selfAssessment: self?.level ?? null,
    lastEvidenceAt: latest.length
      ? new Date(Math.max(...latest.map((at) => at.getTime())))
      : null,
  };
}
