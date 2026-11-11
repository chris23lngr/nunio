import { Button } from "@nunio/ui/components/button/button";
import { Progress } from "@nunio/ui/components/progress/progress";
import {
  differenceInCalendarDays,
  differenceInMinutes,
  format,
} from "date-fns";
import { de } from "date-fns/locale";
import type { LucideIcon } from "lucide-react";
import {
  Clock,
  Flag,
  Hourglass,
  Lock,
  LockOpen,
  Move,
  Trash2,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { CourseColor } from "@/features/courses/api/course-queries";
import { colors } from "@/features/courses/course-format";
import { CourseDot } from "@/features/shared/components/course-dot";

const number = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

/** 120 minutes as "2 h", 90 as "1,5 h". */
const hours = (minutes: number) => `${number.format(minutes / 60)} h`;

const day = (date: Date) => format(date, "EEEE, dd.MM.", { locale: de });

/** How far a due date is from today: "vor 3 Tagen", "gestern", "heute", "morgen", "in 7 Tagen". */
function fromToday(due: Date, today: Date) {
  const days = differenceInCalendarDays(due, today);
  if (days < -1) return `vor ${-days} Tagen`;
  if (days === -1) return "gestern";
  if (days === 0) return "heute";
  if (days === 1) return "morgen";
  return `in ${days} Tagen`;
}

/** One line of the details: an icon, a main line and a quieter line below it. */
function Detail({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-base-500"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-sm font-medium text-base-800">{title}</div>
        {children}
      </div>
    </div>
  );
}

/** The day, and the time with how long it lasts. */
function When({ start, end }: { start: Date; end: Date }) {
  return (
    <Detail icon={Clock} title={day(start)}>
      <p className="text-xs text-base-500">
        {`${format(start, "HH:mm")} – ${format(end, "HH:mm")} Uhr · ${hours(differenceInMinutes(end, start))}`}
      </p>
    </Detail>
  );
}

/**
 * What the popover of a Fixed Event shows. nunio didn't create it, so all it knows is
 * what, when, and which calendar it came from (`null`: entered by hand).
 * Render it in `<PopoverContent className="w-76 gap-0 p-0">`, like EntryDetails.
 */
export function FixedEventDetails({
  title,
  start,
  end,
  calendar,
}: {
  title: string;
  start: Date;
  end: Date;
  calendar: string | null;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[inherit]">
      <div className="flex flex-col gap-1.5 px-3.5 pt-3.5 pb-3">
        <p className="break-words text-sm font-medium text-base-800">{title}</p>
        <p className="text-xs text-base-500">
          {calendar
            ? `Fixtermin aus „${calendar}“`
            : "Fixtermin, von dir eingetragen"}
        </p>
      </div>
      <div className="flex flex-col gap-4 border-t border-base-200 px-3.5 py-3">
        <When start={start} end={end} />
      </div>
      <p className="border-t border-base-200 bg-base-50 px-3.5 py-2.5 text-xs text-base-500">
        Mehr weiß nunio über diesen Termin nicht. nunio plant um ihn herum.
      </p>
    </div>
  );
}

/**
 * What the popover of a Study Block shows: when it is, what it works toward, and what can be done with it.
 * PopoverContent draws the card; its sections run edge to edge, so render it in
 * `<PopoverContent className="w-76 gap-0 p-0">`.
 */
export function EntryDetails({
  course,
  title,
  placedBy,
  start,
  end,
  obligation,
  today,
  estimate,
  locked,
  onLockChange,
  onMove,
  onDelete,
}: {
  course: { title: string; color: CourseColor } | null;
  title: string;
  placedBy: "nunio" | "student";
  start: Date;
  end: Date;
  obligation: { title: string; due: Date } | null;
  today: Date;
  estimate: {
    plannedMinutes: number;
    estimatedMinutes: number;
    rationale: string | null;
  } | null;
  locked: boolean;
  onLockChange: (locked: boolean) => void;
  /** Shown only when given; moving needs a time picker that isn't designed yet. */
  onMove?: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[inherit]">
      <div className="flex flex-col gap-1.5 px-3.5 pt-3.5 pb-3">
        <div className="flex items-start gap-2 text-sm">
          {course && (
            <span className="flex h-5 shrink-0 items-center">
              <CourseDot color={course.color} />
            </span>
          )}
          <p className="min-w-0 break-words">
            {course && (
              <>
                <span className="text-base-500">{course.title}</span>
                <span className="text-base-500"> / </span>
              </>
            )}
            <span className="font-medium text-base-800">{title}</span>
          </p>
        </div>
        <p className="text-xs text-base-500">
          {placedBy === "nunio"
            ? "Lernblock, von nunio geplant"
            : "Lernblock, von dir gesetzt"}
        </p>
      </div>
      <div className="flex flex-col gap-4 border-t border-base-200 px-3.5 py-3">
        <When start={start} end={end} />
        {obligation && (
          <Detail icon={Flag} title={obligation.title}>
            <p className="text-xs text-base-500">
              {`Fällig ${day(obligation.due)} · ${fromToday(obligation.due, today)}`}
            </p>
          </Detail>
        )}
        {estimate && (
          <Detail
            icon={Hourglass}
            title={
              <div className="flex items-baseline justify-between gap-2">
                <span>{`${number.format(estimate.plannedMinutes / 60)} von ${hours(estimate.estimatedMinutes)} eingeplant`}</span>
                <span className="text-xs font-normal text-base-500">
                  {`${Math.round((estimate.plannedMinutes / estimate.estimatedMinutes) * 100)} %`}
                </span>
              </div>
            }
          >
            <Progress
              value={estimate.plannedMinutes}
              max={estimate.estimatedMinutes}
              aria-label="Eingeplant von der Schätzung"
              className="mt-1.5"
              style={
                course
                  ? ({
                      "--progress-indicator": colors[course.color].swatch,
                    } as CSSProperties)
                  : undefined
              }
            />
            {estimate.rationale && (
              <p className="mt-1.5 text-xs text-base-500">
                {estimate.rationale}
              </p>
            )}
          </Detail>
        )}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-base-200 bg-base-50 px-3.5 py-2.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onLockChange(!locked)}
        >
          {locked ? <LockOpen /> : <Lock />}
          {locked ? "Entsperren" : "Sperren"}
        </Button>
        {onMove && (
          <Button variant="outline" size="sm" onClick={onMove}>
            <Move />
            Verschieben
          </Button>
        )}
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 />
          Löschen
        </Button>
      </div>
    </div>
  );
}
