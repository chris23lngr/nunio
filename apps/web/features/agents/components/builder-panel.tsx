import { cn } from "@nunio/ui";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@nunio/ui/components/input-group/input-group";
import { Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { ComposerSubmitButton } from "@/features/chat/components/composer-submit-button";

/** The form's fields the builder can change, each marked and undone on its own. */
export const builderFields = {
  name: "Name",
  description: "Beschreibung",
  instructions: "Auftrag",
  trigger: "Auslöser",
  courses: "Kurse",
  capabilities: "Fähigkeiten",
} as const;
export type BuilderField = keyof typeof builderFields;

export type BuilderTurn = {
  id: string;
  role: "student" | "builder";
  text: string;
  /** The fields this answer changed, in form order. */
  changes: BuilderField[];
  /** Some of its changes are still marked, so "Alle rückgängig" can undo them. */
  undoable?: boolean;
};

const maxLength = 4000;

/** A field the builder changed: "von nunio geändert", with its own Rückgängig. */
export function ChangedMark({
  field,
  onUndo,
}: {
  field: BuilderField;
  onUndo: () => void;
}) {
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs text-primary-700">
      <Sparkles aria-hidden="true" className="size-3.5 text-primary-500" />
      <span>von nunio geändert</span>
      <span aria-hidden="true" className="text-base-300">
        ·
      </span>
      <button
        type="button"
        aria-label={`Rückgängig: ${builderFields[field]}`}
        onClick={onUndo}
        className="font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        Rückgängig
      </button>
    </p>
  );
}

/**
 * The AI builder panel beside the form: "Was soll dein Agent können?". It shows the conversation, which nothing keeps
 * once the form is left, and lists each answer's changes with "zeigen" and "Alle rückgängig".
 */
export function BuilderPanel({
  turns,
  reply,
  error,
  unavailable,
  onSend,
  onStop,
  onShow,
  onUndoAll,
}: {
  turns: BuilderTurn[];
  /** The answer being written; null while none is. */
  reply: string | null;
  error: string | null;
  /** The Allowance is used up: the form still works by hand. */
  unavailable: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onShow: (field: BuilderField) => void;
  onUndoAll: (turnId: string) => void;
}) {
  const [text, setText] = useState("");
  const conversation = useRef<HTMLOListElement>(null);
  const message = useRef<HTMLTextAreaElement>(null);
  // Off once the student scrolls up to reread, so the answer being written doesn't pull them down.
  const following = useRef(true);
  const busy = reply !== null;
  const canSend = !busy && !unavailable && !!text.trim();
  const send = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
    following.current = true;
    // The send button turns into Stop and then a disabled send button, which would drop focus.
    message.current?.focus();
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: Runs when a message arrives or grows.
  useLayoutEffect(() => {
    const list = conversation.current;
    if (list && following.current) list.scrollTop = list.scrollHeight;
  }, [turns.length, reply]);

  return (
    <aside
      aria-label="nunio fragen"
      className="flex min-h-[40.5rem] min-w-0 flex-1 flex-col p-8 lg:sticky lg:top-16 lg:h-[calc(100dvh-8.5rem)] lg:min-h-0"
    >
      <div className="flex flex-1 flex-col overflow-clip rounded-[20px] bg-base-50">
        {turns.length === 0 && !busy ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8">
            <h2 className="text-center text-2xl font-medium text-base-700">
              Was soll dein Agent können?
            </h2>
            <p className="max-w-[388px] text-center text-sm text-base-500">
              nunio kann dir helfen, deinen Agenten zu bauen. Stelle einfach
              eine Frage.
            </p>
          </div>
        ) : (
          <ol
            ref={conversation}
            aria-label="Unterhaltung"
            onScroll={(event) => {
              const list = event.currentTarget;
              following.current =
                list.scrollHeight - list.scrollTop - list.clientHeight < 32;
            }}
            className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 pt-6"
          >
            {turns.map((turn) =>
              turn.role === "student" ? (
                <li
                  key={turn.id}
                  className="ml-auto max-w-[85%] rounded-lg bg-white px-3 py-2 text-sm whitespace-pre-wrap text-base-800 shadow-xs outline-1 outline-base-700/10"
                >
                  {turn.text}
                </li>
              ) : (
                <li key={turn.id} className="flex flex-col gap-3">
                  {turn.text && (
                    <p className="text-sm whitespace-pre-wrap text-base-700">
                      {turn.text}
                    </p>
                  )}
                  {!!turn.changes.length && (
                    <div className="flex flex-col gap-2 rounded-lg bg-white px-3 py-2.5 outline-1 outline-base-700/10">
                      <ul aria-label="Änderungen" className="flex flex-col">
                        {turn.changes.map((field) => (
                          <li
                            key={field}
                            className="flex items-center justify-between gap-3 py-0.5 text-sm text-base-700"
                          >
                            <span>{builderFields[field]}</span>
                            <button
                              type="button"
                              aria-label={`${builderFields[field]} zeigen`}
                              onClick={() => onShow(field)}
                              className="text-sm font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                            >
                              zeigen
                            </button>
                          </li>
                        ))}
                      </ul>
                      {turn.undoable && (
                        <button
                          type="button"
                          onClick={() => onUndoAll(turn.id)}
                          className="self-start border-t border-base-200 pt-2 text-sm font-medium text-primary-600 hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
                        >
                          Alle rückgängig
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ),
            )}
            {busy && (
              <li
                aria-live="polite"
                className={cn(
                  "text-sm whitespace-pre-wrap",
                  reply ? "text-base-700" : "text-base-500",
                )}
              >
                {reply || "nunio denkt nach…"}
              </li>
            )}
          </ol>
        )}
        <form
          aria-label="Nachricht an nunio verfassen"
          className="px-4 pt-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {(unavailable || error) && (
            <p role="alert" className="mb-3 text-sm text-destructive-700">
              {unavailable
                ? "Dein KI-Kontingent ist aufgebraucht. Du kannst das Formular weiter selbst ausfüllen."
                : error}
            </p>
          )}
          <InputGroup className="rounded-lg bg-white">
            <InputGroupTextarea
              ref={message}
              aria-label="Nachricht an nunio"
              value={text}
              disabled={unavailable}
              maxLength={maxLength}
              placeholder="Beschreibe, was dein Agent können soll."
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key !== "Enter" ||
                  event.shiftKey ||
                  event.nativeEvent.isComposing
                )
                  return;
                event.preventDefault();
                send();
              }}
              className="min-h-12 max-h-48 px-4 py-3 text-base leading-6 font-normal"
            />
            <InputGroupAddon
              align="block-end"
              className="gap-3 py-3 pr-3 pl-2.5"
            >
              <div className="flex-1" />
              <ComposerSubmitButton
                busy={busy}
                disabled={!canSend}
                onStop={onStop}
              />
            </InputGroupAddon>
          </InputGroup>
        </form>
      </div>
    </aside>
  );
}
