import type { BlockNote } from "@nunio/planning";
import type { UIMessageChunk } from "ai";
import { readUIMessageStream } from "ai";
import type { AgendaOutput } from "./agenda.js";
import type { CourseFactsOutput } from "./course-facts.js";
import type { ArtifactOutput } from "./practice.js";
import type { SearchOutput } from "./search.js";

/** One part of an answer, as the student saw it and as it is stored. */
export type ChatPart =
  | { type: "reasoning"; text: string }
  | { type: "text"; text: string }
  | {
      type: "tool-searchMaterial";
      toolCallId: string;
      input: { query: string };
      output: SearchOutput;
    }
  | {
      type: "tool-agenda";
      toolCallId: string;
      input: { from: string; to: string };
      output: AgendaOutput;
    }
  | {
      type: "tool-courseFacts";
      toolCallId: string;
      input: { course: string };
      output: CourseFactsOutput;
    }
  | {
      type: "tool-startPracticeSet" | "tool-startFlashcards";
      toolCallId: string;
      input: { topics: string[] };
      output: ArtifactOutput;
    }
  | ProposalPart<"tool-proposeStudyBlock", { work: string } & Times>
  | ProposalPart<"tool-proposeStudyBlockMove", { block: string } & Times>
  | ProposalPart<"tool-proposeStudyBlockRemove", { block: string }>;

/** Where a proposed block would be, in the student's time zone as the model gave it. */
type Times = { start: string; end: string };

/** A proposed Study Block change, asked of the student as an Action under `key` once the answer is saved. */
export type ProposalPart<Type extends string, Input> = {
  type: Type;
  toolCallId: string;
  input: Input;
  approvalId: string;
  key: string;
  notes: BlockNote[];
};

export const isProposal = (
  part: ChatPart,
): part is Extract<ChatPart, { approvalId: string }> =>
  part.type === "tool-proposeStudyBlock" ||
  part.type === "tool-proposeStudyBlockMove" ||
  part.type === "tool-proposeStudyBlockRemove";

/** Removes Citation tags that no search returned, so they never show as Citations. */
export const withoutUnknownTags = (text: string, tags: ReadonlySet<string>) =>
  text.replace(/\s*\[(S\d+)\]/g, (tag, name: string) =>
    tags.has(name) ? tag : "",
  );

/** The answer's parts, assembled from the chunks the student was streamed. */
export async function partsFrom(
  chunks: readonly UIMessageChunk[],
  tags: ReadonlySet<string>,
  /** What a proposal waiting for the student is asked as, by its tool call. */
  asked: (
    toolCallId: string,
  ) => { key: string; notes: BlockNote[] } | undefined,
): Promise<ChatPart[]> {
  let message: { parts: unknown[] } | undefined;
  for await (const snapshot of readUIMessageStream({
    stream: new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  }))
    message = snapshot;
  return (message?.parts ?? []).flatMap((part): ChatPart[] => {
    const p = part as Record<string, unknown>;
    if (p.type === "reasoning" && typeof p.text === "string" && p.text)
      return [{ type: "reasoning", text: p.text }];
    if (p.type === "text" && typeof p.text === "string") {
      const text = withoutUnknownTags(p.text, tags);
      return text ? [{ type: "text", text }] : [];
    }
    // A tool call shows once it has a result, with what the student was shown of it.
    if (
      typeof p.type === "string" &&
      p.type.startsWith("tool-") &&
      p.state === "output-available"
    )
      return [
        {
          type: p.type,
          toolCallId: p.toolCallId,
          input: p.input,
          output: p.output,
        } as ChatPart,
      ];
    // A proposal waits for the student; it shows as the Action it is asked as.
    if (p.state === "approval-requested") {
      const proposal = asked(p.toolCallId as string);
      return proposal
        ? [
            {
              type: p.type,
              toolCallId: p.toolCallId,
              input: p.input,
              approvalId: (p.approval as { id: string }).id,
              ...proposal,
            } as ChatPart,
          ]
        : [];
    }
    return [];
  });
}
