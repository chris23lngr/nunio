"use client";

import { cn } from "@nunio/ui";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  Blocks,
  CircleCheck,
  CirclePlay,
  CircleStop,
  CircleX,
  Route,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  dated,
  describeEntry,
  duration,
  endLine,
  startedAt,
  stateOf,
  timeOf,
  usd,
} from "../activity-wording";
import { decideRunApproval } from "../api/activity-mutations";
import type { ActivityRun, VerlaufEntry } from "../api/activity-queries";
import { agentRunListQueries, agentRunQueries } from "../api/activity-queries";
import { RunApprovalCard } from "./run-approval-card";

/** A Run's badge; in the list hidden when simply done, in the Status stat card always shown. */
function Badge({
  run,
  showDone = false,
  className,
}: {
  run: ActivityRun;
  showDone?: boolean;
  className?: string;
}) {
  const state = stateOf(run);
  if (state === "Abgeschlossen" && !showDone) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-xs font-medium",
        state === "Läuft gerade" && "bg-primary-100 text-primary-600",
        state === "Freigabe benötigt" &&
          "bg-[oklch(95.4%_0.038_75.2)] text-[oklch(64.6%_0.222_41.1)]",
        state === "Gestoppt" && "bg-base-100 text-base-600",
        state === "Fehlgeschlagen" && "bg-destructive-50 text-destructive-700",
        state === "Abgeschlossen" && "bg-success-50 text-success-800",
        className,
      )}
    >
      {state}
    </span>
  );
}

/** One stat card: what it shows and its value. */
function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1.5 rounded-lg bg-white p-4 shadow-sm outline-1 outline-base-700/15">
      <dt className="text-xs font-medium text-base-500">{label}</dt>
      <dd className="text-sm font-medium text-base-800">{children}</dd>
    </div>
  );
}

function entryIcon(entry: VerlaufEntry) {
  if (entry.type === "start") return CirclePlay;
  if (entry.type === "end") {
    if (entry.status === "done") return CircleCheck;
    if (entry.status === "failed") return CircleX;
    return CircleStop;
  }
  // Like the Chat's step line for reads through an Integration.
  if (entry.type === "integration_read") return Blocks;
  return Route;
}

