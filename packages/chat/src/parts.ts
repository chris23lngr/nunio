import type { BlockNote } from "@nunio/planning";
import type { UIMessageChunk } from "ai";
import { readUIMessageStream } from "ai";
import type { AgendaOutput } from "./agenda.js";
import type { CourseFactsOutput } from "./course-facts.js";
import type { IntegrationReadOutput } from "./integration-reads.js";
import { isIntegrationRead } from "./integration-reads.js";
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
  | {
      /** A read through a Connection; its arguments aren't kept. */
      type: "tool-integration";
      toolCallId: string;
      input: Record<string, never>;
      output: IntegrationReadOutput;
    }
  | ProposalPart<"tool-proposeStudyBlock", { work: string } & Times>
  | ProposalPart<"tool-proposeStudyBlockMove", { block: string } & Times>
  | ProposalPart<"tool-proposeStudyBlockRemove", { block: string }>
  | ProposalPart<
      "tool-proposeTask",
      {
        title: string;
        course?: string;
        event?: string;
        role?: "preparation" | "follow_up";
        minutes?: number;
      }
    >
  | ProposalPart<"tool-proposeTaskReopen", { task: string }>
  | IntegrationCallPart;

/** Where a proposed block would be, in the student's time zone as the model gave it. */
type Times = { start: string; end: string };

/** A proposed Study Block or Task change, asked of the student as an Action under `key` once the answer is saved. */
export type ProposalPart<Type extends string, Input> = {
  type: Type;
  toolCallId: string;
  input: Input;
  approvalId: string;
  key: string;
  notes: BlockNote[];
};

/**
 * A write through a Connection, asked of the student as an `integration.call` Action under `key` once the answer is
 * saved. Kept under one type, whatever the model called the tool, with what its card names.
 */
export type IntegrationCallPart = {
  type: "tool-integrationCall";
  toolCallId: string;
  /** The tool's arguments, as the model gave them. */
  input: Record<string, unknown>;
  approvalId: string;
  key: string;
  integration: { key: string; name: string; logo: string };
  /** The server's own tool name, nunio's label, and the argument the card shows first. */
  tool: { name: string; label: string; headlineArgument: string | null };
};

const proposalTypes = new Set([
  "tool-proposeStudyBlock",
  "tool-proposeStudyBlockMove",
  "tool-proposeStudyBlockRemove",
  "tool-proposeTask",
  "tool-proposeTaskReopen",
  "tool-integrationCall",
]);
export const isProposal = (
  part: ChatPart,
): part is Extract<ChatPart, { approvalId: string }> =>
  proposalTypes.has(part.type);

/** Removes Citation tags that no search returned, so they never show as Citations. */
export const withoutUnknownTags = (text: string, tags: ReadonlySet<string>) =>
  text.replace(/\s*\[(S\d+)\]/g, (tag, name: string) =>
    tags.has(name) ? tag : "",
  );

/** The answer's parts, assembled from the chunks the student was streamed. */
export async function partsFrom(
  chunks: readonly UIMessageChunk[],
  tags: ReadonlySet<string>,
  /** What a proposal waiting for the student is asked as, by its tool call, and what its part shows. */
  asked: (
    toolCallId: string,
  ) =>
    | { key: string; notes: BlockNote[] }
    | Pick<IntegrationCallPart, "type" | "key" | "integration" | "tool">
    | undefined,
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
        // An Integration read is kept under one type, whatever the model called it, and without its arguments.
        isIntegrationRead(p.output)
          ? {
              type: "tool-integration",
              toolCallId: p.toolCallId as string,
              input: {},
              output: p.output,
            }
          : ({
              type: p.type,
              toolCallId: p.toolCallId,
              input: p.input,
              output: p.output,
            } as ChatPart),
      ];
    // A proposal waits for the student; it shows as the Action it is asked as, an Integration write under its own type.
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
