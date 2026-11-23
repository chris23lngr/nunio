"use client";

import { cn } from "@nunio/ui";
import { Button, buttonVariants } from "@nunio/ui/components/button/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nunio/ui/components/dialog/dialog";
import { CalendarPlus, Users, X } from "lucide-react";
import Link from "next/link";
import type { AgentTemplate } from "../api/agent-queries";
import { templateBannerClass } from "./template-card";

const formatCreatedOn = (isoDate: string) =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));

/**
 * A curated Template's details: pastel banner with emoji, creation date, how many other students used it
 * (hidden when 0), a visible close button, and "Template verwenden".
 */
export function TemplateDetailsDialog({
  template,
  onClose,
}: {
  apiOrigin?: string;
  template: AgentTemplate | null;
  onClose: () => void;
}) {
  if (!template) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-w-lg overflow-hidden"
      >
        <div
          className={cn(
            "relative flex h-24 shrink-0 flex-col justify-end px-6 py-4",
            templateBannerClass(template.id),
          )}
        >
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Schließen"
                className="absolute top-6 right-6 text-base-500 hover:bg-black/5"
              />
            }
          >
            <X aria-hidden="true" className="size-5" />
          </DialogClose>
          <span
            aria-hidden="true"
            className="text-4xl leading-9 font-medium text-base-700"
          >
            {template.emoji}
          </span>
        </div>
        <DialogHeader className="gap-0">
          <DialogTitle className="pr-0">{template.name}</DialogTitle>
          <DialogDescription className="mt-1">
            {template.description}
          </DialogDescription>
          <div className="mt-4 flex flex-col gap-2 text-sm text-base-600">
            <span className="inline-flex items-center gap-2">
              <CalendarPlus
                aria-hidden="true"
                className="size-4 shrink-0 text-base-500"
              />
              Erstellt am {formatCreatedOn(template.createdOn)}
            </span>
            {template.othersCount > 0 && (
              <span className="inline-flex items-center gap-2">
                <Users
                  aria-hidden="true"
                  className="size-4 shrink-0 text-base-500"
                />
                Von {template.othersCount} Anderen genutzt
              </span>
            )}
          </div>
        </DialogHeader>
        <DialogFooter className="flex-row items-center justify-end">
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
