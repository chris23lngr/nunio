import { cn } from "@nunio/ui";
import { Bot, ChevronRight, FileText, Inbox } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { RunApproval } from "@/features/agents/api/activity-mutations";
import { RunApprovalCard } from "@/features/agents/components/run-approval-card";
import { kinds as artifactKinds } from "@/features/artifacts/artifact-kinds";
import type { Briefing, Intervention, Notice } from "../api/inbox-queries";
import {
  actionOf,
  approvalAs,
  artifactStateAs,
  briefingName,
  closedAs,
  headingOf,
  when,
} from "../inbox-wording";
import { NoticeCard } from "./notice-card";

const badge =
  "shrink-0 rounded-sm px-1.5 py-px text-xs leading-4.5 font-medium";

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1">
      <h4 className="pb-1.5 text-xs font-medium text-base-500">{label}</h4>
      {children}
    </section>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-base-100 py-2 text-sm text-base-700 last:border-b-0">
      {children}
    </li>
  );
}

/**
 * A Briefing as a calm document: its Agent's plain text (never a link or formatting), then everything it bundled as it
 * stands now. Only Approvals still waiting for the student are cards to decide (#188).
 */
export function BriefingDocument({
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
  const heading = briefing.agentId
    ? `Briefing von ${briefing.agentName}`
    : briefingName(briefing);
  const waiting = briefing.approvals.flatMap((a) =>
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
  const settled = briefing.approvals.filter(
    (a) => !waiting.some((w) => w.actionId === a.actionId),
  );
  const Icon = briefing.agentId ? Bot : Inbox;

  return (
    <article aria-label={heading} className="flex flex-col pt-6">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            briefing.agentId
              ? "bg-primary-50 text-primary-600"
              : "bg-base-100 text-base-600",
          )}
        >
          <Icon aria-hidden="true" className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="text-lg leading-6.5 font-medium text-base-800">
            {heading}
          </h3>
          <p className="text-[13px] leading-4.5 text-base-500">
            {when(briefing.madeAt, ", ")}
          </p>
        </div>
        {waiting.length > 0 && (
          <span className={cn(badge, "bg-warning-50 text-warning-700")}>
            {waiting.length === 1
              ? "1 Freigabe offen"
              : `${waiting.length} Freigaben offen`}
          </span>
        )}
      </div>
      {briefing.agentId && (
        <p className="mt-3 pl-11 text-[15px] leading-6 whitespace-pre-line text-base-700">
          {briefing.text ??
            (briefing.gone === "connection_disconnected"
              ? "Inhalt aus einer getrennten Verbindung"
              : "Nicht mehr lesbar: Eine Quelle, die der Agent gelesen hatte, wurde gelöscht.")}
        </p>
      )}
      <div className="flex flex-col gap-8 pt-8 pl-11">
        {waiting.length > 0 && (
          <section
            aria-label="Freigaben · warten auf dich"
            className="flex flex-col gap-3"
          >
            <h4 className="text-xs font-medium text-base-500">
              Freigaben · warten auf dich
            </h4>
            {waiting.map((approval) => (
              <RunApprovalCard
                key={approval.actionId}
                approval={approval}
                busy={decidingApproval}
                onDecide={(decision) => onDecideApproval(approval, decision)}
              />
            ))}
          </section>
        )}
        {settled.length > 0 && (
          <Part label="Freigaben · aktueller Stand">
            <ul>
              {settled.map(({ actionId, action, state }) => (
                <Row key={actionId}>
                  <span className="first-letter:uppercase">
                    {actionOf(action)}
                  </span>
                  <span
                    className={cn(
                      badge,
                      state === "approved"
                        ? "bg-success-50 text-success-800"
                        : "bg-base-100 text-base-600",
                    )}
                  >
                    {approvalAs[state]}
                  </span>
                </Row>
              ))}
            </ul>
          </Part>
        )}
        {briefing.interventions.length > 0 && (
          <Part label="Hinweise">
            <ul>
              {briefing.interventions.map((id) => {
                const i = interventions.find((x) => x.id === id);
                return i ? (
                  <Row key={id}>
                    <span>{headingOf(i)}</span>
                    {i.state === "open" ? (
                      <span className="shrink-0 text-[13px] leading-4.5 font-medium text-warning-700">
                        Offen
                      </span>
                    ) : (
                      <span className="shrink-0 text-[13px] leading-4.5 text-base-500">
                        {closedAs[i.state]}
                      </span>
                    )}
                  </Row>
                ) : (
                  <Row key={id}>
                    <span className="text-base-400">
                      Ein Hinweis aus diesem Briefing ist nicht mehr vorhanden.
                    </span>
                  </Row>
                );
              })}
            </ul>
          </Part>
        )}
        {briefing.artifacts.length > 0 && (
          <Part label="Artefakte">
            <ul className="flex flex-col gap-2">
              {briefing.artifacts.map((a) => {
                const kind = a.kind ? artifactKinds[a.kind] : null;
                const ArtifactIcon = kind?.icon ?? FileText;
                const label = a.title ?? kind?.label ?? "Lernmaterial";
                const openable = a.state === "ready" || a.state === "opened";
                const row = (
                  <>
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-base-100">
                      <ArtifactIcon
                        aria-hidden="true"
                        className="size-4 text-base-600"
                      />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium text-base-800">
                        {label}
                      </span>
                      <span className="text-[13px] leading-4.5 text-base-500">
                        {[
                          kind?.label,
                          a.course,
                          a.count && kind?.counted
                            ? `${a.count} ${kind.counted[a.count === 1 ? 0 : 1]}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span
                      className={cn(
                        badge,
                        a.state === "ready"
                          ? "bg-primary-100 text-primary-700"
                          : "bg-base-100 text-base-600",
                      )}
                    >
                      {artifactStateAs[a.state]}
                    </span>
                    <span className="size-4 shrink-0">
                      {openable && (
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 text-base-400"
                        />
                      )}
                    </span>
                  </>
                );
                const rowClass =
                  "flex items-center gap-3 rounded-lg border border-base-200 p-3";
                return (
                  <li key={a.id}>
                    {openable ? (
                      <Link
                        href={`/artifacts/${encodeURIComponent(a.id)}`}
                        aria-label={label}
                        className={cn(
                          rowClass,
                          "hover:bg-base-50 focus-visible:outline-2 focus-visible:outline-primary-500",
                        )}
                      >
                        {row}
                      </Link>
                    ) : (
                      <div className={rowClass}>{row}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Part>
        )}
        {briefing.notices.length > 0 && (
          <Part label="Nachrichten">
            <div className="flex flex-col gap-2">
              {briefing.notices.map((id) => {
                const n = notices.find((x) => x.id === id);
                return n ? (
                  <NoticeCard
                    key={n.id}
                    bundled
                    notice={n}
                    opening={openingNotice}
                    onOpen={(options) => onOpenNotice(n.id, options)}
                  />
                ) : (
                  <p key={id} className="text-sm text-base-400">
                    Nachricht nicht mehr vorhanden
                  </p>
                );
              })}
            </div>
          </Part>
        )}
        {briefing.agents.length > 0 && (
          <Part label="Agenten">
            <ul>
              {briefing.agents.map((r) => (
                <Row key={r.id}>{r.name}</Row>
              ))}
            </ul>
          </Part>
        )}
      </div>
    </article>
  );
}
