const colors = ["bg-rose-500", "bg-fuchsia-500", "bg-purple-500", "bg-sky-500"];

/** A Course's color square; the color follows from its ID, so it matches everywhere. */
export function CourseDot({ id }: { id: string }) {
  const index =
    Array.from(id).reduce((sum, letter) => sum + letter.charCodeAt(0), 0) %
    colors.length;
  return (
    <span
      aria-hidden="true"
      data-slot="course-dot"
      className={`size-2 shrink-0 rounded-xs ${colors[index]}`}
    />
  );
}
