import { cn } from "@nunio/ui";
import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleHelp } from "lucide-react";
import { useId, useState } from "react";
import { createApiClient } from "@/lib/api-client";
import type { AiUse } from "../api/study-queries";
import { handoffQuery } from "../api/study-queries";

type KnownRule = Exclude<AiUse, { status: "unknown" }>;
type RuleValue = KnownRule["status"];
type RuleLevel = KnownRule["level"];

const unknownReasons: Record<
  Extract<AiUse, { status: "unknown" }>["reason"],
  string
> = {
  none: "Deine Quellen sagen dazu nichts. Bevor nunio einen Entwurf schreibt oder deine Arbeit kritisiert, brauchen wir deine Antwort.",
  uncertain:
    "Deine Quellen sind dazu unklar. Bevor nunio einen Entwurf schreibt oder deine Arbeit kritisiert, brauchen wir deine Antwort.",
  disagreement:
    "Deine Quellen widersprechen sich dazu. Bevor nunio einen Entwurf schreibt oder deine Arbeit kritisiert, brauchen wir deine Antwort.",
};

const badges: Record<RuleValue, { label: string; className: string }> = {
  allowed: { label: "Erlaubt", className: "bg-success-50 text-success-800" },
  conditional: {
    label: "Mit Bedingungen erlaubt",
    className: "bg-warning-50 text-warning-800",
  },
  forbidden: { label: "Verboten", className: "bg-base-100 text-base-700" },
};

const choices: { value: RuleValue; label: string }[] = [
  { value: "allowed", label: "Erlaubt" },
  { value: "conditional", label: "Mit Bedingungen" },
  { value: "forbidden", label: "Verboten" },
];

const scopes: { value: RuleLevel; label: string }[] = [
  { value: "obligation", label: "Für diese Abgabe" },
  { value: "course", label: "Für den ganzen Kurs" },
];

function provenanceLine(rule: KnownRule) {
  const source =
    rule.provenance.kind === "source"
      ? `${rule.provenance.title}, Seite ${rule.provenance.page}`
      : rule.provenance.kind === "correction"
        ? "Deine Korrektur"
        : "Deine Angabe";
  const scope =
    rule.level === "course"
      ? "gilt für den ganzen Kurs"
      : "gilt für diese Abgabe";
  return `${source} · ${scope}`;
}

