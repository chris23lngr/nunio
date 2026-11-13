import { randomBytes } from "node:crypto";
import type { Citation, CitationRef, Retrieval } from "@nunio/knowledge";

export type Refusal =
  | "gone"
  | Exclude<Extract<Retrieval, { status: "refused" }>["reason"], "not_owner">;

/** A work or Study Block a tool showed under a handle. */
export type Handled = { kind: "obligation" | "task" | "block"; id: string };

/** Lines of student data the model must read as data, fenced so nothing inside can pass for an instruction. */
export function fenced(name: string, lines: readonly string[]) {
  const fence = randomBytes(8).toString("hex");
  return [
    `<<<BEGIN ${name} ${fence}>>>`,
    ...lines,
    `<<<END ${name} ${fence}>>>`,
  ].join("\n");
}

/**
 * What one turn's tools share (ADR-0019): Citation tags that run on across all of them, the Sources their results
 * drew on, what each call gave the model, and whether a read was refused.
 */
export function createTurn() {
  const tags = new Map<CitationRef, string>();
  const citations: Citation[] = [];
  const sources = new Set<string>();
  const results = new Map<string, string>();
  const handles = new Map<string, Handled>();
  let refusal: Refusal | undefined;
  return {
    /** A short handle for a work or Study Block, such as O1, T1 or B1, which proposals name it by. */
    handleFor(kind: Handled["kind"], id: string) {
      for (const [handle, known] of handles)
        if (known.kind === kind && known.id === id) return handle;
      const prefix = { obligation: "O", task: "T", block: "B" }[kind];
      const handle = `${prefix}${[...handles.keys()].filter((h) => h.startsWith(prefix)).length + 1}`;
      handles.set(handle, { kind, id });
      return handle;
    },
    /** What a handle this turn gave out names. */
    lookup: (handle: string) => handles.get(handle),
    /** Every tag the turn's tools returned, in order. */
    citations: citations as readonly Citation[],
    /** Every Source whose wording a tool returned, so the answer is withdrawn with any of them. */
    sources,
    /** The tag for an item; one found again keeps its tag. */
    tagFor(cite: CitationRef) {
      let tag = tags.get(cite);
      if (!tag) {
        tag = `S${tags.size + 1}`;
        tags.set(cite, tag);
        citations.push({ tag, cite });
      }
      return tag;
    },
    /** Keeps what a tool call gives the model, apart from what the student sees. */
    give(toolCallId: string, text: string) {
      results.set(toolCallId, text);
    },
    modelOutput: ({ toolCallId }: { toolCallId: string }) => ({
      type: "text" as const,
      value: results.get(toolCallId) ?? "",
    }),
    /** Refuses the whole turn; the tool then throws, so the model gets no result. */
    refuse(reason: Refusal) {
      refusal ??= reason;
      return new Error(`The read was refused (${reason})`);
    },
    refusal: () => refusal,
  };
}
export type Turn = ReturnType<typeof createTurn>;
