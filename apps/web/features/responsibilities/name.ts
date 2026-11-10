/** How a Responsibility is named to the student: after its exam, or after its Course. */
export function nameOf(r: {
  course: { title: string } | null;
  exam: { title: string } | null;
}) {
  return r.exam
    ? `Prepare for ${r.exam.title}`
    : `Keep ${r.course?.title ?? "a Course that is gone"} organized`;
}

/** Why a Responsibility is Paused, in words; null when the student paused it. */
export const pausedBecause = {
  student: null,
  budget: "its Budget is used up",
  course_archived: "its Course is archived",
} as const;
