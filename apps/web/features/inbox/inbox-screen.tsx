"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hours } from "@/app/(app)/plan-wording";
import { nameOf } from "@/features/responsibilities/name";
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
  const briefings = query.data?.briefings ?? [];
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
              <Button
                type="button"
                variant="primary"
                disabled={close.isPending}
                onClick={() => close.mutate({ id: i.id, as: "acknowledged" })}
              >
                Got it
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={close.isPending}
                onClick={() => close.mutate({ id: i.id, as: "dismissed" })}
              >
                Not useful
              </Button>
            </article>
          ))}
        </section>
      )}
      {briefings.length > 0 && (
        <section aria-label="Briefings">
          <h2>Briefings</h2>
          {briefings.map((b) => {
            const heading = `Briefing of ${new Date(b.madeAt).toLocaleString()}`;
            return (
              <article key={b.id} aria-label={heading}>
                <h3>{heading}</h3>
                <ul>
                  {b.interventions.flatMap((id) => {
                    const i = interventions.find((x) => x.id === id);
                    return i ? [<li key={id}>{headingOf(i)}</li>] : [];
                  })}
                  {b.approvals.map(({ actionId, action }) => (
                    <li key={actionId}>
                      Waiting for your Approval:{" "}
                      {action ? action.work.title : "an Action that is gone"}
                    </li>
                  ))}
                  {b.responsibilities.map((r) => (
                    <li key={r.id}>
                      {nameOf({
                        course: r.course === null ? null : { title: r.course },
                        exam: r.exam === null ? null : { title: r.exam },
                      })}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
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
