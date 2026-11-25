"use client";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { useQuery } from "@tanstack/react-query";
import {
  approvalQueries,
  unconfirmedQueries,
} from "@/features/approvals/api/approval-queries";
import { PageHeader } from "@/features/shared/components/page-header";
import { homeQuery } from "./api/home-queries";
import { AttentionSection } from "./components/attention-section";
import { NextUpBanner } from "./components/next-up-banner";
import { BackgroundSection, ReadySection } from "./components/side-sections";
import { SourcesCard } from "./components/sources-card";
import { WaitingSection } from "./components/waiting-section";
import { headline } from "./home-wording";

const today = () =>
  new Date().toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

/** "Heute": what waits for the student and needs them, what is ready, what runs, and their newest Sources. */
export function HomeScreen({ apiOrigin }: { apiOrigin: string }) {
  const home = useQuery(homeQuery(apiOrigin));
  const approvals = useQuery(approvalQueries(apiOrigin));
  const unconfirmed = useQuery(unconfirmedQueries(apiOrigin));
  // Wait for everything the headline counts, so a quiet day never flips to a busy one.
  const settled = !approvals.isPending && !unconfirmed.isPending;
  const waitingError = approvals.error ?? unconfirmed.error;
  const waiting = {
    approvals: approvals.data ?? [],
    unconfirmed: unconfirmed.data ?? [],
  };
  const answers = waiting.approvals.length + waiting.unconfirmed.length;

  return (
    <main className="relative min-h-dvh bg-white font-sans text-base-800">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage>Heute</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <span className="flex-1" />
        {/* The student's own date; the server does not know their time zone. */}
        <span suppressHydrationWarning className="text-sm text-base-600">
          {today()}
        </span>
      </PageHeader>
      <div className="mx-auto flex w-full max-w-[calc(64rem+4rem)] flex-col gap-10 px-8 pt-28 pb-24">
        {home.error ? (
          <p role="alert" className="text-sm text-destructive-700">
            {home.error.message}
          </p>
        ) : !home.data || !settled ? (
          <p role="status" className="text-sm text-base-600">
            Dein Tag wird geladen …
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-5">
              <h1 className="text-3xl font-semibold tracking-[-0.02em] text-base-900">
                {headline(answers, home.data.attention.length)}
              </h1>
              <NextUpBanner apiOrigin={apiOrigin} />
            </div>
            <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-8">
              <div className="flex min-w-0 flex-1 flex-col gap-12">
                <WaitingSection
                  apiOrigin={apiOrigin}
                  loadError={waitingError}
                  {...waiting}
                />
                <AttentionSection
                  apiOrigin={apiOrigin}
                  attention={home.data.attention}
                  quiet={
                    !answers && !home.data.attention.length && !waitingError
                  }
                />
              </div>
              <div className="flex shrink-0 flex-col gap-10 lg:w-80">
                <ReadySection
                  apiOrigin={apiOrigin}
                  artifacts={home.data.artifacts}
                />
                <BackgroundSection
                  ongoing={home.data.ongoing}
                  agentWork={home.data.agentWork}
                />
                <SourcesCard apiOrigin={apiOrigin} />
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
