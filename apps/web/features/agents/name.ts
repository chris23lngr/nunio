/** How an Agent is named to the student: by its name, or a preset's after its exam or its Course. */
export function nameOf(r: {
  /** Empty for a preset Agent. */
  name?: string;
  course: { title: string } | null;
  exam: { title: string } | null;
}) {
  if (r.name) return r.name;
  return r.exam
    ? `Prepare for ${r.exam.title}`
    : `Keep ${r.course?.title ?? "a Course that is gone"} organized`;
}

/** Why an Agent is Paused, in words; null when the student paused it. */
export const pausedBecause = {
  student: null,
  budget: "its Budget is used up",
  course_archived: "its Course is archived",
} as const;
