import { randomUUID } from "node:crypto";
import type { Grader } from "@nunio/ai";
import type { Artifacts } from "@nunio/artifacts";
import type { PrismaClient } from "@nunio/db";
import type { Delegation, Principal } from "@nunio/delegation";
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
  createdAt: Date;
};

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
  /** Grades a recorded Attempt against its Practice Item and seals the Feedback under the item's Sources. */
  async function gradeAttempt(student: Principal, attemptId: string) {
    const row = await withOwner(db, student, (tx) =>
      tx.practiceAttempt.findUnique({ where: { id: attemptId } }),
    );
    if (!row) return "gone" as const;
    const item = await artifacts.practiceItem(student, row);
    if (item === "gone") return "gone" as const;
    const view: AttemptView = {
      id: row.id,
      artifactId: row.artifactId,
      itemId: row.itemId,
      topicIds: row.topicIds,
      text: row.text,
      verdict: null,
      feedback: null,
      createdAt: row.createdAt,
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
      return { status: "ungraded", reason: "grader_failed", view } as const;
    }
    if (graded.status !== "ok")
      return { status: "ungraded", reason: graded.reason, view } as const;
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
      status: "graded",
      attempt: {
        ...view,
        verdict: graded.value.verdict,
        feedback: sealed && {
          text: graded.value.text,
          citations: citations.map(({ tag, cite }) => ({
            tag,
            provenance: provenance.get(cite) ?? "gone",
          })),
        },
      },
    } as const;
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
     * Records the student's Attempt on a Practice Item, then grades it. A failed grading keeps the Attempt, ungraded
     * and not counting, until `grade` succeeds.
     */
    async attempt(
      student: Principal,
      ref: { artifactId: string; itemId: string },
      text: string,
    ) {
      const item = await artifacts.practiceItem(student, ref);
      if (item === "gone")
        return { status: "refused", reason: "gone" } as const;
      const id = randomUUID();
      await withOwner(db, student, (tx, studentId) =>
        tx.practiceAttempt.create({
          data: {
            id,
            studentId,
            ...ref,
            topicIds: item.topicIds,
            text,
            createdAt: clock.now(),
          },
        }),
      );
      const graded = await gradeAttempt(student, id);
      if (graded === "gone" || graded.status === "ungraded")
        return {
          status: "ungraded",
          attemptId: id,
          reason: graded === "gone" ? "gone" : graded.reason,
        } as const;
      return graded;
    },
    /** Grades an Attempt again, such as an ungraded one; metered again. */
    async grade(
      student: Principal,
      attemptId: string,
    ): Promise<AttemptView | "gone"> {
      const graded = await gradeAttempt(student, attemptId);
      if (graded === "gone") return "gone";
      return graded.status === "graded" ? graded.attempt : graded.view;
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
      const topicIds = (await topicsOf(student))
        .filter((topic) => topic.courseId === q.courseId)
        .map((topic) => topic.id);
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
    },
    /** A Topic's Evidence, newest first; Feedback whose practice set lost a Source shows as gone. */
    async history(
      student: Principal,
      topicId: string,
    ): Promise<EvidenceView[]> {
      const { attempts, selfAssessments } = await withOwner(
        db,
        student,
        async (tx) => {
          const rows = await tx.practiceAttempt.findMany({
            where: { topicIds: { has: topicId } },
          });
          return {
            attempts: await Promise.all(
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
            ),
            selfAssessments: await tx.selfAssessment.findMany({
              where: { topicId },
            }),
          };
        },
      );
      const provenance = await reader.cite(
        student,
        attempts.flatMap(({ row, feedback }) =>
          feedback ? (row.citations as Citation[]).map((c) => c.cite) : [],
        ),
      );
      const evidence: (EvidenceView & { sortAt: Date })[] = [
        ...attempts.map(({ row, feedback }) => ({
          kind: "attempt" as const,
          sortAt: row.createdAt,
          attempt: {
            id: row.id,
            artifactId: row.artifactId,
            itemId: row.itemId,
            topicIds: row.topicIds,
            text: row.text,
            verdict: row.verdict as AttemptView["verdict"],
            feedback: feedback
              ? {
                  text: feedback,
                  citations: (row.citations as Citation[]).map(
                    ({ tag, cite }) => ({
                      tag,
                      provenance: provenance.get(cite) ?? "gone",
                    }),
                  ),
                }
              : null,
            createdAt: row.createdAt,
          },
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
