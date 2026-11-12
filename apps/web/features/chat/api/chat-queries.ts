import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import type { CourseColor } from "@/features/courses/api/course-queries";
import { createApiClient } from "@/lib/api-client";

export type Chat =
  paths["/api/me/chats/{id}"]["get"]["responses"][200]["content"]["application/json"];
export type Message = Chat["messages"][number];
/** A saved proposal, with the Action the student is asked to approve and where it stands. */
export type SavedProposal = Extract<
  Message["parts"][number],
  { approvalId: string }
>;
/** A saved tool call: what nunio read for an answer, as the student was shown it. */
type ToolPart = Extract<Message["parts"][number], { toolCallId: string }>;
type ChatTools = {
  [Part in ToolPart as Part["type"] extends `tool-${infer Name}`
    ? Name
    : never]: {
    input: Part["input"];
    output: Part extends { output: infer Output } ? Output : never;
  };
};
export type Course = Chat["courses"][number];
/** A Course the student can chat about, with its color. */
export type CourseOption = Course & { color: CourseColor };

/** A saved answer and its question, as the stream's `data-committed` carries them; a report on an approval has none. */
export type Turn = Message & { question: Message | null };

/** A Chat message as useChat holds it; metadata arrives once the message is saved. */
export type ChatUIMessage = UIMessage<
  {
    createdAt: string;
    citations: Message["citations"];
    withdrawn?: true;
    /** The name of the model that wrote a saved answer. */
    model?: string;
    /** A saved answer's proposals, by tool call, as their cards show them. */
    proposals?: Record<string, SavedProposal>;
  },
  { committed: Turn; refused: { error: string } },
  ChatTools
>;

export function toUIMessage(message: Message): ChatUIMessage {
  return {
    id: message.id,
    role: message.role === "student" ? "user" : "assistant",
    metadata: {
      createdAt: message.createdAt,
      citations: message.citations,
      ...(message.text === null ? { withdrawn: true as const } : {}),
      ...(message.model ? { model: message.model.name } : {}),
      proposals: Object.fromEntries(
        message.parts.flatMap((part) =>
          "approvalId" in part ? [[part.toolCallId, part] as const] : [],
        ),
      ),
    },
    parts: message.parts.map((part): ChatUIMessage["parts"][number] => {
      // A proposal still asks the student, under the approval the stream announced.
      if ("approvalId" in part)
        return {
          type: part.type,
          toolCallId: part.toolCallId,
          state: "approval-requested",
          input: part.input,
          approval: { id: part.approvalId },
        } as ChatUIMessage["parts"][number];
      if ("toolCallId" in part)
        return {
          ...part,
          state: "output-available",
        } as ChatUIMessage["parts"][number];
      return part.type === "reasoning"
        ? { type: "reasoning", text: part.text, state: "done" }
        : { type: "text", text: part.text, state: "done" };
    }),
  };
}

/** The text a message shows, joined from its text parts. */
export function messageText(message: ChatUIMessage) {
  return message.parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}

export function chatQueries(apiOrigin: string, id: string | null) {
  return queryOptions({
    queryKey: [apiOrigin, "chats", id],
    enabled: !!id,
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET(
        "/api/me/chats/{id}",
        { params: { path: { id: id! } }, signal },
      );
      if (!result.data)
        throw new Error(
          result.response.status === 404
            ? "Dieser Chat ist nicht mehr verfügbar."
            : "Der Chat konnte nicht geladen werden.",
        );
      return result.data;
    },
  });
}

export function chatCourseQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "chat-courses"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/courses", {
        signal,
      });
      if (!result.data)
        throw new Error("Deine Kurse konnten nicht geladen werden.");
      return result.data.courses
        .filter((course) => course.status === "accepted")
        .map(
          ({ id, title, code, color }): CourseOption => ({
            id,
            title,
            code,
            color,
          }),
        );
    },
  });
}
