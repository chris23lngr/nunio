"use client";

import { cn } from "@nunio/ui";
import type { AgentTemplate } from "../api/agent-queries";

const templateBannerPalette = [
  "bg-[oklch(90.5%_0.093_164.1)]",
  "bg-[oklch(89.4%_0.057_293.3)]",
  "bg-[oklch(89.2%_0.058_10)]",
] as const;

const templateBannersById: Record<string, string> = {
  prepareExam: templateBannerPalette[0],
  organizeCourse: templateBannerPalette[1],
  createBriefings: templateBannerPalette[2],
};

/** Pastel banner background for a curated Template card or details dialog. */
export function templateBannerClass(templateId: string): string {
  const known = templateBannersById[templateId];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < templateId.length; i++) {
    hash = (hash * 31 + templateId.charCodeAt(i)) >>> 0;
  }
  return templateBannerPalette[hash % templateBannerPalette.length]!;
}

/** One curated Template card in the list strip or Templates grid. Never shows "Von N Anderen genutzt" (#147). */
export function TemplateCard({
  template,
  variant = "grid",
  onSelect,
}: {
  template: AgentTemplate;
  /** "strip" sits flush on the bottom of the grey Templates box; "grid" is a full bordered card. */
  variant?: "strip" | "grid";
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex flex-col items-start overflow-hidden bg-white text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary-500",
        variant === "strip"
          ? "rounded-t-lg"
          : "rounded-lg border border-base-200",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex w-full items-end px-5 py-4 text-xl leading-5 font-medium text-base-700",
          templateBannerClass(template.id),
        )}
      >
        {template.emoji}
      </span>
      <span className="flex w-full flex-1 flex-col gap-1 p-5 transition-colors group-hover:bg-base-50">
        <span className="text-sm font-medium text-base-800">
          {template.name}
        </span>
        <span className="text-sm leading-5 text-base-500">
          {template.description}
        </span>
      </span>
    </button>
  );
}
