import { cn } from "@nunio/ui";
import { format, isSameDay, max, min, setHours, startOfDay } from "date-fns";
import { de } from "date-fns/locale";
import type { ReactNode } from "react";
import { assignLanes, displayForm, entryGeometry } from "../entry-layout";

export type GridEntry = {
  id: string;
  start: Date;
  end: Date;
  render: (form: { compact: boolean; narrow: boolean }) => ReactNode;
};

/** Drawn full column width under the entries, such as Protected Time. */
export type GridBackground = {
  id: string;
  start: Date;
  end: Date;
  node: ReactNode;
};

type WeekGridProps = {
  days: Date[];
  fromHour: number;
  toHour: number;
  header?: (day: Date) => ReactNode;
  entries: GridEntry[];
  background?: GridBackground[];
};

const INSET_PX = 4;
const LANE_GAP_PX = 2;
/** One line of text-xs: shorter entries may overlap the next slot rather than clip. */
const MIN_HEIGHT_PX = 16;

/**
 * A day is at least 128px wide; on mobile two days share the width beside the
 * 48px time gutter, and the grid snaps to whole days. Zero width keeps long day
 * names from widening the week; the column grows from its minimum.
 */
const dayColumn = "w-0 min-w-[calc((100cqw-3rem)/2)] flex-1 md:min-w-32";

export function WeekGrid({
  days,
  fromHour,
  toHour,
  header,
  entries,
  background = [],
}: WeekGridProps) {
  const hours = Array.from(
    { length: toHour - fromHour },
    (_, i) => fromHour + i,
  );

  const percentOf = (hour: number) =>
    ((hour - fromHour) / (toHour - fromHour)) * 100;

  // Fills its parent, hour rows stretching down to 32px; below that, and below
  // the minimum day width, it scrolls with the day headers and hours in view.
  return (
    <div className="@container h-full overflow-auto max-md:snap-x max-md:snap-mandatory max-md:scroll-pl-12">
      <div className="flex min-h-full min-w-min flex-col">
        {header && (
          <div className="sticky top-0 z-20 flex bg-white">
            <div className="sticky left-0 z-10 w-12 shrink-0 bg-white" />
            {days.map((day) => (
              <div key={day.toISOString()} className={dayColumn}>
                {header(day)}
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-1">
          <div className="sticky left-0 z-10 w-12 shrink-0 border-r border-base-200 bg-white">
            {hours
              .filter((hour) => hour > fromHour && hour % 2 === 0)
              .map((hour) => (
                <span
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 text-xs text-base-500"
                  style={{ top: `${percentOf(hour)}%` }}
                >
                  {`${String(hour).padStart(2, "0")}:00`}
                </span>
              ))}
          </div>
          {days.map((day) => (
            // biome-ignore lint/a11y/useSemanticElements: A day column groups calendar entries, not form fields.
            <div
              key={day.toISOString()}
              role="group"
              aria-label={format(day, "EEEE, d. MMMM", { locale: de })}
              className={cn(
                dayColumn,
                "relative flex flex-col overflow-hidden max-md:snap-start",
              )}
            >
              {hours.map((hour, i) => (
                <div
                  key={hour}
                  className={cn(
                    "min-h-8 flex-1 border-r border-b border-base-200",
                    (i === 0 || i === hours.length - 1) && "bg-base-50",
                  )}
                />
              ))}
              {background
                .filter((item) => isSameDay(item.start, day))
                .flatMap((item) => {
                  // Cut to the shown hours, so an all-day range stays inside the grid.
                  const start = max([
                    item.start,
                    setHours(startOfDay(day), fromHour),
                  ]);
                  const end = min([
                    item.end,
                    setHours(startOfDay(day), toHour),
                  ]);
                  return start < end ? [{ ...item, start, end }] : [];
                })
                .map((item) => {
                  const { top, height } = entryGeometry(
                    fromHour,
                    toHour,
                    item.start,
                    item.end,
                  );
                  return (
                    <div
                      key={item.id}
                      className="absolute inset-x-0"
                      style={{ top: `${top}%`, height: `${height}%` }}
                    >
                      {item.node}
                    </div>
                  );
                })}
              {assignLanes(
                entries.filter((entry) => isSameDay(entry.start, day)),
              ).map((entry) => {
                const { top, height } = entryGeometry(
                  fromHour,
                  toHour,
                  entry.start,
                  entry.end,
                );
                const width = `((100% - ${2 * INSET_PX + (entry.lanes - 1) * LANE_GAP_PX}px) / ${entry.lanes})`;
                return (
                  <div
                    key={entry.id}
                    className="absolute"
                    style={{
                      top: `calc(${top}% + ${INSET_PX}px)`,
                      height: `max(${height}% - ${2 * INSET_PX}px, ${MIN_HEIGHT_PX}px)`,
                      left: `calc(${INSET_PX}px + ${entry.lane} * (${width} + ${LANE_GAP_PX}px))`,
                      width: `calc${width}`,
                    }}
                  >
                    {entry.render(
                      displayForm(entry.start, entry.end, entry.lanes),
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
