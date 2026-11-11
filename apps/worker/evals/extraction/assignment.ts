/** Every bound deck must contribute review items exclusively to the chosen Course. */
export function scoreBoundCourse(
  courseId: string,
  sources: {
    extraction: string;
    boundCourseId: string | null;
    itemCourseIds: string[];
  }[],
  proposals: number,
) {
  return (
    sources.length >= 2 &&
    proposals === 0 &&
    sources.every(
      (source) =>
        source.extraction === "done" &&
        source.boundCourseId === courseId &&
        source.itemCourseIds.length > 0 &&
        source.itemCourseIds.every((id) => id === courseId),
    )
  );
}
