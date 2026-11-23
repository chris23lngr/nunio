import { cn } from "@nunio/ui";
import { Button, buttonVariants } from "@nunio/ui/components/button/button";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Bot,
  CircleHelp,
  Clock,
  GitCompare,
  Hourglass,
} from "lucide-react";
import Link from "next/link";
import type { Intervention } from "../api/inbox-queries";
import { closedAs, headingOf, kindAs, when } from "../inbox-wording";

/** How each kind is drawn, what it adds to its heading, and where the student settles its cause. */
const kinds: Record<
  Intervention["kind"],
  {
    icon: LucideIcon;
    tile: string;
    detail?: string;
    goTo?: { label: string; href: string };
  }
> = {
  run_approvals: {
    icon: Bot,
    tile: "bg-primary-50 text-primary-600",
    detail: "Ohne Freigabe ändert sich an deinem Plan nichts.",
  },
  shortfall: {
    icon: Hourglass,
    tile: "bg-warning-50 text-warning-700",
    goTo: { label: "Im Plan ansehen", href: "/plan" },
  },
  disagreement: {
    icon: GitCompare,
    tile: "bg-destructive-50 text-destructive-600",
    detail: "nunio übernimmt keinen Wert, bis du entscheidest.",
    goTo: { label: "In „Prüfen“ klären", href: "/review" },
  },
  approval_expired: {
    icon: Clock,
    tile: "bg-base-100 text-base-600",
    detail: "nunio fragt nicht erneut.",
    goTo: { label: "Im Plan ansehen", href: "/plan" },
  },
  unconfirmed: {
    icon: CircleHelp,
    tile: "bg-base-100 text-base-600",
    detail: "nunio versucht es nicht von selbst noch einmal.",
    goTo: { label: "Im Plan nachsehen", href: "/plan" },
  },
};

/**
 * One Intervention as a row: open ones offer Verstanden and Nicht hilfreich (and the Run's Approvals or the page that
 * settles its cause); closed ones say how they were closed.
 */
export function InterventionItem({
  intervention: i,
  closing,
  onClose,
}: {
  intervention: Intervention;
  closing: boolean;
  onClose: (as: "acknowledged" | "dismissed") => void;
}) {
  const heading = headingOf(i);
  const { icon: Icon, tile, detail, goTo } = kinds[i.kind];
  const meta =
    i.kind === "run_approvals"
      ? [kindAs[i.kind], i.title, i.course]
      : [i.course, kindAs[i.kind]];
  const open = i.state === "open";
  return (
    <article
      aria-label={heading}
      className="flex items-start gap-4 border-b border-base-200 py-6 last-of-type:border-b-0"
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          tile,
        )}
      >
        <Icon aria-hidden="true" className="size-4.5" strokeWidth={1.8} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-4 text-xs font-medium text-base-500">
          <span>{meta.filter(Boolean).join(" · ")}</span>
          <span className="shrink-0">{when(i.closedAt ?? i.raisedAt)}</span>
        </div>
        <h3 className="mt-1.5 text-base font-medium text-base-800">
          {heading}
        </h3>
        {open && detail && (
          <p className="mt-1 text-sm text-base-500">{detail}</p>
        )}
        {open ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {i.run && (
              <Link
                href={`/agents/${i.run.agentId}?run=${i.run.id}`}
                className={cn(buttonVariants(), "h-8 pr-2")}
              >
                Freigaben öffnen
                <ArrowRight aria-hidden="true" />
              </Link>
            )}
            <Button
              type="button"
              variant={i.run ? "outline" : "primary"}
              className="h-8"
              disabled={closing}
              onClick={() => onClose("acknowledged")}
            >
              Verstanden
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-8 text-base-600"
              disabled={closing}
              onClick={() => onClose("dismissed")}
            >
              Nicht hilfreich
            </Button>
            {goTo && (
              <Link
                href={goTo.href}
                className="inline-flex h-8 items-center gap-1.5 rounded-md pr-2.5 pl-1 text-sm font-medium text-primary-600 hover:underline focus-visible:outline-2 focus-visible:outline-primary-500"
              >
                {goTo.label}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-base-500">
            {closedAs[i.state as keyof typeof closedAs]}
          </p>
        )}
      </div>
    </article>
  );
}