/** The selected Run: Datum, Kosten and Status, its Zusammenfassung, its open Approvals, and its Verlauf. */
function RunDetail({
  apiOrigin,
  agentId,
  runId,
}: {
  apiOrigin: string;
  agentId: string;
  runId: string;
}) {
  const query = useQuery(agentRunQueries(apiOrigin, agentId, runId));
  const decide = useMutation(
    decideRunApproval(apiOrigin, agentId, useQueryClient()),
  );
  const run = query.data;
  if (!run)
    return query.error ? (
      <p role="alert" className="pl-8 text-sm text-destructive-600">
        {query.error.message}
      </p>
    ) : null;
  return (
    <section
      aria-label="Lauf"
      className="flex min-w-0 flex-1 flex-col gap-8 pl-8"
    >
      <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <Stat label="Datum">{dated(run.startedAt)}</Stat>
        <Stat label="Kosten">
          {`${usd(run.costMicroUsd)} von ${usd(run.budgetMicroUsd)} USD`}
        </Stat>
        <Stat label="Status">
          <Badge run={run} showDone />
        </Stat>
      </dl>
      <section aria-labelledby={`${runId}-summary`}>
        <h2
          id={`${runId}-summary`}
          className="text-base font-medium text-base-800"
        >
          Zusammenfassung
        </h2>
        {run.summary ? (
          <p className="mt-1 max-w-[640px] text-sm leading-6 whitespace-pre-line text-base-600">
            {run.summary}
          </p>
        ) : (
          <p className="mt-1 max-w-[640px] text-sm leading-6 text-base-600">
            {run.status === "running"
              ? "Dein Agent arbeitet noch."
              : run.status !== "done"
                ? endLine(run.status, run.stopReason)
                : run.summaryGoneReason === "connection_disconnected"
                  ? "Inhalt aus einer getrennten Verbindung"
                  : run.summaryGone
                    ? "Zusammenfassung nicht mehr verfügbar: eine Quelle, aus der sie stammt, wurde gelöscht."
                    : "Keine Zusammenfassung."}
          </p>
        )}
      </section>
      {(run.approvals.length > 0 || decide.error) && (
        <section aria-labelledby={`${runId}-freigaben`}>
          <h2
            id={`${runId}-freigaben`}
            className="text-base font-medium text-base-800"
          >
            Freigaben
          </h2>
          {decide.error && (
            <p role="alert" className="mt-3 text-sm text-warning-700">
              {decide.error.message}
            </p>
          )}
          <div className="mt-3 flex flex-col gap-4">
            {run.approvals.map((approval) => (
              <RunApprovalCard
                key={approval.actionId}
                approval={approval}
                busy={decide.isPending}
                onDecide={(decision) => decide.mutate({ approval, decision })}
              />
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby={`${runId}-verlauf`}>
        <h2
          id={`${runId}-verlauf`}
          className="text-base font-medium text-base-800"
        >
          Verlauf
        </h2>
        <ol aria-label="Verlauf" className="mt-4 flex flex-col">
          {run.verlauf.map((entry, i) => {
            const { title, details } = describeEntry(entry);
            const Icon = entryIcon(entry);
            const isLast = i === run.verlauf.length - 1;
            return (
              <li
                // The Verlauf only grows, so an entry keeps its place.
                // biome-ignore lint/suspicious/noArrayIndexKey: entries have no id of their own
                key={i}
                className="flex items-stretch gap-3"
              >
                <div
                  aria-hidden="true"
                  className="flex flex-col items-center gap-1"
                >
                  <span
                    className={cn("h-5 w-px shrink-0", i > 0 && "bg-base-200")}
                  />
                  <Icon className="size-4 shrink-0 text-primary-500" />
                  {!isLast && <span className="w-px flex-1 bg-base-200" />}
                </div>
                <div
                  className={cn(
                    "flex min-w-0 flex-1 flex-col",
                    !isLast && "pb-8",
                  )}
                >
                  <span className="text-xs leading-4 text-base-500 tabular-nums">
                    {timeOf(entry.at)}
                  </span>
                  <span className="mt-1.5 text-sm font-medium text-base-600">
                    {title}
                  </span>
                  {details.map((detail) => (
                    <span key={detail} className="mt-0.5 text-sm text-base-500">
                      {detail}
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </section>
  );
}

/** An Agent's Aktivität: its Runs, newest first and loading older ones on scroll, and the selected one's detail. */
export function AgentActivity({
  apiOrigin,
  agentId,
  run,
}: {
  apiOrigin: string;
  agentId: string;
  /** The Run to show first, as the Inbox opens it; the newest one otherwise. */
  run?: string;
}) {
  const list = useInfiniteQuery(agentRunListQueries(apiOrigin, agentId));
  const [picked, setPicked] = useState<string | null>(run ?? null);
  const end = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  // "Seit …" counts on while a Run is under way, also through a long step that changes nothing else.
  const [now, setNow] = useState(() => new Date());
  const running = Boolean(
    list.data?.pages.some((page) =>
      page.runs.some((run) => run.status === "running"),
    ),
  );
  useEffect(() => {
    if (!running) return;
    setNow(new Date());
    const tick = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(tick);
  }, [running]);
  useEffect(() => {
    const element = end.current;
    if (!element || !hasNextPage || isFetchingNextPage) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void fetchNextPage();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  if (list.error)
    return (
      <p role="alert" className="p-8 text-sm text-destructive-600">
        {list.error.message}
      </p>
    );
  const runs = list.data?.pages.flatMap((page) => page.runs) ?? [];
  if (!list.data) return null;
  if (!runs.length)
    return (
      <div className="flex flex-col gap-1 p-8">
        <p className="text-sm font-medium text-base-800">Noch keine Läufe</p>
        <p className="text-sm text-base-500">
          Sobald dein Agent läuft, siehst du hier, was er getan hat.
        </p>
      </div>
    );
  // The newest Run until the student picks another, or the Inbox opened one.
  const selected = runs.find((run) => run.id === picked) ?? runs[0]!;
  return (
    <div className="flex min-h-[calc(100dvh-6.5rem)] items-start px-8 py-8">
      <nav
        aria-label="Läufe"
        className="w-64 shrink-0 overflow-y-auto border-r border-base-200 pr-6"
      >
        <ul className="flex flex-col divide-y divide-base-200">
          {runs.map((run) => (
            <li key={run.id} className="py-4 first:pt-0 last:pb-0">
              <button
                type="button"
                aria-current={run.id === selected.id ? "true" : undefined}
                onClick={() => setPicked(run.id)}
                className={cn(
                  "flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-primary-500",
                  run.id === selected.id ? "bg-base-100" : "hover:bg-base-50",
                )}
              >
                <Badge run={run} className="mb-2" />
                <span className="w-full truncate text-sm font-medium text-base-800">
                  {startedAt(run.startedAt)}
                </span>
                <span className="mt-0.5 text-xs text-base-500">
                  {run.endedAt
                    ? duration(new Date(run.startedAt), new Date(run.endedAt))
                    : `Seit ${duration(new Date(run.startedAt), now)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div ref={end} />
        {isFetchingNextPage && (
          <p role="status" className="px-2 py-2 text-xs text-base-500">
            Ältere Läufe laden …
          </p>
        )}
      </nav>
      <RunDetail
        key={selected.id}
        apiOrigin={apiOrigin}
        agentId={agentId}
        runId={selected.id}
      />
    </div>
  );
}
