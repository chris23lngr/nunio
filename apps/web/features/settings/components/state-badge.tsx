/** A Connection's state as a badge: Verbunden, or Neu verbinden nötig. */
export function StateBadge({
  state,
}: {
  state: "connected" | "needs_reconnection";
}) {
  const connected = state === "connected";
  return (
    <span
      className={`flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] px-1.5 text-xs leading-4 font-medium ${
        connected
          ? "bg-success-50 text-success-800"
          : "bg-warning-50 text-warning-800"
      }`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${connected ? "bg-success-500" : "bg-warning-500"}`}
      />
      {connected ? "Verbunden" : "Neu verbinden nötig"}
    </span>
  );
}
