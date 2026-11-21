"use client";

import type { AgentTemplate } from "../api/agent-queries";

/** One curated Template card in the list strip or Templates grid. Never shows "Von N Anderen genutzt" (#147). */
export function TemplateCard({
  template,
  onSelect,
}: {
  template: AgentTemplate;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col items-start gap-3 rounded-xl border border-base-200 bg-white p-4 text-left transition-colors hover:bg-base-50 focus-visible:outline-2 focus-visible:outline-primary-500"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-base-100 text-lg"
      >
        {template.emoji}
      </span>
      <span className="flex flex-col gap-1">
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
