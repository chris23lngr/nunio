import type { Principal } from "@nunio/delegation";
import type {
  Citation,
  CitationRef,
  KnowledgeReader,
  Retrieval,
} from "@nunio/knowledge";
import type { ToolSet } from "ai";
import { jsonSchema, tool } from "ai";

/** What the student sees of a search: how much it found, and where. */
export type SearchOutput = { found: number; sources: string[] };

type Refusal =
  | "gone"
  | Exclude<Extract<Retrieval, { status: "refused" }>["reason"], "not_owner">;

export interface Search {
  tools: ToolSet;
  /** Every tag the turn's searches returned, in order. */
  citations: readonly Citation[];
  /** Every Source a search returned passages of, so the answer is withdrawn with any of them. */
  sources: ReadonlySet<string>;
  /** Why a search was refused, which refuses the whole turn. */
  refusal(): Refusal | undefined;
}

/**
 * The search tool for one turn of a Chat (ADR-0019). Tags run on across the turn's searches, and an item
 * found again keeps its tag. The model gets the rendered passages; the student only a summary.
 */
export function createSearch(
  reader: KnowledgeReader,
  p: Principal,
  chatId: string,
): Search {
  const tags = new Map<CitationRef, string>();
  const rendered = new Map<string, string>();
  const citations: Citation[] = [];
  const sources = new Set<string>();
  let refusal: Refusal | undefined;
  const tagFor = (cite: CitationRef) => {
    let tag = tags.get(cite);
    if (!tag) {
      tag = `S${tags.size + 1}`;
      tags.set(cite, tag);
      citations.push({ tag, cite });
    }
    return tag;
  };
  const searchMaterial = tool({
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
      if (retrieval.status === "refused") {
        refusal ??=
          retrieval.reason === "not_owner" ? "gone" : retrieval.reason;
        throw new Error(`The search was refused (${retrieval.reason})`);
      }
      rendered.set(toolCallId, retrieval.render({ tagFor }).data);
      const titles = new Set<string>();
      for (const item of retrieval.items)
        if (item.provenance.kind === "source") {
          sources.add(item.provenance.sourceId);
          titles.add(item.provenance.title);
        }
      return { found: retrieval.items.length, sources: [...titles] };
    },
    toModelOutput: ({ toolCallId }) => ({
      type: "text",
      value: rendered.get(toolCallId) ?? "",
    }),
  });
  return {
    tools: { searchMaterial },
    citations,
    sources,
    refusal: () => refusal,
  };
}
