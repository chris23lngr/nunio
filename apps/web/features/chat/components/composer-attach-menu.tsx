import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { InputGroupButton } from "@nunio/ui/components/input-group/input-group";
import { Blocks, Plus, Upload } from "lucide-react";

/** The composer's "+" menu; its items aren't available yet. */
export function ComposerAttachMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <InputGroupButton
            aria-label="Weitere Optionen"
            variant="outline"
            size="icon"
          />
        }
      >
        <Plus className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled>
            <Upload />
            Datei hochladen
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Blocks />
            Konnektoren verwalten
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