/** Shows the Obligation's AI-use Rule, or asks the student when it is unknown or being changed. */
export function AiUseCard({
  apiOrigin,
  obligationId,
  rule,
  conditionsConfirmed,
  needsConfirmation,
  onConfirmConditions,
  onAnswered,
}: {
  apiOrigin: string;
  obligationId: string;
  rule: AiUse;
  conditionsConfirmed: boolean;
  needsConfirmation: boolean;
  onConfirmConditions: () => void;
  onAnswered: (value: RuleValue) => void;
}) {
  const queryClient = useQueryClient();
  const headingId = useId();
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState<RuleLevel>(
    rule.status === "unknown" ? "obligation" : rule.level,
  );
  const answer = useMutation({
    mutationFn: async (value: RuleValue) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/obligations/{id}/ai-use",
        {
          params: { path: { id: obligationId } },
          body: { level: scope, value },
        },
      );
      if (!result.data)
        throw new Error("Deine Antwort konnte nicht gespeichert werden.");
      return value;
    },
    onSuccess: (value) => {
      setEditing(false);
      onAnswered(value);
      queryClient.invalidateQueries({
        queryKey: handoffQuery(apiOrigin, obligationId).queryKey,
      });
      queryClient.invalidateQueries({
        queryKey: [apiOrigin, "artifact-options"],
      });
    },
  });

  if (rule.status === "unknown" || editing) {
    return (
      <fieldset
        aria-labelledby={headingId}
        className="flex flex-col gap-4 rounded-[10px] border border-warning-500/45 bg-white px-5 py-4.5 shadow-[0_1px_3px_#0000000d]"
      >
        <div className="flex gap-3">
          <span className="flex w-5 shrink-0 pt-0.5">
            <CircleHelp
              aria-hidden="true"
              className="size-4 text-warning-600"
            />
          </span>
          <div className="flex flex-1 flex-col gap-1">
            <h2 id={headingId} className="text-base font-medium text-base-800">
              Erlaubt dein Kurs KI hierfür?
            </h2>
            <p className="text-sm text-base-600">
              {rule.status === "unknown"
                ? unknownReasons[rule.reason]
                : "Wähle die KI-Regel, nach der nunio für diese Abgabe handeln soll."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pl-8">
          <span className="text-[13px] leading-4.5 text-base-500">Gilt</span>
          {scopes.map((option) => {
            const checked = scope === option.value;
            return (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 text-sm text-base-800"
              >
                <input
                  type="radio"
                  name={`ai-use-scope-${obligationId}`}
                  checked={checked}
                  onChange={() => setScope(option.value)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full border peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2",
                    checked
                      ? "border-primary-500 bg-primary-50"
                      : "border-base-300 bg-white",
                  )}
                >
                  {checked && (
                    <span className="size-2 rounded-full bg-primary-500" />
                  )}
                </span>
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 pl-8">
          {choices.map((choice) => (
            <Button
              key={choice.value}
              type="button"
              variant="outline"
              className="px-3"
              disabled={answer.isPending}
              onClick={() => answer.mutate(choice.value)}
            >
              {choice.label}
            </Button>
          ))}
          {rule.status !== "unknown" && (
            <button
              type="button"
              disabled={answer.isPending}
              onClick={() => setEditing(false)}
              className="ml-1 cursor-pointer text-[13px] leading-4.5 font-medium text-base-500 hover:text-base-700"
            >
              Abbrechen
            </button>
          )}
        </div>
        {answer.error && (
          <p role="alert" className="pl-8 text-[13px] text-destructive-600">
            {answer.error.message}
          </p>
        )}
      </fieldset>
    );
  }

  const badge = badges[rule.status];
  return (
    <section
      aria-label="KI-Regel für diese Abgabe"
      className="flex flex-col gap-3 rounded-[10px] border border-base-200 bg-base-50 px-4.5 py-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-base-800">
          KI-Regel für diese Abgabe
        </h2>
        <span
          className={cn(
            "rounded-sm px-1.5 py-px text-xs font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </span>
      </div>
      {rule.text && (
        <p className="text-sm leading-5.5 text-base-700">„{rule.text}“</p>
      )}
      {rule.status === "conditional" && !rule.text && (
        <p className="text-sm leading-5.5 text-base-700">
          Du hast angegeben, dass dein Kurs KI unter Bedingungen erlaubt.
        </p>
      )}
      {rule.status === "forbidden" && (
        <p className="text-sm leading-5.5 text-base-600">
          Dein Kurs erlaubt hier keine KI. nunio erstellt weder Entwürfe noch
          Kritik.
        </p>
      )}
      {rule.status === "conditional" ? (
        <>
          <p className="text-xs text-base-500">{provenanceLine(rule)}</p>
          <div className="h-px bg-base-200" />
          <div className="flex flex-wrap items-center gap-2">
            {conditionsConfirmed ? (
              <>
                <CircleCheck
                  aria-hidden="true"
                  className="size-4 shrink-0 text-success-500"
                />
                <span className="flex-1 text-[13px] leading-4.5 text-base-700">
                  Du hast zugesagt, dich an diese Bedingungen zu halten.
                </span>
              </>
            ) : (
              <div className="flex flex-1 flex-wrap items-center gap-2.5">
                <Button
                  type="button"
                  variant={needsConfirmation ? "primary" : "outline"}
                  size="sm"
                  className="h-7 px-2.5 text-[13px]"
                  onClick={onConfirmConditions}
                >
                  Ich halte mich an diese Bedingungen
                </Button>
                {needsConfirmation && (
                  <span className="text-[13px] leading-4.5 text-base-600">
                    Bestätige zuerst, bevor nunio startet.
                  </span>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setScope(rule.level);
                setEditing(true);
              }}
              className="cursor-pointer text-[13px] leading-4.5 font-medium text-primary-600 hover:text-primary-700"
            >
              Ändern
            </button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-base-500">{provenanceLine(rule)}</p>
          <button
            type="button"
            onClick={() => {
              setScope(rule.level);
              setEditing(true);
            }}
            className="cursor-pointer text-[13px] leading-4.5 font-medium text-primary-600 hover:text-primary-700"
          >
            Ändern
          </button>
        </div>
      )}
    </section>
  );
}
