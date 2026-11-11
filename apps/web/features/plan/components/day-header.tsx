import { cn } from "@nunio/ui";
import { Progress } from "@nunio/ui/components/progress/progress";
import { format } from "date-fns";
import { de } from "date-fns/locale";

type DayHeaderProps = {
  date: Date;
  plannedMinutes: number;
  goalMinutes: number;
  today: boolean;
};

const hours = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

// Progress clamps the value to max, so above the goal the bar stays full
// while the text keeps the real hours.
export function DayHeader({
  date,
  plannedMinutes,
  goalMinutes,
  today,
}: DayHeaderProps) {
  const planned = hours.format(plannedMinutes / 60);
  const goal = hours.format(goalMinutes / 60);

  return (
    <div
      aria-current={today ? "date" : undefined}
      className="flex flex-col border-r border-b border-base-200 p-4"
    >
      <span
        className={cn(
          "text-sm font-medium text-base-800",
          today && "text-primary-600",
        )}
      >
        {format(date, "EEEE, dd.MM.", { locale: de })}
      </span>
      <Progress
        value={plannedMinutes}
        max={goalMinutes}
        aria-label={`${planned} von ${goal} Stunden geplant`}
        className="mt-3"
      />
      <span className="mt-1.5 text-xs text-base-500">
        {planned} / {goal} h
      </span>
    </div>
  );
}
