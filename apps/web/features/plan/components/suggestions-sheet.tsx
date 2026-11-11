import { Button } from "@nunio/ui/components/button/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@nunio/ui/components/sheet/sheet";
import { SuggestionRow } from "./suggestion-row";

/** One change nunio proposes to the plan: a new Study Block or moving one. */
export type Suggestion = {
  id: string;
  kind: "create" | "move";
  title: string;
  start: Date;
  end: Date;
  /** The student placed this Study Block, so moving it needs their approval. */
  needsApproval: boolean;
};

/** Side sheet listing nunio's suggested changes to the plan. */
export function SuggestionsSheet({
  open,
  onOpenChange,
  suggestions,
  onAccept,
  onReject,
  onAcceptAll,
  busy,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: Suggestion[];
  onAccept: (suggestion: Suggestion) => void;
  onReject?: (suggestion: Suggestion) => void;
  onAcceptAll?: () => void;
  busy?: boolean;
  /** Why the last change failed, shown above the list. */
  error?: string | null;
}) {
  const count = suggestions.length;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Änderungsvorschläge</SheetTitle>
          <SheetDescription>
            {count === 0
              ? "Alles eingeplant. nunio hat gerade keine Vorschläge."
              : `nunio schlägt ${count} ${count === 1 ? "Änderung" : "Änderungen"} vor`}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {error && (
            <p role="alert" className="mb-6 text-sm text-destructive-700">
              {error}
            </p>
          )}
          {count > 0 && (
            <ul className="flex flex-col gap-6">
              {suggestions.map((suggestion) => (
                <SuggestionRow
                  key={suggestion.id}
                  suggestion={suggestion}
                  onAccept={onAccept}
                  onReject={onReject}
                  busy={busy}
                />
              ))}
            </ul>
          )}
        </SheetBody>
        {onAcceptAll && count > 0 && (
          <SheetFooter>
            <Button className="w-full" disabled={busy} onClick={onAcceptAll}>
              Alle übernehmen
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
