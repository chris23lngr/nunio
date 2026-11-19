"use client";

import { cn } from "@nunio/ui";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
import type { ActivityRun } from "../api/activity-queries";
import { agentRunListQueries, agentRunQueries } from "../api/activity-queries";
import { RunApprovalCard } from "./run-approval-card";

/** A Run's badge, shown only when it isn't simply done. */
function Badge({ run }: { run: ActivityRun }) {
  const state = stateOf(run);
  if (state === "Abgeschlossen") return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium",
        state === "Läuft gerade" && "bg-primary-100 text-primary-700",
        state === "Freigabe benötigt" && "bg-warning-50 text-warning-700",
        state === "Gestoppt" && "bg-base-100 text-base-600",
        state === "Fehlgeschlagen" && "bg-destructive-50 text-destructive-700",
      )}
    >
      {state}
    </span>
  );
}

/** One stat card: what it shows and its value. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-base-200 px-4 py-3">
      <dt className="text-xs text-base-500">{label}</dt>
      <dd className="text-sm font-medium text-base-800">{value}</dd>
    </div>
  );
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
      <p role="alert" className="p-8 text-sm text-destructive-600">
        {query.error.message}
      </p>
    ) : null;
  return (
    <section
      aria-label="Lauf"
      className="flex min-w-0 flex-1 flex-col gap-10 p-8"
    >
      <dl className="grid max-w-[40rem] grid-cols-3 gap-3">
        <Stat label="Datum" value={dated(run.startedAt)} />
        <Stat
          label="Kosten"
          value={`${usd(run.costMicroUsd)} von ${usd(run.budgetMicroUsd)} USD`}
        />
        <Stat label="Status" value={stateOf(run)} />
      </dl>
      <section aria-labelledby={`${runId}-summary`} className="max-w-[40rem]">
        <h2
          id={`${runId}-summary`}
          className="text-base font-medium text-base-800"
        >
          Zusammenfassung
        </h2>
        {run.summary ? (
          <>
            <p className="mt-1 text-xs text-base-500">
              In den Worten deines Agenten
            </p>
            <p className="mt-3 text-sm whitespace-pre-line text-base-700">
              {run.summary}
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-base-600">
            {run.status === "running"
              ? "Dein Agent arbeitet noch."
              : run.status !== "done"
                ? endLine(run.status, run.stopReason)
                : run.summaryGone
                  ? "Zusammenfassung nicht mehr verfügbar: eine Quelle, aus der sie stammt, wurde gelöscht."
                  : "Keine Zusammenfassung."}
          </p>
        )}
      </section>
      {(run.approvals.length > 0 || decide.error) && (
        <section
          aria-labelledby={`${runId}-freigaben`}
          className="max-w-[40rem]"
        >
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
          <div className="mt-4 flex flex-col gap-3">
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
      <section aria-labelledby={`${runId}-verlauf`} className="max-w-[40rem]">
        <h2
          id={`${runId}-verlauf`}
          className="text-base font-medium text-base-800"
        >
          Verlauf
        </h2>
        <ol aria-label="Verlauf" className="mt-4 flex flex-col gap-4">
          {run.verlauf.map((entry, i) => {
            const { title, details } = describeEntry(entry);
            return (
              <li
                // The Verlauf only grows, so an entry keeps its place.
                // biome-ignore lint/suspicious/noArrayIndexKey: entries have no id of their own
                key={i}
                className="flex gap-4 border-l border-base-200 pl-4"
              >
                <span className="w-16 shrink-0 text-xs text-base-500 tabular-nums">
                  {timeOf(entry.at)}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm text-base-800">{title}</span>
                  {details.map((detail) => (
                    <span key={detail} className="text-xs text-base-500">
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
}: {
  apiOrigin: string;
  agentId: string;
}) {
  const list = useInfiniteQuery(agentRunListQueries(apiOrigin, agentId));
  const [picked, setPicked] = useState<string | null>(null);
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
  // The newest Run until the student picks another.
  const selected = runs.find((run) => run.id === picked) ?? runs[0]!;
  return (
    <div className="flex min-h-[calc(100dvh-6.5rem)]">
      <nav
        aria-label="Läufe"
        className="w-72 shrink-0 overflow-y-auto border-r border-base-200 p-3"
      >
        <ul className="flex flex-col gap-1">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                aria-current={run.id === selected.id ? "true" : undefined}
                onClick={() => setPicked(run.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-primary-500",
                  run.id === selected.id ? "bg-base-100" : "hover:bg-base-50",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-base-800">
                    {startedAt(run.startedAt)}
                  </span>
                  <span className="text-xs text-base-500">
                    {run.endedAt
                      ? duration(new Date(run.startedAt), new Date(run.endedAt))
                      : `Seit ${duration(new Date(run.startedAt), now)}`}
                  </span>
                </span>
                <Badge run={run} />
              </button>
            </li>
          ))}
        </ul>
        <div ref={end} />
        {isFetchingNextPage && (
          <p role="status" className="px-3 py-2 text-xs text-base-500">
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
