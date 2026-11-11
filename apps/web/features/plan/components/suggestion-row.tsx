import { Button } from "@nunio/ui/components/button/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@nunio/ui/components/item/item";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { ArrowRight, CalendarPlus } from "lucide-react";
import type { Suggestion } from "./suggestions-sheet";

/** One suggested change with the buttons to act on it. */
export function SuggestionRow({
  suggestion,
  onAccept,
  onReject,
  busy,
}: {
  suggestion: Suggestion;
  onAccept: (suggestion: Suggestion) => void;
  onReject?: (suggestion: Suggestion) => void;
  busy?: boolean;
}) {
  const when = `${format(suggestion.start, "EEE, d. MMM, HH:mm", { locale: de })}–${format(suggestion.end, "HH:mm")}`;
  const isMove = suggestion.kind === "move";
  const detail = isMove
    ? `Verschieben auf ${when}${suggestion.needsApproval ? " · dein Block" : ""}`
    : `Neuer Block ${when}`;
  return (
    <Item render={<li />} className="items-start gap-3 p-0">
      <ItemMedia>
        {isMove ? (
          <ArrowRight className="text-base-500 size-4" />
        ) : (
          <CalendarPlus className="text-primary-500 size-4" />
        )}
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="text-base-800">{suggestion.title}</ItemTitle>
        <ItemDescription className="text-base-500">{detail}</ItemDescription>
      </ItemContent>
      <ItemActions className="gap-3">
        {onReject && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onReject(suggestion)}
          >
            Ablehnen
          </Button>
        )}
        <Button size="sm" disabled={busy} onClick={() => onAccept(suggestion)}>
          {isMove && suggestion.needsApproval ? "Genehmigen" : "Annehmen"}
        </Button>
      </ItemActions>
    </Item>
  );
}
