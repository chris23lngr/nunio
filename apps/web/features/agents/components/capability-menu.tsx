import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { Ellipsis, Trash2 } from "lucide-react";
import type { ApprovalMode, Capability } from "../api/agent-queries";
import { modes } from "../capability-mode";

/** One of the Agent's Capabilities: its Freigabemodus, the modes it does not allow disabled, then Löschen. */
export function CapabilityMenu({
  capability,
  mode,
  onMode,
  onRemove,
}: {
  capability: Capability;
  mode: ApprovalMode;
  onMode: (mode: ApprovalMode) => void;
  onRemove: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="-my-1 -mr-1.5 shrink-0"
            aria-label={`Aktionen für ${capability.title}`}
          />
        }
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-62">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value: ApprovalMode) => onMode(value)}
        >
          <DropdownMenuLabel>Freigabemodus</DropdownMenuLabel>
          {modes.map(({ mode: each, label, Icon }) => (
            <DropdownMenuRadioItem
              key={each}
              value={each}
              disabled={!capability.modes.includes(each)}
              closeOnClick
            >
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem variant="destructive" onClick={onRemove}>
            <Trash2 aria-hidden="true" />
            Löschen
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
