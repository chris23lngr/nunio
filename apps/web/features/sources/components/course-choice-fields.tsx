import type { paths } from "@nunio/api-client";
import { Field, FieldLabel } from "@nunio/ui/components/field/field";
import { Input } from "@nunio/ui/components/input/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nunio/ui/components/select/select";
import { useId } from "react";
import type { CourseSummary } from "@/features/courses/api/course-queries";

/** An accepted Course, a new one, or null: nunio recognizes the Courses itself. */
export type CourseChoice = NonNullable<
  paths["/api/me/sources/{id}/course"]["post"]["requestBody"]
>["content"]["application/json"]["course"];

/** The select's value for a new Course; "" is "Automatisch erkennen", anything else a Course id. */
export const newCourse = "new";

/** The choice the student selected, with the new Course's name read from the form's fields below. */
export function courseChoiceFrom(
  selected: string,
  form: HTMLFormElement,
): CourseChoice {
  if (!selected) return null;
  if (selected !== newCourse) return { id: selected };
  const data = new FormData(form);
  const field = (name: string) => String(data.get(name) ?? "").trim();
  return { title: field("courseTitle"), code: field("courseCode") || null };
}

export const courseName = (course: CourseSummary) =>
  `${course.code ? `${course.code} ` : ""}${course.title}${course.archived ? " (archiviert)" : ""}`;

/**
 * Choosing the Course a Source belongs to: an accepted Course that is not Archived, a new one, or "Automatisch
 * erkennen". The Course a Source is bound to now stays listed even when it no longer could be chosen, so keeping the
 * current choice never unbinds it.
 */
export function CourseChoiceFields({
  courses,
  current,
  selected,
  onSelect,
  disabled,
}: {
  courses: CourseSummary[];
  current?: CourseSummary;
  selected: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const choosable = courses.filter(
    (course) =>
      (course.status === "accepted" && !course.archived) ||
      course.id === current?.id,
  );
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${id}-course`}>Kurs</FieldLabel>
        <Select
          items={[
            { value: "", label: "Automatisch erkennen" },
            ...choosable.map((course) => ({
              value: course.id,
              label: courseName(course),
            })),
            { value: newCourse, label: "Neuer Kurs …" },
          ]}
          value={selected}
          disabled={disabled}
          onValueChange={(value) => {
            if (value !== null) onSelect(value);
          }}
        >
          <SelectTrigger id={`${id}-course`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            align="start"
            sideOffset={8}
            alignItemWithTrigger={false}
          >
            <SelectGroup>
              <SelectItem value="">Automatisch erkennen</SelectItem>
              {choosable.map((course) => (
                <SelectItem key={course.id} value={course.id}>
                  {courseName(course)}
                </SelectItem>
              ))}
              <SelectItem value={newCourse}>Neuer Kurs …</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {selected === newCourse && (
        <>
          <Field>
            <FieldLabel htmlFor={`${id}-title`}>Titel</FieldLabel>
            <Input
              id={`${id}-title`}
              name="courseTitle"
              required
              maxLength={500}
              placeholder="z. B. Lineare Algebra I"
              disabled={disabled}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-code`}>Kürzel (optional)</FieldLabel>
            <Input
              id={`${id}-code`}
              name="courseCode"
              maxLength={50}
              placeholder="z. B. MA-102"
              disabled={disabled}
            />
          </Field>
        </>
      )}
    </>
  );
}
