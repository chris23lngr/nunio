import { randomUUID } from "node:crypto";
import type { Grader } from "@nunio/ai";
import type { Artifacts } from "@nunio/artifacts";
import type { PrismaClient } from "@nunio/db";
import type { Delegation, Metered, Principal } from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import type {
  Citation,
  Facts,
  KnowledgeReader,
  Provenance,
} from "@nunio/knowledge";
import { createDerivedText, definitely } from "@nunio/knowledge";
import type { LevelAttempt, TopicLevel } from "./levels.js";
import { levelOf } from "./levels.js";

export type AttemptView = {
  id: string;
  artifactId: string;
  itemId: string;
  topicIds: string[];
  text: string;
  verdict: "correct" | "partial" | "incorrect" | null;
  /** Null while ungraded, and once a Source of its practice set is deleted. */
  feedback: {
    text: string;
    citations: { tag: string; provenance: Provenance | "gone" }[];
  } | null;
  /** Why it is ungraded, such as a spent Allowance; null once graded. */
  ungradedReason: UngradedReason | null;
  createdAt: Date;
};

/** Why grading an Attempt failed: the grader failed, or the metering refused it. */
export type UngradedReason =
  | "grader_failed"
  | Extract<Metered<unknown>, { status: "refused" }>["reason"];

/** One piece of Evidence about a Topic. */
export type EvidenceView =
  | { kind: "attempt"; attempt: AttemptView }
  | { kind: "self_assessment"; level: "shaky" | "solid"; at: Date };

