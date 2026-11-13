import type { Principal } from "@nunio/delegation";
import type { KnowledgeReader } from "@nunio/knowledge";
import type { Tool } from "ai";
import { jsonSchema, tool } from "ai";
import type { Turn } from "./turn.js";

/** What the student sees of a search: how much it found, and where. */
export type SearchOutput = { found: number; sources: string[] };

/** Searches the Chat's selection (ADR-0019). The model gets the rendered passages; the student only a summary. */
export function searchTool(
  turn: Turn,
  reader: KnowledgeReader,
  p: Principal,
  chatId: string,
): Tool<{ query: string }, SearchOutput> {
  return tool({
    description:
      "Searches the course material selected for this Chat and returns the best matching passages, each with the tag to cite it by.",
    inputSchema: jsonSchema<{ query: string }>({
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to look for, in the words the material likely uses.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    }),
    execute: async ({ query }, { toolCallId }): Promise<SearchOutput> => {
      const retrieval = await reader.retrieve(
        p,
        { chatId },
        { kind: "passages", text: query },
      );
      if (retrieval.status === "refused")
        throw turn.refuse(
          retrieval.reason === "not_owner" ? "gone" : retrieval.reason,
        );
      turn.give(toolCallId, retrieval.render({ tagFor: turn.tagFor }).data);
      const titles = new Set<string>();
      for (const item of retrieval.items)
        if (item.provenance.kind === "source") {
          turn.sources.add(item.provenance.sourceId);
          titles.add(item.provenance.title);
        }
      return { found: retrieval.items.length, sources: [...titles] };
    },
    toModelOutput: turn.modelOutput,
  });
}
