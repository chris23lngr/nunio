import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { semesterLabel } from "../course-format";

/** The current Semester, every other Semester that has Courses (newest first), and all of them. */
export function SemesterFilter({
  current,
  withCourses,
  selected,
  onSelect,
}: {
  current: string;
  withCourses: string[];
  selected: string;
  onSelect: (semester: string) => void;
}) {
  const others = [...new Set(withCourses)]
    .filter((semester) => semester !== current)
    .sort((a, b) => b.localeCompare(a));
  const options = [
    { value: current, label: `${semesterLabel(current)} (aktuell)` },
    ...others.map((value) => ({ value, label: semesterLabel(value) })),
    { value: "all", label: "Alle Semester" },
  ];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        {selected === "all" ? "Alle Semester" : semesterLabel(selected)}
        <ChevronDown data-icon="inline-end" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={selected}
          onValueChange={(value) => onSelect(String(value))}
        >
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
