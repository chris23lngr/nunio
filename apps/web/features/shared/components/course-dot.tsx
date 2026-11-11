import type { CourseColor } from "@/features/courses/api/course-queries";
import { colors } from "@/features/courses/course-format";

/** A Course's color square. */
export function CourseDot({ color }: { color: CourseColor }) {
  return (
    <span
      aria-hidden="true"
      data-slot="course-dot"
      className="size-2 shrink-0 rounded-xs"
      style={{ backgroundColor: colors[color].swatch }}
    />
  );
}
