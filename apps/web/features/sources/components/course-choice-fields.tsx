import type { paths } from "@nunio/api-client";
import { Field, FieldLabel } from "@nunio/ui/components/field/field";
import { Input } from "@nunio/ui/components/input/input";
import { useId, useState } from "react";
import type { CourseSummary } from "@/features/courses/api/course-queries";

/** An accepted Course, a new one, or null: nunio recognizes the Courses itself. */
export type CourseChoice = NonNullable<
  paths["/api/me/sources/{id}/course"]["post"]["requestBody"]
>["content"]["application/json"]["course"];

const newCourse = "new";

/** Reads the choice the fields below put in their form. */
export function courseChoiceFrom(form: HTMLFormElement): CourseChoice {
  const data = new FormData(form);
  const field = (name: string) => String(data.get(name) ?? "").trim();
  const course = field("course");
  if (!course) return null;
  if (course !== newCourse) return { id: course };
  return { title: field("courseTitle"), code: field("courseCode") || null };
}

/** The Courses a Source can be bound to: accepted ones that are not Archived. */
export const bindable = (courses: CourseSummary[]) =>
  courses.filter((course) => course.status === "accepted" && !course.archived);

/** Choosing the Course a Source belongs to: an existing one, a new one, or "Automatisch erkennen". */
export function CourseChoiceFields({
  courses,
  defaultCourseId = null,
  disabled,
}: {
  courses: CourseSummary[];
  defaultCourseId?: string | null;
  disabled?: boolean;
}) {
  const id = useId();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${id}-course`}>Kurs</FieldLabel>
        <select
          id={`${id}-course`}
          name="course"
          className="h-7.5 rounded-md bg-white px-2 text-sm text-base-800 shadow-sm outline outline-base-700/15"
          defaultValue={defaultCourseId ?? ""}
          disabled={disabled}
          onChange={(event) => setCreating(event.target.value === newCourse)}
        >
          <option value="">Automatisch erkennen</option>
          {bindable(courses).map((course) => (
            <option key={course.id} value={course.id}>
              {course.code ? `${course.code} ` : ""}
              {course.title}
            </option>
          ))}
          <option value={newCourse}>Neuer Kurs …</option>
        </select>
      </Field>
      {creating && (
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
