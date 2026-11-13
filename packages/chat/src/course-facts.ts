import type { Artifacts } from "@nunio/artifacts";
import type { Principal } from "@nunio/delegation";
import type { KnowledgeReader } from "@nunio/knowledge";
import type { Understanding } from "@nunio/understanding";
import type { Tool } from "ai";
import { jsonSchema, tool } from "ai";
import type { ContextCourse } from "./context.js";
import type { Turn } from "./turn.js";
import { fenced } from "./turn.js";

/** What the student sees of a reading of a Course's Facts: which Course, and how many. */
export type CourseFactsOutput = { course: string; facts: number };

/**
 * Reads what nunio knows about one of the student's Courses (ADR-0020), each Fact with the tag to cite it by. The
 * model names the Course by the handle the context message gave it.
 */
export function courseFactsTool(
  turn: Turn,
  {
    reader,
    understanding,
    artifacts,
    p,
    timeZone,
    courses,
  }: {
    reader: KnowledgeReader;
    understanding: Pick<Understanding, "levels">;
    artifacts: Pick<Artifacts, "list">;
    p: Principal;
    timeZone: string;
    /** The student's Courses by handle, as the context message lists them. */
    courses: ReadonlyMap<string, ContextCourse>;
  },
): Tool<{ course: string }, CourseFactsOutput> {
  /** A day as YYYY-MM-DD in the student's time zone. */
  const day = new Intl.DateTimeFormat("en-CA", { timeZone });
  return tool({
    description:
      "Reads what nunio knows about one of the student's Courses: its Obligations, exam logistics, course rules, AI-use Rule and Topics, each with the tag to cite it by; then each Topic's Understanding Level, and the practice sets and flashcards made on its Topics.",
    inputSchema: jsonSchema<{ course: string }>({
      type: "object",
      properties: {
        course: {
          type: "string",
          pattern: "^K\\d+$",
          description:
            "The Course's handle from the context message, such as K1.",
        },
      },
      required: ["course"],
      additionalProperties: false,
    }),
    execute: async ({ course }, { toolCallId }) => {
      const known = courses.get(course);
      if (!known)
        throw new Error(
          `No Course has the handle ${course}; use one from the context message.`,
        );
      const retrieval = await reader.retrieve(
        p,
        { planning: true },
        {
          kind: "facts",
          types: [
            "obligation",
            "exam_logistics",
            "course_rule",
            "ai_use_rule",
            "topic",
          ],
          narrow: { courseIds: [known.id] },
        },
      );
      if (retrieval.status === "refused")
        throw turn.refuse(
          retrieval.reason === "not_owner" ? "gone" : retrieval.reason,
        );
      const facts = retrieval.render({ tagFor: turn.tagFor }).data;
      /** The Course's Topics by ID, with the tag the model names them by. */
      const topicTags = new Map(
        retrieval.items.flatMap((item) =>
          item.kind === "fact" && item.type === "topic"
            ? [[item.factId, turn.tagFor(item.cite)] as const]
            : [],
        ),
      );
      const [levels, made] = await Promise.all([
        understanding.levels(p, { courseId: known.id }),
        artifacts.list(p, {}),
      ]);
      const levelLines = levels.flatMap((level) => {
        const tag = topicTags.get(level.topicId);
        if (!tag) return [];
        const shown = `[${tag}] ${level.level.replaceAll("_", " ")}`;
        if (!level.lastEvidenceAt) return [shown];
        const evidence = [
          `Attempts: ${level.fromAttempts ?? "none"}`,
          `Self-assessment: ${level.selfAssessment ?? "none"}`,
          `last Evidence ${day.format(level.lastEvidenceAt)}`,
        ];
        return [`${shown} (${evidence.join(", ")})`];
      });
      // Only practice and flashcards, never their content; a withdrawn one has none left (ADR-0021).
      const artifactLines = made.flatMap((artifact) => {
        const tags = artifact.topicIds.flatMap((id) => {
          const tag = topicTags.get(id);
          return tag ? [`[${tag}]`] : [];
        });
        if (
          artifact.withdrawn ||
          !tags.length ||
          (artifact.kind !== "practice_set" && artifact.kind !== "flashcards")
        )
          return [];
        return [
          [
            artifact.kind === "practice_set" ? "practice set" : "flashcards",
            artifact.status,
            artifact.openedAt ? "opened" : "not opened",
            `made ${day.format(artifact.createdAt)}`,
            `Topics ${tags.join(" ")}`,
          ].join(", "),
        ];
      });
      turn.give(
        toolCallId,
        [
          facts,
          fenced("understanding_levels", levelLines),
          fenced("artifacts", artifactLines),
        ].join("\n\n"),
      );
      for (const item of retrieval.items)
        if (item.provenance.kind === "source")
          turn.sources.add(item.provenance.sourceId);
      return { course: known.title, facts: retrieval.items.length };
    },
    toModelOutput: turn.modelOutput,
  });
}
