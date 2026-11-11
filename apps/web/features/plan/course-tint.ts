import type { CourseColor } from "@/features/courses/api/course-queries";

/** Each course color's Tailwind classes, written out so Tailwind finds them. */
export const courseTint: Record<
  CourseColor,
  { fixed: string; study: string; ring: string }
> = {
  rose: {
    fixed: "bg-rose-200 text-rose-950",
    study: "bg-rose-50 text-rose-950",
    ring: "ring-rose-300/60",
  },
  orange: {
    fixed: "bg-orange-200 text-orange-950",
    study: "bg-orange-50 text-orange-950",
    ring: "ring-orange-300/60",
  },
  amber: {
    fixed: "bg-amber-200 text-amber-950",
    study: "bg-amber-50 text-amber-950",
    ring: "ring-amber-300/60",
  },
  emerald: {
    fixed: "bg-emerald-200 text-emerald-950",
    study: "bg-emerald-50 text-emerald-950",
    ring: "ring-emerald-300/60",
  },
  teal: {
    fixed: "bg-teal-200 text-teal-950",
    study: "bg-teal-50 text-teal-950",
    ring: "ring-teal-300/60",
  },
  blue: {
    fixed: "bg-blue-200 text-blue-950",
    study: "bg-blue-50 text-blue-950",
    ring: "ring-blue-300/60",
  },
  violet: {
    fixed: "bg-violet-200 text-violet-950",
    study: "bg-violet-50 text-violet-950",
    ring: "ring-violet-300/60",
  },
  fuchsia: {
    fixed: "bg-fuchsia-200 text-fuchsia-950",
    study: "bg-fuchsia-50 text-fuchsia-950",
    ring: "ring-fuchsia-300/60",
  },
};
