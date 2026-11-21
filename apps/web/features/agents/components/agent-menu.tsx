import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import {
  CircleStop,
  EllipsisVertical,
  Pause,
  Pencil,
  Play,
} from "lucide-react";
import Link from "next/link";
import type { AgentRow } from "../api/agent-queries";

/** An Agent's row menu: edit it, and pause, resume or end it while it is not Ended. */
export function AgentMenu({
  agent,
  name,
  onControl,
}: {
  agent: AgentRow;
  /** How the student knows it. */
  name: string;
  onControl: (control: "pause" | "resume" | "end") => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Aktionen für ${name}`}
          />
        }
      >
        <EllipsisVertical aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            // A preset Agent has no Auftrag; its own screen is all there is.
            render={
              <Link
                href={
                  agent.preset
                    ? `/agents/${agent.id}`
                    : `/agents/${agent.id}?tab=auftrag`
                }
              />
            }
          >
            <Pencil aria-hidden="true" />
            Bearbeiten
          </DropdownMenuItem>
          {agent.state === "paused" && (
            <DropdownMenuItem onClick={() => onControl("resume")}>
              <Play aria-hidden="true" />
              Fortsetzen
            </DropdownMenuItem>
          )}
          {agent.state === "active" && (
            <DropdownMenuItem onClick={() => onControl("pause")}>
              <Pause aria-hidden="true" />
              Pausieren
            </DropdownMenuItem>
          )}
          {agent.state !== "ended" && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => onControl("end")}
            >
              <CircleStop aria-hidden="true" />
              Beenden
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
