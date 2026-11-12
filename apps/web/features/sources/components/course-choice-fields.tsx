import type { paths } from "@nunio/api-client";
import { Field, FieldLabel } from "@nunio/ui/components/field/field";
import { Input } from "@nunio/ui/components/input/input";
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
        <select
          id={`${id}-course`}
          className="h-7.5 rounded-md bg-white px-2 text-sm text-base-800 shadow-sm outline outline-base-700/15"
          value={selected}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">Automatisch erkennen</option>
          {choosable.map((course) => (
            <option key={course.id} value={course.id}>
              {courseName(course)}
            </option>
          ))}
          <option value={newCourse}>Neuer Kurs …</option>
        </select>
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
