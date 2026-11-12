import type { FormEventHandler } from "react";
import type { CourseSummary } from "@/features/courses/api/course-queries";
import { CourseChoiceFields } from "./course-choice-fields";

export function SourceUploadForm({
  onSubmit,
  courses,
  course,
  onCourse,
  disabled,
  uploading,
}: {
  onSubmit: FormEventHandler<HTMLFormElement>;
  courses: CourseSummary[];
  course: string;
  onCourse: (value: string) => void;
  disabled: boolean;
  uploading: boolean;
}) {
  return (
    <form onSubmit={onSubmit}>
      <label>
        PDF{" "}
        <input
          name="source"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          required
          disabled={disabled}
        />
      </label>
      {/* One choice for every file of this upload. */}
      <CourseChoiceFields
        courses={courses}
        selected={course}
        onSelect={onCourse}
        disabled={disabled}
      />
      <button type="submit" disabled={disabled}>
        {uploading ? "Uploading PDF…" : "Upload PDF"}
      </button>
    </form>
  );
}