/** Attempts, Feedback, Self-assessments and Understanding Levels. The only module that records Evidence. */
export function createUnderstanding({
  db,
  keys,
  artifacts,
  reader,
  facts,
  delegation,
  grader,
  clock,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  artifacts: Artifacts;
  /** Resolves Feedback citations when shown. */
  reader: KnowledgeReader;
  facts: Facts;
  delegation: Delegation;
  grader: Grader;
  clock: { now(): Date };
}) {
  const derived = createDerivedText(keys);
  /** The student's Topics that are not rejected, by Course. */
  async function topicsOf(p: Principal) {
    return (await facts.review(p)).courses
      .filter((course) => course.status !== "rejected")
      .flatMap((course) =>
        course.facts
          .filter((fact) => fact.type === "topic" && fact.state !== "rejected")
          .map((fact) => ({ id: fact.id, courseId: course.id })),
      );
  }
  /** The Understanding Level of each of the given Topics, from the student's Evidence. */
  async function levelsOfTopics(
    student: Principal,
    topicIds: string[],
  ): Promise<TopicLevel[]> {
    const [attempts, selfAssessments] = await withOwner(db, student, (tx) =>
      Promise.all([
        tx.practiceAttempt.findMany({
          where: { topicIds: { hasSome: topicIds } },
        }),
        tx.selfAssessment.findMany({ where: { topicId: { in: topicIds } } }),
      ]),
    );
    return topicIds.map((topicId) =>
      levelOf(
        topicId,
        attempts.map((a) => ({
          at: a.createdAt,
          verdict: a.verdict as LevelAttempt["verdict"],
          topicIds: a.topicIds,
        })),
        selfAssessments.map((s) => ({
          at: s.createdAt,
          level: s.level as "shaky" | "solid",
          topicId: s.topicId,
        })),
      ),
    );
  }
  /** The student's Attempts, newest first; Feedback whose practice set lost a Source shows as gone. */
  async function attemptsWhere(
    student: Principal,
    where: { topicIds: { has: string } } | { artifactId: string },
  ): Promise<AttemptView[]> {
    const opened = await withOwner(db, student, async (tx) => {
      const rows = await tx.practiceAttempt.findMany({
        where,
        orderBy: { createdAt: "desc" },
      });
      return Promise.all(
        rows.map(async (row) => ({
          row,
          feedback:
            row.feedback &&
            (await derived.open(tx, row.id, {
              content: row.feedback,
              contentKey: row.feedbackKey,
              derivedFrom: row.derivedFrom,
            })),
        })),
      );
    });
    const provenance = await reader.cite(
      student,
      opened.flatMap(({ row, feedback }) =>
        feedback ? (row.citations as Citation[]).map((c) => c.cite) : [],
      ),
    );
    return opened.map(({ row, feedback }) => ({
      id: row.id,
      artifactId: row.artifactId,
      itemId: row.itemId,
      topicIds: row.topicIds,
      text: row.text,
      verdict: row.verdict as AttemptView["verdict"],
      feedback: feedback
        ? {
            text: feedback,
            citations: (row.citations as Citation[]).map(({ tag, cite }) => ({
              tag,
              provenance: provenance.get(cite) ?? "gone",
            })),
          }
        : null,
      ungradedReason: row.ungradedReason as UngradedReason | null,
      createdAt: row.createdAt,
    }));
  }
  /**
   * Grades a recorded Attempt against its Practice Item and seals the Feedback under the item's Sources. A failed
   * grading keeps the Attempt, ungraded and not counting, with why.
   */
  async function gradeAttempt(
    student: Principal,
    row: Omit<AttemptView, "verdict" | "feedback" | "ungradedReason">,
    item: Exclude<Awaited<ReturnType<Artifacts["practiceItem"]>>, "gone">,
  ): Promise<AttemptView> {
    const attemptId = row.id;
    const view: AttemptView = {
      ...row,
      verdict: null,
      feedback: null,
      ungradedReason: null,
    };
    const ungraded = async (reason: UngradedReason) => {
      await withOwner(db, student, (tx) =>
        tx.practiceAttempt.update({
          where: { id: attemptId },
          data: { ungradedReason: reason },
        }),
      );
      return { ...view, ungradedReason: reason };
    };
    const input = {
      question: item.question,
      answer: item.answer,
      attempt: row.text,
      tags: item.citations.map((citation) => citation.tag),
    };
    let graded: Awaited<ReturnType<typeof meterGrading>>;
    try {
      graded = await meterGrading(student, input);
    } catch {
      return ungraded("grader_failed");
    }
    if (graded.status !== "ok") return ungraded(graded.reason);
    const citations: Citation[] = graded.value.cited.flatMap((tag) =>
      item.citations.filter((citation) => citation.tag === tag),
    );
    // A Source deleted while grading takes the Feedback with it; the verdict is structure, and still counts.
    const sealed = await withOwner(db, student, async (tx) => {
      const sealed = await derived.seal(
        tx,
        attemptId,
        item.derivedFrom,
        graded.value.text,
      );
      await tx.practiceAttempt.update({
        where: { id: attemptId },
        data: {
          verdict: graded.value.verdict,
          ...(sealed
            ? {
                feedback: sealed.content,
                feedbackKey: sealed.contentKey,
                derivedFrom: sealed.derivedFrom,
                citations,
              }
            : {}),
          gradedAt: clock.now(),
        },
      });
      return sealed;
    });
    const provenance = await reader.cite(
      student,
      citations.map((citation) => citation.cite),
    );
    return {
      ...view,
      verdict: graded.value.verdict,
      feedback: sealed && {
        text: graded.value.text,
        citations: citations.map(({ tag, cite }) => ({
          tag,
          provenance: provenance.get(cite) ?? "gone",
        })),
      },
    };
  }
  const meterGrading = (
    student: Principal,
    input: Parameters<Grader["grade"]>[0],
  ) =>
    delegation.meter(
      student,
      { microUsd: grader.estimateMicroUsd(input) },
      (signal) => definitely(() => grader.grade(input, { signal })),
    );
  return {
    /**
     * Records the student's Attempts on several Practice Items of one practice set, then grades them together. An
     * item that is not in the set refuses them all; a failed grading keeps that Attempt, ungraded and not counting.
     */
    async answer(
      student: Principal,
      artifactId: string,
      answers: { itemId: string; text: string }[],
    ): Promise<
      | { status: "answered"; attempts: AttemptView[] }
      | { status: "refused"; reason: "gone" }
    > {
      const found = await Promise.all(
        answers.map(({ itemId }) =>
          artifacts.practiceItem(student, { artifactId, itemId }),
        ),
      );
      const items = found.flatMap((item) => (item === "gone" ? [] : [item]));
      if (!answers.length || items.length < answers.length)
        return { status: "refused", reason: "gone" };
      const rows = answers.map(({ itemId, text }, i) => ({
        id: randomUUID(),
        artifactId,
        itemId,
        topicIds: items[i]!.topicIds,
        text,
        createdAt: clock.now(),
      }));
      await withOwner(db, student, (tx, studentId) =>
        tx.practiceAttempt.createMany({
          data: rows.map((row) => ({ ...row, studentId })),
        }),
      );
      const attempts = await Promise.all(
        rows.map((row, i) => gradeAttempt(student, row, items[i]!)),
      );
      return { status: "answered", attempts };
    },
    /** The student's own statement about a Topic, kept beside its Level; it never moves the Level itself. */
    async selfAssess(
      student: Principal,
      topicId: string,
      level: "shaky" | "solid",
    ): Promise<{ status: "ok" | "gone" }> {
      if (!(await topicsOf(student)).some((topic) => topic.id === topicId))
        return { status: "gone" };
      await withOwner(db, student, (tx, studentId) =>
        tx.selfAssessment.create({
          data: {
            id: randomUUID(),
            studentId,
            topicId,
            level,
            createdAt: clock.now(),
          },
        }),
      );
      return { status: "ok" };
    },
    /** The Understanding Level of each of a Course's Topics, from the student's Evidence. */
    async levels(
      student: Principal,
      q: { courseId: string },
    ): Promise<TopicLevel[]> {
      return levelsOfTopics(
        student,
        (await topicsOf(student))
          .filter((topic) => topic.courseId === q.courseId)
          .map((topic) => topic.id),
      );
    },
    levelsOfTopics,
    /** The latest Attempt on each Practice Item of a practice set that the student answered. */
    async latestAttempts(
      student: Principal,
      artifactId: string,
    ): Promise<AttemptView[] | "gone"> {
      if (!(await artifacts.owns(student, artifactId))) return "gone";
      const latest = new Map<string, AttemptView>();
      for (const attempt of await attemptsWhere(student, { artifactId }))
        if (!latest.has(attempt.itemId)) latest.set(attempt.itemId, attempt);
      return [...latest.values()];
    },
    /** A Topic's Evidence, newest first; Feedback whose practice set lost a Source shows as gone. */
    async history(
      student: Principal,
      topicId: string,
    ): Promise<EvidenceView[]> {
      const attempts = await attemptsWhere(student, {
        topicIds: { has: topicId },
      });
      const selfAssessments = await withOwner(db, student, (tx) =>
        tx.selfAssessment.findMany({ where: { topicId } }),
      );
      const evidence: (EvidenceView & { sortAt: Date })[] = [
        ...attempts.map((attempt) => ({
          kind: "attempt" as const,
          sortAt: attempt.createdAt,
          attempt,
        })),
        ...selfAssessments.map((row) => ({
          kind: "self_assessment" as const,
          sortAt: row.createdAt,
          level: row.level as "shaky" | "solid",
          at: row.createdAt,
        })),
      ];
      return evidence
        .sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime())
        .map(({ sortAt: _, ...view }) => view);
    },
  };
}
export type Understanding = ReturnType<typeof createUnderstanding>;
