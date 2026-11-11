import { CalendarClock } from "lucide-react";
import type { ReactNode } from "react";
import type { CourseSummary } from "../api/course-queries";
import { colors, dueText } from "../course-format";

/** One Course: its code, color and title, and the earliest Obligation still ahead. */
export function CourseCard({
  course,
  menu,
}: {
  course: CourseSummary;
  menu?: ReactNode;
}) {
  return (
    <li
      className={`flex flex-col gap-2 rounded-xl p-6 shadow-xs outline outline-base-700/15 ${course.archived ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {course.code && (
            <p className="text-sm text-base-500">{course.code}</p>
          )}
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-xs"
              style={{ backgroundColor: colors[course.color].swatch }}
            />
            <h2 className="truncate text-base font-medium text-base-800">
              {course.title}
            </h2>
            {course.archived && (
              <span className="shrink-0 rounded-sm bg-base-100 px-1.5 text-xs text-base-600">
                Archiviert
              </span>
            )}
          </div>
        </div>
        {menu}
      </div>
      <p className="flex items-center gap-2 text-sm text-base-600">
        <CalendarClock
          aria-hidden="true"
          className="size-4 shrink-0 text-base-500"
        />
        <span className="truncate">
          {course.next ? dueText(course.next) : "Nichts fällig"}
        </span>
        {course.next?.unreviewed && (
          <span
            className="shrink-0 rounded-sm bg-base-100 px-1.5 text-xs text-base-600"
            title="nunio hat diesen Termin aus deinen Quellen gelesen; du hast ihn noch nicht geprüft."
          >
            ungeprüft
          </span>
        )}
      </p>
    </li>
  );
}
