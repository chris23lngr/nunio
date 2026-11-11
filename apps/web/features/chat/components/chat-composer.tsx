import { cn } from "@nunio/ui";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@nunio/ui/components/input-group/input-group";
import type { ReactNode, Ref } from "react";
import { useLayoutEffect, useRef } from "react";
import { ComposerAttachMenu } from "./composer-attach-menu";
import { ComposerSubmitButton } from "./composer-submit-button";

const maxLength = 4000;

/** Where to send a message. Controlled: the caller owns the text and decides what a submit does. */
export function ChatComposer({
  value,
  onValueChange,
  onBlur,
  onSubmit,
  busy,
  canSend,
  onStop,
  textareaRef,
  knowledge,
  alert,
  className,
  "aria-describedby": describedBy,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  /** Called on Enter and by the send button; Enter doesn't call it while busy. */
  onSubmit: () => void;
  /** An answer is being written: the send button stops it. */
  busy: boolean;
  /** Whether the send button is enabled. */
  canSend: boolean;
  onStop: () => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** Shown in the bar after the "+" menu. */
  knowledge?: ReactNode;
  alert?: string;
  className?: string;
  "aria-describedby"?: string;
}) {
  // The caret to restore once a newline inserted with Alt+Enter is rendered.
  const caret = useRef<{ textarea: HTMLTextAreaElement; at: number } | null>(
    null,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Runs when the new value is rendered.
  useLayoutEffect(() => {
    if (!caret.current) return;
    const { textarea, at } = caret.current;
    caret.current = null;
    textarea.setSelectionRange(at, at);
  }, [value]);

  return (
    <form
      aria-label="Nachricht verfassen"
      className={cn(
        "w-full shrink-0 bg-linear-to-b from-transparent to-white to-[64px] px-4 pt-16 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6 sm:pb-[max(32px,env(safe-area-inset-bottom))]",
        className,
      )}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="mx-auto max-w-[640px]">
        {alert && (
          <p role="alert" className="mb-3 text-sm text-destructive-700">
            {alert}
          </p>
        )}
        <InputGroup className="rounded-lg">
          <InputGroupTextarea
            ref={textareaRef}
            aria-label="Nachricht"
            aria-describedby={describedBy}
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onBlur={onBlur}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              )
                return;
              event.preventDefault();
              if (event.altKey) {
                // Browsers insert nothing for Alt+Enter, so insert the newline here.
                const textarea = event.currentTarget;
                const { selectionStart, selectionEnd } = textarea;
                const next = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`;
                if (next.length > maxLength) return;
                caret.current = { textarea, at: selectionStart + 1 };
                onValueChange(next);
              } else if (!busy) onSubmit();
            }}
            placeholder="Frage nunio alles, erwähne Kurse und Dateien mit @"
            className="min-h-12 max-h-64 px-4 py-3 text-base leading-6 font-normal"
            maxLength={maxLength}
          />
          <InputGroupAddon align="block-end" className="gap-3 py-3 pr-3 pl-2.5">
            <ComposerAttachMenu />
            {knowledge}
            <div className="flex-1" />
            <ComposerSubmitButton
              busy={busy}
              disabled={!canSend}
              onStop={onStop}
            />
          </InputGroupAddon>
        </InputGroup>
      </div>
    </form>
  );
}
