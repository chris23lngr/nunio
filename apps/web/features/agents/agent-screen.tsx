"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { controlAgent } from "./api/agent-mutations";
import type { Agent } from "./api/agent-queries";
import { agentQueries } from "./api/agent-queries";
import { nameOf, pausedBecause } from "./name";

type Shown = Agent["recentActions"][number]["action"];
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
  "studyBlock.remove": "remove the ones it placed",
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
  if (!action.to)
    return `${past ? "Removed" : "remove"} the block for ${action.work.title}${action.from ? ` on ${when(action.from.start)}` : ""}`;
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

/** One Agent: its scope and Grants, what it did and will do next, its Budget, and its controls. */
export function AgentScreen({
  apiOrigin,
  id,
}: {
  apiOrigin: string;
  id: string;
}) {
  const queryClient = useQueryClient();
  const query = useQuery(agentQueries(apiOrigin, id));
  const control = useMutation(controlAgent(apiOrigin, id, queryClient));
  const r = query.data;
  if (!r) return query.error ? <p role="alert">{query.error.message}</p> : null;
  return (
    <section aria-label="Agent">
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
          {r.pausedBy && pausedBecause[r.pausedBy]
            ? `Paused: ${pausedBecause[r.pausedBy]}.`
            : "Paused by you."}{" "}
          It takes no Actions until you resume it
          {r.pausedBy === "course_archived" &&
            ", after you unarchive its Course"}
          .
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
              "End this Agent for good? Its Grants are removed.",
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
