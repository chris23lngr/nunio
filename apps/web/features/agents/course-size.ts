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
