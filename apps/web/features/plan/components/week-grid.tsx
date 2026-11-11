import { cn } from "@nunio/ui";
import { format, isSameDay } from "date-fns";
import { de } from "date-fns/locale";
import type { ReactNode } from "react";
import {
  assignLanes,
  displayForm,
  entryGeometry,
  HOUR_PX,
} from "../entry-layout";

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

  return (
    <div className="flex flex-col">
      {header && (
        <div className="flex">
          <div className="w-[59px] shrink-0" />
          {days.map((day) => (
            <div key={day.toISOString()} className="min-w-0 flex-1">
              {header(day)}
            </div>
          ))}
        </div>
      )}
      <div className="flex">
        <div className="relative w-[59px] shrink-0 border-r border-base-200">
          {hours
            .filter((hour) => hour > fromHour && hour % 2 === 0)
            .map((hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-xs text-base-500"
                style={{ top: (hour - fromHour) * HOUR_PX }}
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
            className="relative min-w-0 flex-1"
          >
            {hours.map((hour, i) => (
              <div
                key={hour}
                className={cn(
                  "h-8 border-r border-b border-base-200",
                  (i === 0 || i === hours.length - 1) && "bg-base-50",
                )}
              />
            ))}
            {background
              .filter((item) => isSameDay(item.start, day))
              .map((item) => (
                <div
                  key={item.id}
                  className="absolute inset-x-0"
                  style={entryGeometry(fromHour, item.start, item.end)}
                >
                  {item.node}
                </div>
              ))}
            {assignLanes(
              entries.filter((entry) => isSameDay(entry.start, day)),
            ).map((entry) => {
              const { top, height } = entryGeometry(
                fromHour,
                entry.start,
                entry.end,
              );
              const width = `((100% - ${2 * INSET_PX + (entry.lanes - 1) * LANE_GAP_PX}px) / ${entry.lanes})`;
              return (
                <div
                  key={entry.id}
                  className="absolute"
                  style={{
                    top: top + INSET_PX,
                    height: height - 2 * INSET_PX,
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
  );
}
