"use client";

import { cn } from "@nunio/ui";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@nunio/ui/components/breadcrumb/breadcrumb";
import { Button } from "@nunio/ui/components/button/button";
import { Textarea } from "@nunio/ui/components/textarea/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  ChevronLeft,
  CircleCheck,
  CircleHelp,
  Clock,
  FileText,
  LoaderCircle,
  PenLine,
} from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { courseListQuery } from "@/features/courses/api/course-queries";
import { colors } from "@/features/courses/course-format";
import { PageHeader } from "@/features/shared/components/page-header";
import { createApiClient } from "@/lib/api-client";
import type { AiUse, ArtifactRequest } from "./api/study-queries";
import { coursesQueries, handoffQuery } from "./api/study-queries";
import { AiUseCard } from "./components/ai-use-card";
import { HandoffPanel } from "./components/handoff-panel";
import { draftDateText, dueMetaText, obligationKinds } from "./study-format";

type WriteRequest = Extract<ArtifactRequest, { kind: "draft" | "critique" }>;
type Written =
  | { started: { kind: WriteRequest["kind"]; artifactId: string } }
  | { refused: string };

const metaRule: Record<
  AiUse["status"],
  { label: string; icon: typeof CircleCheck; iconClass: string }
> = {
  allowed: {
    label: "KI erlaubt",
    icon: CircleCheck,
    iconClass: "text-base-500",
  },
  conditional: {
    label: "KI mit Bedingungen erlaubt",
    icon: CircleCheck,
    iconClass: "text-base-500",
  },
  unknown: {
    label: "KI-Regel unklar",
    icon: CircleHelp,
    iconClass: "text-warning-600",
  },
  forbidden: {
    label: "KI verboten",
    icon: Ban,
    iconClass: "text-base-500",
  },
};

/** Status line beside a Draft or Critique button once nunio has started making it. */
function MakingStatus({
  label,
  linkLabel,
  artifactId,
}: {
  label: string;
  linkLabel: string;
  artifactId: string;
}) {
  return (
    <span className="flex items-center gap-2 text-[13px] leading-4.5">
      <LoaderCircle
        aria-hidden="true"
        className="size-3.5 animate-spin text-primary-500"
      />
      <span className="text-base-600">{label}</span>
      <span aria-hidden="true" className="text-base-300">
        ·
      </span>
      <Link
        href={`/artifacts/${artifactId}`}
        className="font-medium text-primary-600 hover:text-primary-700"
      >
        {linkLabel}
      </Link>
    </span>
  );
}

/** One Abgabe: its AI-use Rule, Draft and Critique flows, and the Handoff panel. */
export function ObligationScreen({
  apiOrigin,
  id,
}: {
  apiOrigin: string;
  id: string;
}) {
  return <ObligationScreenContent key={id} apiOrigin={apiOrigin} id={id} />;
}

