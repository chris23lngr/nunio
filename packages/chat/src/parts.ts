import type { UIMessageChunk } from "ai";
import { readUIMessageStream } from "ai";
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
    };

/** Removes Citation tags that no search returned, so they never show as Citations. */
export const withoutUnknownTags = (text: string, tags: ReadonlySet<string>) =>
  text.replace(/\s*\[(S\d+)\]/g, (tag, name: string) =>
    tags.has(name) ? tag : "",
  );

/** The answer's parts, assembled from the chunks the student was streamed. */
export async function partsFrom(
  chunks: readonly UIMessageChunk[],
  tags: ReadonlySet<string>,
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
    if (p.type === "tool-searchMaterial" && p.state === "output-available")
      return [
        {
          type: "tool-searchMaterial",
          toolCallId: p.toolCallId as string,
          input: p.input as { query: string },
          output: p.output as SearchOutput,
        },
      ];
    return [];
  });
}
