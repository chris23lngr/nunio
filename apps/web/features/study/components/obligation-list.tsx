import { cn } from "@nunio/ui";
import { ChevronRight, FileText } from "lucide-react";
import Link from "next/link";
import type { ObligationOption } from "@/features/artifacts/api/artifact-options-query";
import type { Obligation } from "../study-format";
import { dueText, obligationKinds, reportedDayText } from "../study-format";

type Rule = ObligationOption["aiUse"]["status"];

/** The AI-use Rule in a word or two, beside an Abgabe; an unknown one asks to be cleared up. */
const rules: Record<Rule, string> = {
  unknown: "KI-Regel unklar",
  allowed: "KI erlaubt",
  conditional: "KI mit Bedingungen",
  forbidden: "KI verboten",
};

function Badge({
  className,
  children,
}: {
  className: string;
  children: string;
}) {
  return (
    <span
      className={cn("rounded-sm px-1.5 py-px text-xs font-medium", className)}
    >
      {children}
    </span>
  );
}

/** The state of one Abgabe under its title: handed in, or its ready draft and AI-use Rule. */
function State({
  obligation,
  rule,
  draftVersion,
}: {
  obligation: Obligation;
  rule: Rule | undefined;
  draftVersion: number | undefined;
}) {
  if (obligation.reportedSubmittedAt)
    return (
      <>
        <Badge className="bg-success-50 text-success-800">
          Als abgegeben gemeldet
        </Badge>
        <span className="text-xs text-base-500">
          {reportedDayText(obligation.reportedSubmittedAt)}
        </span>
      </>
    );
  return (
    <>
      {draftVersion !== undefined && (
        <Badge className="bg-primary-50 text-primary-700">
          {`Entwurf v${draftVersion} bereit`}
        </Badge>
      )}
      {rule === "unknown" ? (
        <>
          <Badge className="bg-warning-50 text-warning-800">
            {rules[rule]}
          </Badge>
          <span className="text-xs text-base-500">
            Kläre sie, dann hilft nunio
          </span>
        </>
      ) : (
        rule && <span className="text-xs text-base-500">{rules[rule]}</span>
      )}
    </>
  );
}

/** The Course's Abgaben, open ones by due date and those handed in last, each opening its own page. */
export function ObligationList({
  obligations,
  rules: ruleOf,
  drafts,
  now,
}: {
  obligations: Obligation[];
  /** Each open Abgabe's AI-use Rule, by its id. */
  rules: Map<string, Rule>;
  /** Each Abgabe's latest ready draft version, by its id. */
  drafts: Map<string, number>;
  now: Date;
}) {
  const sorted = [...obligations].sort(
    (a, b) =>
      Number(Boolean(a.reportedSubmittedAt)) -
        Number(Boolean(b.reportedSubmittedAt)) ||
      (a.due.date ?? "9999").localeCompare(b.due.date ?? "9999"),
  );
  return (
    <section aria-label="Abgaben" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between pb-1">
        <h2 className="text-base font-medium text-base-800">Abgaben</h2>
        <span className="text-[13px] leading-4.5 text-base-500">
          {obligations.length} in diesem Kurs
        </span>
      </div>
      {sorted.length ? (
        <ul className="flex flex-col">
          {sorted.map((obligation) => (
            <li key={obligation.id} className="border-t border-base-200">
              <Link
                href={`/study/obligations/${obligation.id}`}
                className="group flex items-start gap-3 py-3 outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-base-100">
                  <FileText
                    aria-hidden="true"
                    className="size-4 text-base-600"
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span
                    className={cn(
                      "text-sm font-medium group-hover:text-primary-700",
                      obligation.reportedSubmittedAt
                        ? "text-base-600"
                        : "text-base-800",
                    )}
                  >
                    {obligation.title}
                  </span>
                  <span className="text-xs text-base-500">
                    {obligationKinds[obligation.kind]} ·{" "}
                    {dueText(obligation.due, now)}
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <State
                      obligation={obligation}
                      rule={ruleOf.get(obligation.id)}
                      draftVersion={drafts.get(obligation.id)}
                    />
                  </span>
                </span>
                <ChevronRight
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-base-400"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-base-200 py-3 text-[13px] text-base-500">
          In diesem Kurs gibt es nichts abzugeben.
        </p>
      )}
    </section>
  );
}
