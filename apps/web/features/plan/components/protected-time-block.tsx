/** Protected Time in the week grid: striped, labelled, not interactive; fills its box. */
export function ProtectedTimeBlock({
  label = "Geschützte Zeit",
}: {
  label?: string;
}) {
  return (
    <div
      role="note"
      className="flex h-full w-full justify-center bg-[repeating-linear-gradient(135deg,var(--color-base-100)_0_6px,white_6px_12px)] pt-2.5"
    >
      <span className="h-fit rounded-sm bg-white px-1.5 py-0.5 font-medium text-base-600 text-xs">
        {label}
      </span>
    </div>
  );
}
