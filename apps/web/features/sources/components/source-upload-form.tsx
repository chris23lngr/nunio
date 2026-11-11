import type { FormEventHandler } from "react";
import type { CourseSummary } from "@/features/courses/api/course-queries";
import { CourseChoiceFields } from "./course-choice-fields";

export function SourceUploadForm({
  onSubmit,
  courses,
  disabled,
  uploading,
}: {
  onSubmit: FormEventHandler<HTMLFormElement>;
  courses: CourseSummary[];
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
      <CourseChoiceFields courses={courses} disabled={disabled} />
      <button type="submit" disabled={disabled}>
        {uploading ? "Uploading PDF…" : "Upload PDF"}
      </button>
    </form>
  );
}
