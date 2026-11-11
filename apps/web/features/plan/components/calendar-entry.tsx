import { cn } from "@nunio/ui";
import { format } from "date-fns";
import { Lock, Sparkles, User } from "lucide-react";
import type { CSSProperties } from "react";
import type { CourseColor } from "@/features/courses/api/course-queries";
import { colors } from "@/features/courses/course-format";
import { courseTint } from "../course-tint";

/** A Fixed Event, Study Block, or proposed Study Block in the week grid; fills its box. */
export function CalendarEntry({
  kind,
  title,
  start,
  end,
  course,
  placedByStudent,
  locked,
  selected,
  compact,
  narrow,
  onSelect,
}: {
  kind: "fixed" | "study" | "proposal";
  title: string;
  start: Date;
  end: Date;
  course: { title: string; color: CourseColor } | null;
  placedByStudent?: boolean;
  locked?: boolean;
  selected?: boolean;
  /** Shorter than 2 h: one line, title only. */
  compact: boolean;
  /** Shares its slot side by side: title wraps, time hidden. */
  narrow: boolean;
  onSelect?: () => void;
}) {
  const from = format(start, "HH:mm");
  const tinted = course !== null && kind !== "proposal";
  const fill =
    kind === "proposal"
      ? "border border-dashed border-primary-400 bg-primary-50 text-primary-900"
      : tinted
        ? courseTint[kind]
        : kind === "fixed"
          ? "bg-base-200 text-base-800"
          : "bg-base-100 text-base-800";
  const ring =
    kind === "proposal"
      ? "ring-primary-300"
      : tinted
        ? courseTint.ring
        : "ring-base-300";
  // The label replaces the button's content for assistive tech, so it carries
  // the time (hidden when compact or narrow) and every marker.
  const name = [
    title,
    `${from}–${format(end, "HH:mm")}`,
    kind === "proposal" && "Vorschlag",
    placedByStudent && "von dir gesetzt",
    locked && "gesperrt",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <button
      type="button"
      aria-label={name}
      onClick={onSelect}
      style={
        tinted
          ? ({ "--tint": colors[course.color].swatch } as CSSProperties)
          : undefined
      }
      className={cn(
        // The selected ring doubles as the focus ring, in place of the browser outline.
        "flex h-full w-full flex-col gap-0.5 overflow-hidden rounded-sm p-1.5 text-left text-xs outline-none focus-visible:ring-2",
        onSelect && "cursor-pointer",
        compact && "justify-center py-0",
        fill,
        ring,
        selected && "ring-2",
      )}
    >
      <span className="flex items-center gap-1">
        <span
          className={cn(
            "min-w-0 font-medium",
            narrow && !compact ? "line-clamp-2" : "truncate",
          )}
        >
          {title}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {placedByStudent && (
            <User aria-hidden className="size-3" strokeWidth={2.2} />
          )}
          {locked && <Lock aria-hidden className="size-3" />}
          {kind === "proposal" && (
            <Sparkles aria-hidden className="size-3 text-primary-500" />
          )}
        </span>
      </span>
      {!compact && !narrow && (
        <span
          className={cn(
            "truncate",
            kind === "proposal" && "text-primary-800",
            kind === "fixed" && !course && "text-base-700",
          )}
        >
          {from} Uhr
          {kind === "proposal" && course && ` · ${course.title}`}
        </span>
      )}
    </button>
  );
}
