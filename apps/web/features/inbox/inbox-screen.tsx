"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hours } from "@/app/(app)/plan-wording";
import { closeIntervention } from "./api/inbox-mutations";
import type { Intervention } from "./api/inbox-queries";
import { inboxQueries } from "./api/inbox-queries";

function headingOf({ kind, action, title, shortMinutes }: Intervention) {
  if (kind === "shortfall")
    return shortMinutes === null
      ? `No longer short for ${title}`
      : `${hours(shortMinutes)} short for ${title}`;
  if (kind === "disagreement") return `Sources disagree about ${title}`;
  const what = action
    ? `${action.kind === "studyBlock.move" ? "move" : "add"} the block for ${action.work.title}`
    : "an Action that is gone";
  return kind === "approval_expired"
    ? `An approval expired: ${what}`
    : `nunio could not confirm: ${what}`;
}

const closedAs = {
  acknowledged: "Acknowledged",
  dismissed: "Dismissed as not useful",
  lapsed: "No longer applies",
} as const;

/** The student's Interventions: open ones to acknowledge or dismiss, then how the rest were closed. */
export function InboxScreen({ apiOrigin }: { apiOrigin: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(inboxQueries(apiOrigin));
  const close = useMutation(closeIntervention(apiOrigin, queryClient));
  const interventions = query.data?.interventions ?? [];
  const open = interventions.filter((i) => i.state === "open");
  const closed = interventions.filter((i) => i.state !== "open");
  return (
    <>
      <h1>Inbox</h1>
      {query.error && <p role="alert">{query.error.message}</p>}
      {close.error && <p role="alert">{close.error.message}</p>}
      {query.isSuccess && !interventions.length && (
        <p>Nothing needs your attention.</p>
      )}
      {open.length > 0 && (
        <section aria-label="Needs attention">
          <h2>Needs attention</h2>
          {open.map((i) => (
            <article key={i.id} aria-label={headingOf(i)}>
              <h3>{headingOf(i)}</h3>
              <button
                type="button"
                disabled={close.isPending}
                onClick={() => close.mutate({ id: i.id, as: "acknowledged" })}
              >
                Got it
              </button>
              <button
                type="button"
                disabled={close.isPending}
                onClick={() => close.mutate({ id: i.id, as: "dismissed" })}
              >
                Not useful
              </button>
            </article>
          ))}
        </section>
      )}
      {closed.length > 0 && (
        <section aria-label="Closed">
          <h2>Closed</h2>
          {closed.map((i) => (
            <article key={i.id} aria-label={headingOf(i)}>
              <h3>{headingOf(i)}</h3>
              <p>{closedAs[i.state as keyof typeof closedAs]}</p>
            </article>
          ))}
        </section>
      )}
    </>
  );
}