function ObligationScreenContent({
  apiOrigin,
  id,
}: {
  apiOrigin: string;
  id: string;
}) {
  const queryClient = useQueryClient();
  const handoff = useQuery(handoffQuery(apiOrigin, id));
  const courses = useQuery(coursesQueries(apiOrigin));
  const courseList = useQuery(courseListQuery(apiOrigin));

  const [instructions, setInstructions] = useState("");
  const [ownWork, setOwnWork] = useState("");
  const [conditionsConfirmed, setConditionsConfirmed] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [pendingWrite, setPendingWrite] = useState<WriteRequest | null>(null);
  const [startedDraftId, setStartedDraftId] = useState<string | null>(null);
  const [startedCritiqueId, setStartedCritiqueId] = useState<string | null>(
    null,
  );
  const [refusedMessage, setRefusedMessage] = useState<string | null>(null);

  const draftInputId = useId();
  const critiqueInputId = useId();

  const match = (courses.data ?? [])
    .map((course) => ({
      course,
      obligation: course.obligations.find(
        (o) => o.id === id && o.state !== "rejected",
      ),
    }))
    .find((entry) => entry.obligation);
  const course = match?.course;
  const reviewObligation = match?.obligation;
  const courseColor = course
    ? courseList.data?.courses.find((c) => c.id === course.id)?.color
    : undefined;
  const backHref = course ? `/study?course=${course.id}` : "/study";

  const write = useMutation({
    mutationFn: async (body: WriteRequest): Promise<Written> => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/artifacts",
        { body },
      );
      if (result.data)
        return {
          started: { kind: body.kind, artifactId: result.data.artifactId },
        };
      if (result.response.status === 409)
        return { refused: (result.error as { error: string }).error };
      throw new Error(
        "Das konnte nicht angefragt werden. Versuch es noch einmal.",
      );
    },
    onSuccess: (result, variables) => {
      setRefusedMessage(null);
      if ("started" in result) {
        setPendingWrite(null);
        setNeedsConfirmation(false);
        if (result.started.kind === "draft") {
          setStartedDraftId(result.started.artifactId);
        } else {
          setStartedCritiqueId(result.started.artifactId);
        }
        return;
      }
      if (result.refused === "ai_use_conditions") {
        setPendingWrite(variables);
        setNeedsConfirmation(true);
      } else if (result.refused === "ai_use_unknown") {
        setPendingWrite(variables);
        queryClient.invalidateQueries({
          queryKey: handoffQuery(apiOrigin, id).queryKey,
        });
      } else if (result.refused === "ai_use_forbidden") {
        setPendingWrite(null);
        setRefusedMessage(
          "Dein Kurs erlaubt hier keine KI, daher erstellt nunio das nicht.",
        );
        queryClient.invalidateQueries({
          queryKey: handoffQuery(apiOrigin, id).queryKey,
        });
      } else {
        setRefusedMessage("Das konnte nicht erstellt werden.");
      }
    },
  });

  const submitWrite = (request: WriteRequest) => {
    setRefusedMessage(null);
    const body: WriteRequest = conditionsConfirmed
      ? { ...request, conditionsConfirmed: true as const }
      : request;
    write.mutate(body);
  };

  const confirmConditions = () => {
    setConditionsConfirmed(true);
    setNeedsConfirmation(false);
    if (pendingWrite) {
      const retry: WriteRequest = {
        ...pendingWrite,
        conditionsConfirmed: true as const,
      };
      setPendingWrite(null);
      write.mutate(retry);
    }
  };

  const view = handoff.data;
  const title = view?.obligation.title ?? reviewObligation?.title ?? "";
  const now = new Date();
  const dueMeta = view ? dueMetaText(view.obligation.due, now) : null;
  const unknown = view?.rule.status === "unknown";
  const forbidden = view?.rule.status === "forbidden";
  const from = course
    ? { selection: { courseIds: [course.id], sourceIds: [] } }
    : null;

  return (
    <main className="relative min-h-dvh bg-white font-sans text-base-800">
      <PageHeader>
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<Link href={backHref} />}>
                Lernen
              </BreadcrumbLink>
            </BreadcrumbItem>
            {course && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink
                    render={<Link href={`/study?course=${course.id}`} />}
                    className="block max-w-60 truncate"
                  >
                    {course.title}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </>
            )}
            {title && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage className="block max-w-60 truncate">
                    {title}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </PageHeader>
      <div className="mx-auto flex w-full max-w-[calc(64rem+4rem)] flex-col gap-7 px-8 pt-24 pb-16">
        <div className="flex flex-col gap-2.5">
          <Link
            href={backHref}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            <ChevronLeft aria-hidden="true" className="size-3.5" />
            Zurück zu Lernen
          </Link>
          {title && (
            <div className="flex items-center gap-3">
              {courseColor && (
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-[4px]"
                  style={{ backgroundColor: colors[courseColor].swatch }}
                />
              )}
              <h1 className="text-2xl font-medium text-base-800">{title}</h1>
            </div>
          )}
          {view && (
            <div
              className={cn(
                "flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-base-600",
                courseColor && "pl-5.5",
              )}
            >
              {reviewObligation && (
                <span className="flex items-center gap-1.5">
                  <FileText
                    aria-hidden="true"
                    className="size-4 shrink-0 text-base-500"
                  />
                  {obligationKinds[reviewObligation.kind]}
                </span>
              )}
              {dueMeta && (
                <span className="flex items-center gap-1.5">
                  <Clock
                    aria-hidden="true"
                    className="size-4 shrink-0 text-base-500"
                  />
                  {dueMeta}
                </span>
              )}
              {(() => {
                const {
                  label,
                  icon: Icon,
                  iconClass,
                } = metaRule[view.rule.status];
                return (
                  <span className="flex items-center gap-1.5">
                    <Icon
                      aria-hidden="true"
                      className={cn("size-4 shrink-0", iconClass)}
                    />
                    {label}
                  </span>
                );
              })()}
            </div>
          )}
        </div>

        {handoff.error && (
          <p role="alert" className="text-sm text-destructive-600">
            {handoff.error.message}
          </p>
        )}

        {view && (
          <div className="flex flex-col items-start gap-12 pt-2 lg:flex-row">
            <div className="flex w-full min-w-0 flex-1 flex-col gap-10">
              <AiUseCard
                apiOrigin={apiOrigin}
                obligationId={id}
                rule={view.rule}
                conditionsConfirmed={conditionsConfirmed}
                needsConfirmation={needsConfirmation}
                onConfirmConditions={confirmConditions}
                onAnswered={(value) => {
                  setConditionsConfirmed(false);
                  setNeedsConfirmation(false);
                  setRefusedMessage(null);
                  if (pendingWrite && value === "allowed") {
                    const retry = pendingWrite;
                    setPendingWrite(null);
                    write.mutate(retry);
                  } else {
                    setPendingWrite(null);
                  }
                }}
              />

              {(write.error || refusedMessage) && (
                <p role="alert" className="text-sm text-destructive-600">
                  {write.error?.message ?? refusedMessage}
                </p>
              )}

              {!forbidden && (
                <>
                  <section
                    aria-label="Entwurf"
                    className={cn(
                      "flex flex-col gap-3",
                      unknown && "opacity-50",
                    )}
                  >
                    <div className="flex flex-col gap-0.5">
                      <h2 className="text-base font-medium text-base-800">
                        Entwurf
                      </h2>
                      <p className="text-[13px] leading-4.5 text-base-500">
                        nunio schreibt einen Entwurf, den du überarbeitest. Er
                        bleibt innerhalb der KI-Regel.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={draftInputId}
                        className="text-[13px] leading-4.5 font-medium text-base-700"
                      >
                        Anweisungen für einen Entwurf
                      </label>
                      <Textarea
                        id={draftInputId}
                        value={instructions}
                        disabled={unknown}
                        onChange={(event) =>
                          setInstructions(event.target.value)
                        }
                        placeholder="z. B. Gliederung, Schwerpunkte oder worauf nunio achten soll"
                        className="min-h-[84px] rounded-lg px-3 py-2.5 font-normal placeholder:text-base-400"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={unknown || !from || write.isPending}
                        onClick={() =>
                          from &&
                          submitWrite({
                            kind: "draft",
                            obligationId: id,
                            instructions,
                            from,
                          })
                        }
                      >
                        Entwurf erstellen
                      </Button>
                      {startedDraftId && (
                        <MakingStatus
                          label="Entwurf wird erstellt"
                          linkLabel="Entwurf öffnen"
                          artifactId={startedDraftId}
                        />
                      )}
                    </div>
                    {view.drafts.length > 0 && (
                      <ul aria-label="Entwürfe" className="flex flex-col pt-1">
                        {view.drafts.map((draft, index) => (
                          <li
                            key={draft.id}
                            className="flex items-center gap-2.5 border-t border-base-200 py-2.5"
                          >
                            <PenLine
                              aria-hidden="true"
                              className={cn(
                                "size-4 shrink-0",
                                index === 0
                                  ? "text-primary-500"
                                  : "text-base-400",
                              )}
                            />
                            <span
                              className={cn(
                                "flex-1 text-sm",
                                index === 0
                                  ? "font-medium text-base-800"
                                  : "text-base-600",
                              )}
                            >
                              Entwurf, Version {draft.version}
                            </span>
                            <span className="w-[110px] shrink-0 text-[13px] leading-4.5 text-base-500">
                              {draftDateText(draft.createdAt, now)}
                            </span>
                            <Link
                              href={`/artifacts/${draft.id}`}
                              className="w-[50px] shrink-0 text-right text-[13px] leading-4.5 font-medium text-primary-600 hover:text-primary-700"
                            >
                              Öffnen
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section
                    aria-label="Kritik"
                    className={cn(
                      "flex flex-col gap-3",
                      unknown && "opacity-50",
                    )}
                  >
                    <div className="flex flex-col gap-0.5">
                      <h2 className="text-base font-medium text-base-800">
                        Kritik
                      </h2>
                      <p className="text-[13px] leading-4.5 text-base-500">
                        Füge deine eigene Arbeit ein. nunio sagt dir, was fehlt
                        oder unklar ist, und schreibt nichts um.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor={critiqueInputId}
                        className="text-[13px] leading-4.5 font-medium text-base-700"
                      >
                        Deine eigene Arbeit
                      </label>
                      <Textarea
                        id={critiqueInputId}
                        value={ownWork}
                        disabled={unknown}
                        onChange={(event) => setOwnWork(event.target.value)}
                        placeholder="Füge hier deinen Text, deine Lösung oder dein Skript ein."
                        className="min-h-[120px] rounded-lg px-3 py-2.5 font-normal placeholder:text-base-400"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        variant="primary"
                        className="px-3"
                        disabled={
                          unknown || !from || write.isPending || !ownWork.trim()
                        }
                        onClick={() =>
                          from &&
                          submitWrite({
                            kind: "critique",
                            obligationId: id,
                            of: { ownWork },
                            from,
                          })
                        }
                      >
                        Kritik anfordern
                      </Button>
                      {startedCritiqueId && (
                        <MakingStatus
                          label="Kritik wird erstellt"
                          linkLabel="Kritik öffnen"
                          artifactId={startedCritiqueId}
                        />
                      )}
                    </div>
                  </section>
                </>
              )}
            </div>

            <div className="flex w-full shrink-0 flex-col gap-6 lg:w-[340px]">
              <HandoffPanel apiOrigin={apiOrigin} handoff={view} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
