"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { hours } from "@/app/(app)/plan-wording";
import { nameOf } from "@/features/agents/name";
import { closeIntervention, readNotice } from "./api/inbox-mutations";
import type { Intervention, Notice } from "./api/inbox-queries";
import { inboxQueries } from "./api/inbox-queries";

function headingOf({ kind, action, title, shortMinutes, run }: Intervention) {
  if (kind === "run_approvals")
    return run?.openApprovals
      ? `${title} needs your Approval (${run.openApprovals})`
      : `${title} needs your Approval`;
  if (kind === "shortfall")
    return shortMinutes === null
      ? `No longer short for ${title}`
      : `${hours(shortMinutes)} short for ${title}`;
  if (kind === "disagreement") return `Sources disagree about ${title}`;
  const what = action
    ? {
        "studyBlock.create": `add the block for ${action.work.title}`,
        "studyBlock.move": `move the block for ${action.work.title}`,
        "studyBlock.remove": `remove the block for ${action.work.title}`,
        "task.create": `add the Task ${action.work.title}`,
        "task.reopen": `reopen the Task ${action.work.title}`,
      }[action.kind]
    : "an Action that is gone";
  return kind === "approval_expired"
    ? `An approval expired: ${what}`
    : `nunio could not confirm: ${what}`;
}

const approvalAs = {
  waiting: "Waiting for your Approval",
  approved: "Approved",
  denied: "Denied",
  expired: "Expired",
} as const;

const closedAs = {
  acknowledged: "Acknowledged",
  dismissed: "Dismissed as not useful",
  lapsed: "No longer applies",
} as const;

/**
 * A Notice as its Agent wrote it, plain text that is never rendered as a link or formatting (ADR-0014). Unread, it
 * shows only who wrote it until the student opens it, which marks it read.
 */
function NoticeItem({
  notice,
  onOpen,
  opening,
}: {
  notice: Notice;
  onOpen: () => void;
  opening: boolean;
}) {
  const [open, setOpen] = useState(false);
  const heading = `Nachricht von ${notice.agentName}`;
  const shown = open || notice.readAt !== null;
  return (
    <article aria-label={heading}>
      <h3>{heading}</h3>
      {notice.readAt === null && <p>Ungelesen</p>}
      {shown ? (
        notice.text === null ? (
          <p>
            Nicht mehr lesbar: Eine Quelle, die der Agent gelesen hatte, wurde
            gelöscht.
          </p>
        ) : (
          <p className="whitespace-pre-line">{notice.text}</p>
        )
      ) : (
        <Button
          type="button"
          variant="primary"
          disabled={opening}
          onClick={() => {
            setOpen(true);
            onOpen();
          }}
        >
          Öffnen
        </Button>
      )}
    </article>
  );
}

/** The student's Interventions: open ones to acknowledge or dismiss, then how the rest were closed. */
export function InboxScreen({ apiOrigin }: { apiOrigin: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(inboxQueries(apiOrigin));
  const close = useMutation(closeIntervention(apiOrigin, queryClient));
  const read = useMutation(readNotice(apiOrigin, queryClient));
  const interventions = query.data?.interventions ?? [];
  const notices = query.data?.notices ?? [];
  const open = interventions.filter((i) => i.state === "open");
  const closed = interventions.filter((i) => i.state !== "open");
  const briefings = query.data?.briefings ?? [];
  return (
    <>
      <h1>Inbox</h1>
      {query.error && <p role="alert">{query.error.message}</p>}
      {close.error && <p role="alert">{close.error.message}</p>}
      {read.error && <p role="alert">{read.error.message}</p>}
      {query.isSuccess && !interventions.length && !notices.length && (
        <p>Nothing needs your attention.</p>
      )}
      {open.length > 0 && (
        <section aria-label="Needs attention">
          <h2>Needs attention</h2>
          {open.map((i) => (
            <article key={i.id} aria-label={headingOf(i)}>
              <h3>{headingOf(i)}</h3>
              {i.run && (
                <Link href={`/agents/${i.run.agentId}?run=${i.run.id}`}>
                  Open its Approvals
                </Link>
              )}
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
      {notices.length > 0 && (
        <section aria-label="Nachrichten">
          <h2>Nachrichten</h2>
          {notices.map((n) => (
            <NoticeItem
              key={n.id}
              notice={n}
              opening={read.isPending}
              onOpen={() => read.mutate(n.id)}
            />
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
                  {b.interventions.map((id) => {
                    const i = interventions.find((x) => x.id === id);
                    return (
                      <li key={id}>
                        {i ? headingOf(i) : "Something that is gone"}
                      </li>
                    );
                  })}
                  {b.approvals.map(({ actionId, action, state }) => (
                    <li key={actionId}>
                      {approvalAs[state]}:{" "}
                      {action ? action.work.title : "an Action that is gone"}
                    </li>
                  ))}
                  {b.agents.map((r) => (
                    <li key={r.id}>
                      {nameOf({
                        name: r.name,
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
