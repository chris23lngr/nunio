import type { Unconfirmed } from "../api/approval-queries";

/** An Action nunio attempted but cannot confirm happened; the student says which it was. */
export function UnconfirmedCard({
  unconfirmed,
  busy,
  onResolve,
}: {
  unconfirmed: Unconfirmed;
  busy: boolean;
  onResolve: (resolution: "happened" | "did_not_happen") => void;
}) {
  const { action } = unconfirmed;
  const verb =
    action.kind === "studyBlock.move"
      ? "move"
      : action.kind === "studyBlock.remove"
        ? "remove"
        : "add";
  const heading = `nunio could not confirm: ${verb} the block for ${action.work.title}`;
  return (
    <article aria-label={heading}>
      <h3>{heading}</h3>
      <p>Check your Plan, then tell nunio. It will not try again on its own.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => onResolve("happened")}
      >
        It happened
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onResolve("did_not_happen")}
      >
        It didn't happen
      </button>
    </article>
  );
}
