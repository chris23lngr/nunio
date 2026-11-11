import { Button } from "@nunio/ui/components/button/button";

/** Opens nunio's suggested changes to the plan, flagging how many are new. */
export function SuggestionsButton({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  const hasNew = count > 0;
  return (
    // The Button clips overflow, so the dot sits on this wrapper instead.
    <span className="relative inline-flex">
      <Button
        aria-label={hasNew ? `Vorschläge anzeigen, ${count} neu` : undefined}
        onClick={onClick}
      >
        Vorschläge anzeigen
        {hasNew && (
          <span className="bg-primary-300 text-primary-900 inline-flex size-4.5 items-center justify-center rounded-full text-xs font-medium">
            {count}
          </span>
        )}
      </Button>
      {hasNew && (
        <span
          data-slot="suggestions-dot"
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-0 flex size-2 translate-x-1/2 -translate-y-1/2 items-center justify-center"
        >
          <span className="absolute size-2 animate-ping rounded-full bg-orange-500 motion-reduce:size-4 motion-reduce:animate-none motion-reduce:bg-orange-500/30" />
          <span className="relative size-2 rounded-full bg-orange-500" />
        </span>
      )}
    </span>
  );
}
