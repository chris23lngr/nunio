import type { Principal } from "@nunio/delegation";
import type { KnowledgeReader } from "@nunio/knowledge";
import type { Tool } from "ai";
import { jsonSchema, tool } from "ai";
import type { ContextCourse } from "./context.js";
import type { Turn } from "./turn.js";

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
    p,
    courses,
  }: {
    reader: KnowledgeReader;
    p: Principal;
    /** The student's Courses by handle, as the context message lists them. */
    courses: ReadonlyMap<string, ContextCourse>;
  },
): Tool<{ course: string }, CourseFactsOutput> {
  return tool({
    description:
      "Reads what nunio knows about one of the student's Courses: its Obligations, exam logistics, course rules, AI-use Rule and Topics, each with the tag to cite it by.",
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
      turn.give(toolCallId, retrieval.render({ tagFor: turn.tagFor }).data);
      for (const item of retrieval.items)
        if (item.provenance.kind === "source")
          turn.sources.add(item.provenance.sourceId);
      return { course: known.title, facts: retrieval.items.length };
    },
    toModelOutput: turn.modelOutput,
  });
}
