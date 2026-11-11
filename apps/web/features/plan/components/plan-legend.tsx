import { cn } from "@nunio/ui";
import { Lock, Sparkles, User } from "lucide-react";

const icons = [
  { icon: User, label: "Von dir gesetzt", className: "text-base-500" },
  { icon: Sparkles, label: "Vorschlag", className: "text-primary-500" },
  { icon: Lock, label: "Gesperrt", className: "text-base-500" },
];

const swatches = [
  { label: "Fixtermin", className: "bg-base-300" },
  { label: "Lernblock", className: "bg-base-200" },
  {
    label: "Geschützte Zeit",
    className:
      "border border-base-300 bg-[repeating-linear-gradient(135deg,var(--color-base-300)_0_2px,white_2px_4px)]",
  },
];

/** What each icon and fill on the plan means. */
export function PlanLegend() {
  return (
    <ul aria-label="Legende" className="flex items-center gap-6">
      {icons.map(({ icon: Icon, label, className }) => (
        <li key={label} className="flex items-center gap-1.5">
          <Icon aria-hidden="true" className={cn("size-4", className)} />
          <span className="text-sm leading-4 text-base-600">{label}</span>
        </li>
      ))}
      {swatches.map(({ label, className }) => (
        <li key={label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn("size-3 shrink-0 rounded-xs", className)}
          />
          <span className="text-sm leading-4 text-base-600">{label}</span>
        </li>
      ))}
    </ul>
  );
}
