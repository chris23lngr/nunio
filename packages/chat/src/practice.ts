import { randomUUID } from "node:crypto";
import type { Principal } from "@nunio/delegation";
import type { CitationRef, KnowledgeReader } from "@nunio/knowledge";
import type { Tool } from "ai";
import { jsonSchema, tool } from "ai";
import type { Turn } from "./turn.js";

export type ArtifactKind = "practice_set" | "flashcards";
/** What the student sees of a started Artifact: its kind, how many Topics, and where to find it. */
export type ArtifactOutput = {
  kind: ArtifactKind;
  topics: number;
  artifactId: string;
};
/** The Artifact a turn starts once its answer is saved. */
export type ArtifactStart = {
  kind: ArtifactKind;
  topicIds: string[];
  artifactId: string;
};

const named: Record<ArtifactKind, string> = {
  practice_set: "a practice set",
  flashcards: "flashcards",
};

/**
 * Starts a practice set or flashcards on Topics of the Chat's selected Courses (ADR-0019), without asking: the student
 * asked for it. At most one starts per turn, and only once the answer is saved, so a failed turn starts nothing.
 */
export function startArtifactTool(
  kind: ArtifactKind,
  turn: Turn,
  {
    reader,
    p,
    chatId,
    started,
  }: {
    reader: KnowledgeReader;
    p: Principal;
    chatId: string;
    /** The turn's one Artifact, once a tool call chose it; `claimed` while one is checking. */
    started: { current?: ArtifactStart; claimed?: boolean };
  },
): Tool<{ topics: string[] }, ArtifactOutput> {
  return tool({
    description: `Starts making ${named[kind]} on Topics of this Chat's selected Courses, which the student finds under Study once made. Name the Topics by the tags courseFacts gave them, such as S3. At most one practice set or set of flashcards starts per answer.`,
    inputSchema: jsonSchema<{ topics: string[] }>({
      type: "object",
      properties: {
        topics: {
          type: "array",
          items: { type: "string", pattern: "^S\\d+$" },
          minItems: 1,
          maxItems: 10,
        },
      },
      required: ["topics"],
      additionalProperties: false,
    }),
    execute: async ({ topics }, { toolCallId }) => {
      // Claimed before the first await: calls in one step run at once, and only one may start.
      if (started.current || started.claimed)
        throw new Error(
          "Not started: one practice set or set of flashcards already starts with this answer, and only one may.",
        );
      started.claimed = true;
      try {
        return await choose(topics, toolCallId);
      } catch (error) {
        started.claimed = false;
        throw error;
      }
    },
    toModelOutput: turn.modelOutput,
  });
  async function choose(topics: string[], toolCallId: string) {
    const retrieval = await reader.retrieve(
      p,
      { chatId },
      { kind: "facts", types: ["topic"] },
    );
    if (retrieval.status === "refused")
      throw turn.refuse(
        retrieval.reason === "not_owner" ? "gone" : retrieval.reason,
      );
    // A Chat's scope serves Facts of its selected Courses only, so this also keeps Topics within the selection.
    const inChat = new Map<CitationRef, string>(
      retrieval.items.flatMap((item) =>
        item.kind === "fact" ? [[item.cite, item.factId] as const] : [],
      ),
    );
    const topicIds = topics.map((tag) => {
      const cite = turn.citations.find((c) => c.tag === tag)?.cite;
      return cite && inChat.get(cite);
    });
    if (topicIds.some((id) => !id))
      throw new Error(
        "Not started: name only Topics of this Chat's selected Courses, by the tags courseFacts gave them.",
      );
    started.current = {
      kind,
      topicIds: topicIds as string[],
      artifactId: randomUUID(),
    };
    turn.give(
      toolCallId,
      `It starts once your answer is saved. Tell the student ${named[kind]} is being made and will be under Study.`,
    );
    return {
      kind,
      topics: topicIds.length,
      artifactId: started.current.artifactId,
    };
  }
}
