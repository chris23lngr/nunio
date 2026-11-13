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
  const what = {
    "studyBlock.create": `add the block for ${action.work.title}`,
    "studyBlock.move": `move the block for ${action.work.title}`,
    "studyBlock.remove": `remove the block for ${action.work.title}`,
    "task.create": `add the Task ${action.work.title}`,
    "task.reopen": `reopen the Task ${action.work.title}`,
  }[action.kind];
  const heading = `nunio could not confirm: ${what}`;
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
