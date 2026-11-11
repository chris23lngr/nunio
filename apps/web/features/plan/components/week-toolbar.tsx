import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { isSameISOWeek } from "date-fns";
import {
  Calendar,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleOff,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { nextWeek, previousWeek, weekLabel } from "../plan-week";

export type DisplayOptions = {
  weekends: boolean;
  suggestions: boolean;
  protectedTime: boolean;
  calendar: boolean;
};

const displayItems = [
  { key: "weekends", label: "Wochenenden", Icon: CalendarDays },
  { key: "suggestions", label: "Vorschläge", Icon: Sparkles },
  { key: "protectedTime", label: "Blockierzeiten", Icon: CircleOff },
  { key: "calendar", label: "Mein Kalender", Icon: Calendar },
] as const;

export function WeekToolbar({
  week,
  today,
  onWeekChange,
  display,
  onDisplayChange,
}: {
  /** Any day in the shown week. */
  week: Date;
  today: Date;
  onWeekChange: (day: Date) => void;
  display: DisplayOptions;
  onDisplayChange: (next: DisplayOptions) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={isSameISOWeek(week, today)}
          onClick={() => onWeekChange(today)}
        >
          Heute
        </Button>
        <Button
          aria-label="Vorherige Woche"
          variant="outline"
          size="icon-sm"
          onClick={() => onWeekChange(previousWeek(week))}
        >
          <ChevronLeft />
        </Button>
        <Button
          aria-label="Nächste Woche"
          variant="outline"
          size="icon-sm"
          onClick={() => onWeekChange(nextWeek(week))}
        >
          <ChevronRight />
        </Button>
        <span className="text-base-600 text-sm">{weekLabel(week)}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button aria-label="Anzeige" variant="outline" size="icon-sm" />
          }
        >
          <SlidersHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-62">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Anzeige</DropdownMenuLabel>
            {displayItems.map(({ key, label, Icon }) => (
              <DropdownMenuCheckboxItem
                key={key}
                checked={display[key]}
                onCheckedChange={(checked) =>
                  onDisplayChange({ ...display, [key]: checked })
                }
              >
                <Icon />
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
