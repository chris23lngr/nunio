import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nunio/ui/components/select/select";
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
    <Select
      items={options}
      value={selected}
      onValueChange={(value) => {
        if (value !== null) onSelect(value);
      }}
    >
      <SelectTrigger aria-label="Semester">
        <SelectValue>
          {selected === "all" ? "Alle Semester" : semesterLabel(selected)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        align="end"
        sideOffset={8}
        alignItemWithTrigger={false}
        className="w-max min-w-(--anchor-width)"
      >
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
