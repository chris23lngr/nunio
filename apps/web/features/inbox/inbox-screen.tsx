"use client";

import { cn } from "@nunio/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { Button, buttonVariants } from "@nunio/ui/components/button/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { PageHeader } from "@/features/shared/components/page-header";
import {
  closeIntervention,
  decideInboxApproval,
  readNotice,
} from "./api/inbox-mutations";
import { inboxQueries } from "./api/inbox-queries";
import { BriefingDocument } from "./components/briefing-document";
import { InterventionItem } from "./components/intervention-item";
import { NoticeCard } from "./components/notice-card";
import { briefingName, briefingSummary, when } from "./inbox-wording";

type Tab = "open" | "notices" | "briefings" | "history";

/** How many Notices the Offene Hinweise tab shows beside its Interventions. */
const sideNotices = 3;

/**
 * The student's Inbox: open Interventions to acknowledge or dismiss, their Agents' Notices, Briefings, and the
 * Verlauf of how the rest were closed.
 */
export function InboxScreen({ apiOrigin }: { apiOrigin: string }) {
  const id = useId();
  const queryClient = useQueryClient();
  const query = useQuery(inboxQueries(apiOrigin));
  const close = useMutation(closeIntervention(apiOrigin, queryClient));
  const read = useMutation(readNotice(apiOrigin, queryClient));
  const decide = useMutation(decideInboxApproval(apiOrigin, queryClient));
  const [tab, setTab] = useState<Tab>("open");
  const [briefingId, setBriefingId] = useState<string | null>(null);
  const interventions = query.data?.interventions ?? [];
  const notices = query.data?.notices ?? [];
  const briefings = query.data?.briefings ?? [];
  const open = interventions.filter((i) => i.state === "open");
  const closed = interventions.filter((i) => i.state !== "open");
  const unread = notices.filter((n) => n.readAt === null).length;
  const briefing =
    briefings.find((b) => b.id === briefingId) ?? briefings[0] ?? null;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "open", label: "Offene Hinweise", count: open.length },
    { key: "notices", label: "Nachrichten", count: unread },
    { key: "briefings", label: "Briefings" },
    { key: "history", label: "Verlauf" },
  ];

  const noticeCard = (n: (typeof notices)[number]) => (
    <NoticeCard
      key={n.id}
      notice={n}
      opening={read.isPending}
      onOpen={(options) => read.mutate(n.id, options)}
    />
  );
  const none = (text: string) => (
    <p className="pt-6 text-sm text-base-500">{text}</p>
  );

  return (
    <main className="relative min-h-dvh bg-white font-sans text-base-800">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Eingang</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <span className="flex-1" />
        <Link
          href="/settings/notifications"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Benachrichtigungen einstellen
        </Link>
      </PageHeader>
      <div className="mx-auto flex w-full max-w-[calc(64rem+4rem)] flex-col px-8 pt-30 pb-16">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-medium tracking-[-0.01em] text-base-800">
            Eingang
          </h1>
          <p className="text-sm text-base-500">
            Was nunio und deine Agenten von dir brauchen – und was sie dir
            mitteilen.
          </p>
        </div>
        {query.error && (
          <p role="alert" className="mt-6 text-sm text-destructive-600">
            {query.error.message}
          </p>
        )}
        {close.error && (
          <p role="alert" className="mt-6 text-sm text-destructive-600">
            {close.error.message}
          </p>
        )}
        {read.error && (
          <p role="alert" className="mt-6 text-sm text-destructive-600">
            {read.error.message}
          </p>
        )}
        {decide.error && (
          <p role="alert" className="mt-6 text-sm text-destructive-600">
            {decide.error.message}
          </p>
        )}
        <div className="mt-7 flex border-b border-base-200 pb-4">
          <div
            role="tablist"
            aria-label="Eingang"
            className="flex items-center gap-2 overflow-x-auto rounded-lg bg-base-100 p-0.5"
          >
            {tabs.map(({ key, label, count }) => {
              const selected = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${key}`}
                  aria-selected={selected}
                  aria-controls={selected ? `${id}-panel` : undefined}
                  onClick={() => setTab(key)}
                  className={cn(
                    "flex h-7 shrink-0 items-center gap-2 rounded-md py-1.5 pl-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary-500",
                    count ? "pr-2" : "pr-2.5",
                    selected
                      ? "bg-white text-base-800 shadow-xs"
                      : "text-base-700 hover:text-base-800",
                  )}
                >
                  {label}{" "}
                  {count ? (
                    <span
                      className={cn(
                        "flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 text-xs font-medium",
                        selected
                          ? "bg-primary-200 text-primary-700"
                          : "bg-base-200 text-base-700",
                      )}
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
        <div
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-tab-${tab}`}
          className="flex flex-col items-stretch gap-10 pt-2 lg:flex-row lg:items-start lg:gap-16"
        >
          {query.isSuccess && (
            <>
              {tab === "open" && (
                <>
                  <div className="flex min-w-0 flex-1 flex-col">
                    {open.length > 0 ? (
                      <>
                        {open.map((i) => (
                          <InterventionItem
                            key={i.id}
                            intervention={i}
                            closing={close.isPending}
                            onClose={(as) => close.mutate({ id: i.id, as })}
                          />
                        ))}
                        <p className="pt-4 pl-12 text-xs leading-4.5 text-base-500">
                          „Verstanden“ und „Nicht hilfreich“ schließen einen
                          Hinweis – die Ursache bleibt.
                        </p>
                      </>
                    ) : notices.length > 0 ? (
                      none("Keine offenen Hinweise.")
                    ) : (
                      <div className="flex flex-col items-center pt-30 pb-40 text-center">
                        <span className="flex size-10 items-center justify-center rounded-lg border border-dashed border-base-300">
                          <Inbox
                            aria-hidden="true"
                            className="size-5 text-base-500"
                            strokeWidth={1.8}
                          />
                        </span>
                        <h2 className="mt-6 text-base font-medium text-base-800">
                          Nichts braucht gerade deine Aufmerksamkeit.
                        </h2>
                        <p className="mt-1.5 max-w-100 text-sm text-base-500">
                          Neue Hinweise, Nachrichten deiner Agenten und
                          Briefings erscheinen hier. Erledigtes findest du im
                          Verlauf.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-6 h-8"
                          onClick={() => setTab("history")}
                        >
                          Verlauf ansehen
                        </Button>
                      </div>
                    )}
                  </div>
                  {notices.length > 0 && (
                    <section
                      aria-label="Nachrichten"
                      className="flex w-full shrink-0 flex-col gap-4 pt-6 lg:w-80"
                    >
                      <div className="flex items-center justify-between">
                        <h2 className="text-base font-medium text-base-800">
                          Nachrichten
                        </h2>
                        <button
                          type="button"
                          onClick={() => setTab("notices")}
                          className="text-sm font-medium text-primary-600 hover:underline focus-visible:outline-2 focus-visible:outline-primary-500"
                        >
                          Alle anzeigen
                        </button>
                      </div>
                      {notices.slice(0, sideNotices).map(noticeCard)}
                    </section>
                  )}
                </>
              )}
              {tab === "notices" && (
                <div className="flex max-w-160 min-w-0 flex-1 flex-col gap-4 pt-6">
                  {notices.length > 0
                    ? notices.map(noticeCard)
                    : none("Noch keine Nachrichten von deinen Agenten.")}
                </div>
              )}
              {tab === "briefings" &&
                (briefing ? (
                  <>
                    <div className="min-w-0 flex-1">
                      <BriefingDocument
                        key={briefing.id}
                        briefing={briefing}
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
                    </div>
                    <nav
                      aria-label="Letzte Briefings"
                      className="flex w-full shrink-0 flex-col gap-1 pt-6 lg:w-80"
                    >
                      <h2 className="text-base font-medium text-base-800">
                        Letzte Briefings
                      </h2>
                      <ul className="flex flex-col pt-2">
                        {briefings.map((b) => {
                          const selected = b.id === briefing.id;
                          const summary = briefingSummary(b);
                          return (
                            <li key={b.id}>
                              <button
                                type="button"
                                aria-current={selected || undefined}
                                onClick={() => setBriefingId(b.id)}
                                className={cn(
                                  "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-primary-500",
                                  selected
                                    ? "bg-primary-50"
                                    : "hover:bg-base-50",
                                )}
                              >
                                <span className="flex justify-between gap-3">
                                  <span
                                    className={cn(
                                      "text-sm font-medium",
                                      selected
                                        ? "text-primary-700"
                                        : "text-base-800",
                                    )}
                                  >
                                    {briefingName(b)}
                                  </span>
                                  <span
                                    className={cn(
                                      "shrink-0 text-xs leading-5",
                                      selected
                                        ? "text-primary-700"
                                        : "text-base-500",
                                    )}
                                  >
                                    {when(b.madeAt, ", ")}
                                  </span>
                                </span>
                                {summary && (
                                  <span
                                    className={cn(
                                      "text-[13px] leading-4.5",
                                      selected
                                        ? "text-base-600"
                                        : "text-base-500",
                                    )}
                                  >
                                    {summary}
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <p className="px-3 pt-4 text-xs leading-4.5 text-base-500">
                        Ein Briefing fasst einen Lauf zusammen. Es lässt sich
                        nicht schließen; Freigaben und Hinweise darin zeigen
                        immer den aktuellen Stand.
                      </p>
                    </nav>
                  </>
                ) : (
                  none("Noch keine Briefings.")
                ))}
              {tab === "history" && (
                <div className="flex max-w-160 min-w-0 flex-1 flex-col">
                  {closed.length > 0
                    ? closed.map((i) => (
                        <InterventionItem
                          key={i.id}
                          intervention={i}
                          closing={close.isPending}
                          onClose={(as) => close.mutate({ id: i.id, as })}
                        />
                      ))
                    : none("Noch nichts erledigt.")}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
