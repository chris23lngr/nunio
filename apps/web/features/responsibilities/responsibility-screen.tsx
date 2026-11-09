"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { controlResponsibility } from "./api/responsibility-mutations";
import type { Responsibility } from "./api/responsibility-queries";
import { responsibilityQueries } from "./api/responsibility-queries";
import { nameOf } from "./name";

type Shown = Responsibility["recentActions"][number]["action"];
const when = (value: string) =>
  new Date(value).toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
const usd = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(2)}`;
const grants = {
  "studyBlock.create": "add Study Blocks",
  "studyBlock.move": "move the ones nunio placed",
} as const;
const outcomes = {
  awaiting_approval: "waiting for your Approval",
  dispatching: "in progress",
  done: "done",
  failed: "did not happen",
  refused: "not taken",
  unconfirmed: "could not be confirmed",
} as const;

function describe(action: Shown, past: boolean) {
  const verb =
    action.kind === "studyBlock.move"
      ? past
        ? "Moved"
        : "move"
      : past
        ? "Added"
        : "add";
  return `${verb} a block for ${action.work.title} ${action.from ? `to ${when(action.to.start)}` : `on ${when(action.to.start)}`}`;
}

/** One Responsibility: its scope and Grants, what it did and will do next, its Budget, and its controls. */
export function ResponsibilityScreen({
  apiOrigin,
  id,
}: {
  apiOrigin: string;
  id: string;
}) {
  const queryClient = useQueryClient();
  const query = useQuery(responsibilityQueries(apiOrigin, id));
  const control = useMutation(
    controlResponsibility(apiOrigin, id, queryClient),
  );
  const r = query.data;
  if (!r) return query.error ? <p role="alert">{query.error.message}</p> : null;
  return (
    <section aria-label="Responsibility">
      <h1>
        {nameOf(r)}
        {r.exam && r.course && ` (${r.course.title})`}
      </h1>
      <p>
        {r.state === "ended"
          ? "Ended: it holds no Grants anymore. Its history stays below."
          : `It may ${r.grants.map((g) => grants[g]).join(" and ")} without asking. Moving blocks you placed always asks you first.`}
      </p>
      {r.state === "paused" && (
        <p>
          {r.pausedBy === "budget"
            ? "Paused: its Budget is used up."
            : "Paused by you."}{" "}
          It takes no Actions until you resume it.
        </p>
      )}
      <p>{`${usd(r.budget.usedMicroUsd + r.budget.heldMicroUsd)} of ${usd(r.budget.limitMicroUsd)} used`}</p>
      {r.next.runAt && (
        <p>
          Next Run {when(r.next.runAt)}.{" "}
          {r.next.action
            ? `Next: ${describe(r.next.action, false)}.`
            : "Nothing to change as your Plan stands."}
        </p>
      )}
      <h2>Recent Actions</h2>
      <ul aria-label="Recent Actions">
        {r.recentActions.map((a) => (
          <li key={a.id}>
            {describe(a.action, true)}: {outcomes[a.status]}
          </li>
        ))}
      </ul>
      {r.state === "active" && (
        <button
          type="button"
          disabled={control.isPending}
          onClick={() => control.mutate("pause")}
        >
          Pause
        </button>
      )}
      {r.state === "paused" && (
        <button
          type="button"
          disabled={control.isPending}
          onClick={() => control.mutate("resume")}
        >
          Resume
        </button>
      )}
      {r.state !== "ended" && (
        <button
          type="button"
          disabled={control.isPending}
          onClick={() =>
            window.confirm(
              "End this Responsibility for good? Its Grants are removed.",
            ) && control.mutate("end")
          }
        >
          End
        </button>
      )}
      {control.error && <p role="alert">{control.error.message}</p>}
    </section>
  );
}
