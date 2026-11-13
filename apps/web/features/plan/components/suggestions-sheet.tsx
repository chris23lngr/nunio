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
import { Loader } from "lucide-react";
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
              ? "nunio hat gerade keine Änderungsvorschläge."
              : `nunio schlägt ${count} ${count === 1 ? "Änderung" : "Änderungen"} vor`}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className={count === 0 ? "flex flex-col" : undefined}>
          {error && (
            <p role="alert" className="mb-6 text-sm text-destructive-700">
              {error}
            </p>
          )}
          {count === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="w-full max-w-sm">
                <span
                  aria-hidden="true"
                  className="mb-8 flex size-10 items-center justify-center rounded-md border border-dashed border-base-300 bg-base-50 text-base-700"
                >
                  <Loader className="size-5" />
                </span>
                <h3 className="text-base font-medium leading-6 text-base-800">
                  Keine Vorschläge
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-base-500">
                  Wenn Änderungsvorschläge in deinem Lernplan gefunden wurden,
                  werden diese hier angezeigt.
                </p>
              </div>
            </div>
          ) : (
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
        {(count === 0 || onAcceptAll) && (
          <SheetFooter>
            <Button
              className="w-full"
              disabled={count === 0 || busy}
              onClick={onAcceptAll}
            >
              Alle übernehmen
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
