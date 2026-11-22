"use client";

import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { hours } from "@/app/(app)/plan-wording";
import type { RunApproval } from "@/features/agents/api/activity-mutations";
import { RunApprovalCard } from "@/features/agents/components/run-approval-card";
import { kinds as artifactKinds } from "@/features/artifacts/artifact-kinds";
import {
  closeIntervention,
  decideInboxApproval,
  readNotice,
} from "./api/inbox-mutations";
import type { Briefing, Intervention, Notice } from "./api/inbox-queries";
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
  withdrawn: "Withdrawn",
} as const;

const closedAs = {
  acknowledged: "Acknowledged",
  dismissed: "Dismissed as not useful",
  lapsed: "No longer applies",
} as const;

const artifactStateAs = {
  ready: "Bereit",
  opened: "Geöffnet",
  making: "Wird erstellt",
  failed: "Fehlgeschlagen",
  withdrawn: "Nicht mehr lesbar",
  gone: "Gelöscht",
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
  onOpen: (options: { onError: () => void }) => void;
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
            onOpen({ onError: () => setOpen(false) });
          }}
        >
          Öffnen
        </Button>
      )}
    </article>
  );
}

/**
 * A Briefing written by an Agent (#188): plain text (never a link or formatting) with live status for every bundled
 * Intervention, Notice, and Artifact, and real Approval cards for waiting Approvals.
 */
function AgentBriefingItem({
  briefing,
  interventions,
  notices,
  openingNotice,
  onOpenNotice,
  decidingApproval,
  onDecideApproval,
}: {
  briefing: Briefing;
  interventions: Intervention[];
  notices: Notice[];
  openingNotice: boolean;
  onOpenNotice: (noticeId: string, options: { onError: () => void }) => void;
  decidingApproval: boolean;
  onDecideApproval: (
    approval: RunApproval,
    decision: "approve" | "deny",
  ) => void;
}) {
  const heading = `Briefing von ${briefing.agentName}`;
  const waitingApprovals = briefing.approvals.flatMap((a) =>
    a.state === "waiting" && a.action && a.fingerprint && a.expiresAt
      ? [
          {
            actionId: a.actionId,
            action: a.action,
            fingerprint: a.fingerprint,
            expiresAt: a.expiresAt,
            agent: a.agent,
          },
        ]
      : [],
  );
  const settledApprovals = briefing.approvals.filter(
    (a) => !(a.state === "waiting" && a.action && a.fingerprint && a.expiresAt),
  );
  const bundledNotices = briefing.notices ?? [];
  const bundledArtifacts = briefing.artifacts ?? [];

  return (
    <article aria-label={heading}>
      <h3>{heading}</h3>
      {briefing.text === null ? (
        <p>
          Nicht mehr lesbar: Eine Quelle, die der Agent gelesen hatte, wurde
          gelöscht.
        </p>
      ) : (
        <p className="whitespace-pre-line">{briefing.text}</p>
      )}
      {briefing.interventions.length > 0 && (
        <ul>
          {briefing.interventions.map((id) => {
            const i = interventions.find((x) => x.id === id);
            return (
              <li key={id}>
                {i ? (
                  <>
                    {headingOf(i)}
                    {i.state !== "open"
                      ? ` · ${closedAs[i.state as keyof typeof closedAs]}`
                      : null}
                  </>
                ) : (
                  "Something that is gone"
                )}
              </li>
            );
          })}
        </ul>
      )}
      {waitingApprovals.map((approval) => (
        <RunApprovalCard
          key={approval.actionId}
          approval={approval}
          busy={decidingApproval}
          onDecide={(decision) => onDecideApproval(approval, decision)}
        />
      ))}
      {settledApprovals.length > 0 && (
        <ul>
          {settledApprovals.map(({ actionId, action, state }) => (
            <li key={actionId}>
              {approvalAs[state]}:{" "}
              {action ? action.work.title : "an Action that is gone"}
            </li>
          ))}
        </ul>
      )}
      {bundledNotices.map((id) => {
        const n = notices.find((x) => x.id === id);
        return n ? (
          <NoticeItem
            key={n.id}
            notice={n}
            opening={openingNotice}
            onOpen={(options) => onOpenNotice(n.id, options)}
          />
        ) : (
          <p key={id}>Nachricht nicht mehr vorhanden</p>
        );
      })}
      {bundledArtifacts.length > 0 && (
        <ul>
          {bundledArtifacts.map((a) => {
            const label =
              a.title ??
              (a.kind ? artifactKinds[a.kind].label : "Lernmaterial");
            const openable = a.state === "ready" || a.state === "opened";
            return (
              <li key={a.id}>
                {openable ? (
                  <Link href={`/artifacts/${encodeURIComponent(a.id)}`}>
                    {label}
                  </Link>
                ) : (
                  label
                )}
                {a.course ? ` · ${a.course}` : ""} · {artifactStateAs[a.state]}
              </li>
            );
          })}
        </ul>
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
  const decide = useMutation(decideInboxApproval(apiOrigin, queryClient));
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
      {decide.error && <p role="alert">{decide.error.message}</p>}
      {query.isSuccess &&
        !interventions.length &&
        !notices.length &&
        !briefings.length && <p>Nothing needs your attention.</p>}
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
              onOpen={(options) => read.mutate(n.id, options)}
            />
          ))}
        </section>
      )}
      {briefings.length > 0 && (
        <section aria-label="Briefings">
          <h2>Briefings</h2>
          {briefings.map((b) => {
            if (b.agentId)
              return (
                <AgentBriefingItem
                  key={b.id}
                  briefing={b}
                  interventions={interventions}
                  notices={notices}
                  openingNotice={read.isPending}
                  onOpenNotice={(noticeId, options) =>
                    read.mutate(noticeId, options)
                  }
                  decidingApproval={decide.isPending}
                  onDecideApproval={(approval, decision) =>
                    decide.mutate({ approval, decision })
                  }
                />
              );
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
                    <li key={r.id}>{r.name}</li>
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
