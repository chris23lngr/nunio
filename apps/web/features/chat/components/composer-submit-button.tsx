import { InputGroupButton } from "@nunio/ui/components/input-group/input-group";
import { ArrowUp, CircleStop } from "lucide-react";

/** Sends the message, or stops the answer while one is being written. */
export function ComposerSubmitButton({
  busy,
  disabled,
  onStop,
}: {
  busy: boolean;
  /** Nothing can be sent right now. Ignored while busy: stopping always works. */
  disabled: boolean;
  onStop: () => void;
}) {
  if (busy)
    return (
      <InputGroupButton
        aria-label="Antwort stoppen"
        variant="primary"
        size="icon"
        onClick={onStop}
      >
        <CircleStop />
      </InputGroupButton>
    );
  return (
    <InputGroupButton
      aria-label="Nachricht senden"
      type="submit"
      variant="primary"
      size="icon"
      disabled={disabled}
      // The design greys the disabled send button instead of fading the primary one.
      className="disabled:from-base-100 disabled:to-base-100 disabled:outline-base-200 disabled:opacity-100 disabled:inset-shadow-none data-disabled:opacity-100"
    >
      <ArrowUp className={disabled ? "text-base-400" : undefined} />
    </InputGroupButton>
  );
}
