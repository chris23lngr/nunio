import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheck,
  CircleStop,
  EllipsisVertical,
  Pause,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/features/courses/components/confirm-dialog";
import { deleteAgent } from "../api/agent-mutations";

/**
 * An Agent's "…" menu: in its list row, Freigaben bestätigen (while it has open Approvals) and Bearbeiten first; then
 * Pausieren or Fortsetzen and Beenden while it is not Ended; then Löschen, which asks first.
 */
export function AgentMenu({
  apiOrigin,
  agent,
  name,
  row = false,
  onControl,
  onDeleted,
}: {
  apiOrigin: string;
  agent: {
    id: string;
    preset: string | null;
    state: "active" | "paused" | "ended";
    /** The oldest of its Runs still awaiting Approval; null when none is. */
    approvalRunId: string | null;
  };
  /** How the student knows it. */
  name: string;
  /** In the list's row, which also offers Freigaben bestätigen and Bearbeiten. */
  row?: boolean;
  onControl: (control: "pause" | "resume" | "end") => void;
  /** Once it is deleted. */
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation(deleteAgent(apiOrigin, agent.id, queryClient));
  const [confirming, setConfirming] = useState(false);
  return (
    <>
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
            {row && agent.approvalRunId && (
              <DropdownMenuItem
                render={
                  <Link
                    href={`/agents/${agent.id}?run=${agent.approvalRunId}`}
                  />
                }
              >
                <CircleCheck aria-hidden="true" />
                Freigaben bestätigen
              </DropdownMenuItem>
            )}
            {row && (
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
            )}
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
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                remove.reset();
                setConfirming(true);
              }}
            >
              <Trash2 aria-hidden="true" />
              Löschen
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {confirming && (
        <ConfirmDialog
          title={`„${name}“ löschen?`}
          confirm="Löschen"
          destructive
          pending={remove.isPending}
          error={remove.error?.message ?? null}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            remove.mutate(undefined, {
              onSuccess: () => {
                setConfirming(false);
                onDeleted?.();
              },
            })
          }
        >
          <p>
            Der Agent und seine gesamte Aktivität werden endgültig gelöscht. Das
            lässt sich nicht rückgängig machen.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
