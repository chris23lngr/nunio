import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import type { BuilderForm, FormFill } from "./api/builder-mutations";
import {
  allowanceQueries,
  askBuilder,
  BuilderError,
} from "./api/builder-mutations";
import type { BuilderField, BuilderTurn } from "./components/builder-panel";

/** The API reads at most this many messages of the conversation, each at most this long. */
const maxMessages = 40;
const maxText = 4000;

/**
 * The builder's conversation, held only here: it is gone once the form is left (ADR-0026 amendment "The builder").
 * `apply` writes an answer's fill into the form and says which fields it changed.
 */
export function useBuilder(
  apiOrigin: string,
  {
    shown,
    form,
    apply,
  }: {
    /** The panel is on screen, so whether it is available matters. */
    shown: boolean;
    form: () => BuilderForm;
    apply: (fill: FormFill, turnId: string) => BuilderField[];
  },
) {
  const queryClient = useQueryClient();
  const allowance = useQuery({
    ...allowanceQueries(apiOrigin),
    enabled: shown,
  });
  const [turns, setTurns] = useState<BuilderTurn[]>([]);
  const [reply, setReply] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const asking = useRef<AbortController | null>(null);
  useEffect(() => () => asking.current?.abort(), []);
  const left = allowance.data
    ? allowance.data.limitMicroUsd -
      allowance.data.usedMicroUsd -
      allowance.data.heldMicroUsd
    : 1;

  const send = async (text: string) => {
    const question: BuilderTurn = {
      id: crypto.randomUUID(),
      role: "student",
      text,
      changes: [],
    };
    const conversation = [...turns, question];
    setTurns(conversation);
    setReply("");
    setError(null);
    const abort = new AbortController();
    asking.current = abort;
    try {
      const answer = await askBuilder(
        apiOrigin,
        {
          form: form(),
          messages: conversation
            .filter((turn) => turn.text.trim())
            .slice(-maxMessages)
            // A long reply is sent back cut, so it never makes the next request invalid.
            .map(({ role, text }) => ({
              role,
              text: text.trim().slice(0, maxText),
            })),
        },
        { signal: abort.signal, onText: setReply },
      );
      const id = crypto.randomUUID();
      const changes = answer.fill ? apply(answer.fill, id) : [];
      setTurns((current) => [
        ...current,
        { id, role: "builder", text: answer.text, changes },
      ]);
    } catch (cause) {
      if (abort.signal.aborted) return;
      if (
        cause instanceof BuilderError &&
        cause.reason === "allowance_exhausted"
      )
        setExhausted(true);
      else
        setError(
          cause instanceof BuilderError || cause instanceof ApiError
            ? cause.message
            : new BuilderError().message,
        );
    } finally {
      if (asking.current === abort) {
        asking.current = null;
        setReply(null);
      }
      void queryClient.invalidateQueries(allowanceQueries(apiOrigin));
    }
  };

  return {
    turns,
    reply,
    error,
    unavailable: exhausted || left <= 0,
    send,
    stop: () => {
      asking.current?.abort();
      asking.current = null;
      setReply(null);
    },
  };
}
