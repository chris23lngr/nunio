import type { paths } from "@nunio/api-client";
import { queryOptions } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { apiFetch, createApiClient } from "@/lib/api-client";
import type { Agent, AgentCapability } from "./agent-queries";

export type BuilderRequest =
  paths["/api/me/agents/builder"]["post"]["requestBody"]["content"]["application/json"];
export type BuilderForm = BuilderRequest["form"];
export type BuilderMessage = BuilderRequest["messages"][number];

/** What the builder writes into the form, each field already within the form's rules. */
export type FormFill = {
  name?: string;
  description?: string;
  instructions?: string;
  trigger?: Agent["trigger"];
  courseIds?: string[];
  capabilities?: AgentCapability[];
};

/** A failed answer, with a message safe to show and the API's refusal reason if any. */
export class BuilderError extends Error {
  constructor(public readonly reason?: string) {
    super(
      reason === "allowance_exhausted"
        ? "Dein KI-Kontingent ist aufgebraucht. Du kannst das Formular weiter selbst ausfüllen."
        : reason === "ai_disabled"
          ? "nunio antwortet gerade nicht. Versuche es später erneut."
          : "Die Antwort wurde unterbrochen. Versuche es erneut.",
    );
  }
}

/** The student's Allowance; the builder is paid from it, so it is unavailable once it is used up. */
export function allowanceQueries(apiOrigin: string) {
  return queryOptions({
    queryKey: [apiOrigin, "allowance"],
    queryFn: async ({ signal }) => {
      const result = await createApiClient(apiOrigin).GET("/api/me/allowance", {
        signal,
      });
      if (!result.data) throw new Error("Could not load your Allowance.");
      return result.data;
    },
  });
}

/**
 * Asks the builder, passing its reply's text to `onText` as it streams, and resolves with the reply and what to write
 * into the form. Nothing is kept: the caller holds the conversation.
 */
export async function askBuilder(
  apiOrigin: string,
  body: BuilderRequest,
  { signal, onText }: { signal?: AbortSignal; onText: (text: string) => void },
) {
  const chunks = await new DefaultChatTransport<UIMessage>({
    api: `${apiOrigin}/api/me/agents/builder`,
    credentials: "include",
    fetch: async (input, init) => {
      const response = await apiFetch(input, init);
      if (!response.ok) throw new BuilderError();
      return response;
    },
    prepareSendMessagesRequest: () => ({ body }),
  }).sendMessages({
    chatId: "builder",
    messages: [],
    abortSignal: signal,
    trigger: "submit-message",
    messageId: undefined,
  });
  let text = "";
  let fill: FormFill | null = null;
  let refused: string | undefined;
  let finished = false;
  const reader = chunks.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value.type === "text-delta") {
      text += value.delta;
      onText(text);
    }
    if (value.type === "data-form") fill = value.data as FormFill;
    if (value.type === "data-refused")
      refused = (value.data as { error: string }).error;
    if (value.type === "finish") finished = true;
  }
  if (!finished) throw new BuilderError(refused);
  return { text, fill };
}
