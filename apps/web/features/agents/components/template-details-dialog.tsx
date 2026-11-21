"use client";

import { cn } from "@nunio/ui";
import { Button, buttonVariants } from "@nunio/ui/components/button/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nunio/ui/components/dialog/dialog";
import { useQuery } from "@tanstack/react-query";
import { Calendar, Users, X } from "lucide-react";
import Link from "next/link";
import type { AgentTemplate } from "../api/agent-queries";
import { capabilityQueries } from "../api/agent-queries";
import { modeOf } from "../capability-mode";

const formatCreatedOn = (isoDate: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));

const formatMinute = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const weekdayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function triggerLine(trigger: AgentTemplate["trigger"]) {
  const time = `${formatMinute(trigger.minute)} Uhr`;
  if (trigger.rhythm === "daily") return `Täglich um ${time}`;
  const days = trigger.weekdays.map((day) => weekdayNames[day - 1]).join(", ");
  return `${days} um ${time}`;
}

/**
 * A curated Template's details: creation date, how many other students used it (hidden when 0), a preview of its
 * Auftrag, trigger and Capabilities, a visible close button, and "Template verwenden".
 */
export function TemplateDetailsDialog({
  apiOrigin,
  template,
  onClose,
}: {
  apiOrigin: string;
  template: AgentTemplate | null;
  onClose: () => void;
}) {
  const capabilitySet = useQuery({
    ...capabilityQueries(apiOrigin),
    enabled: Boolean(template),
  });
  if (!template) return null;

  const titleOf = (id: string) =>
    capabilitySet.data?.find((c) => c.id === id)?.title ?? id;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Schließen"
              className="absolute top-6 right-6"
            />
          }
        >
          <X aria-hidden="true" className="size-5" />
        </DialogClose>
        <DialogHeader className="pb-4">
          <div className="flex items-start gap-3 pr-10">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-base-100 text-xl"
            >
              {template.emoji}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle className="pr-0">{template.name}</DialogTitle>
              <DialogDescription>{template.description}</DialogDescription>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-base-500">
            <span className="inline-flex items-center gap-1.5">
              <Calendar aria-hidden="true" className="size-3.5" />
              Erstellt am {formatCreatedOn(template.createdOn)}
            </span>
            {template.othersCount > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Users aria-hidden="true" className="size-3.5" />
                Von {template.othersCount} Anderen genutzt
              </span>
            )}
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5 pb-6">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-base-500">Auftrag</h3>
            <p className="whitespace-pre-line rounded-lg bg-base-50 p-3 text-sm leading-5 text-base-700">
              {template.instructions}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-base-500">Auslöser</h3>
              <p className="text-sm text-base-800">
                {triggerLine(template.trigger)}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-base-500">Kurse</h3>
              <p className="text-sm text-base-800">
                {template.courses === "all_active"
                  ? "Alle aktiven Kurse vorausgewählt"
                  : "Kurse selbst auswählen"}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-base-500">Fähigkeiten</h3>
            <ul className="flex flex-col gap-1.5">
              {template.capabilities.map((capability) => {
                const mode = capability.mode ? modeOf(capability.mode) : null;
                return (
                  <li
                    key={capability.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-base-200 px-3 py-2 text-sm text-base-800"
                  >
                    <span>{titleOf(capability.id)}</span>
                    {mode && (
                      <span
                        className={cn(
                          "shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium",
                          mode.badge,
                        )}
                      >
                        {mode.label}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </DialogBody>
        <DialogFooter className="flex-row items-center justify-end py-5">
          <Link
            href={`/agents/new?template=${template.id}`}
            className={buttonVariants()}
          >
            Template verwenden
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
