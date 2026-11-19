/** What an Agent will read of a Course, such as "12 Themen · 3 Quellen". */
export function courseSize({
  topics,
  sources,
}: {
  topics: number;
  sources: number;
}) {
  return `${topics} ${topics === 1 ? "Thema" : "Themen"} · ${sources} ${sources === 1 ? "Quelle" : "Quellen"}`;
}

/**
 * Why one of the Agent's Courses can no longer be picked: it is Archived, or it was deleted, merged or Archived since
 * the Courses on offer were read. Null while it is on offer, or before they are.
 */
export function unavailable(
  course: { id: string; archived: boolean },
  offered: { id: string }[] | undefined,
) {
  if (course.archived) return "Archiviert";
  if (offered && !offered.some((each) => each.id === course.id))
    return "Nicht mehr verfügbar";
  return null;
}
