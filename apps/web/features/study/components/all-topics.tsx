import { cn } from "@nunio/ui";
import { Button } from "@nunio/ui/components/button/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isToday } from "date-fns";
import Link from "next/link";
import { useState } from "react";
import { createApiClient } from "@/lib/api-client";
import { levelsQueries } from "../api/study-queries";
import type { LevelName } from "../study-format";
import { agoText, levels } from "../study-format";
import type { StudyTopic } from "./next-topics";
import { LevelIcon, usePractice } from "./topic-practice";

/** How many Topics show before the student asks for the rest. */
const shown = 6;

/** The Self-assessments offered inline, as the student would say them. */
const assessments = [
  { level: "shaky", text: "Fühlt sich unsicher an" },
  { level: "solid", text: "Sitzt" },
] as const;

/** Whether the student practised the Topic today and has not assessed it since. */
function practisedToday({
  latestAttempt,
  lastEvidenceAt,
}: StudyTopic["level"]) {
  if (!latestAttempt) return false;
  const at = new Date(latestAttempt.at);
  return (
    isToday(at) &&
    (!lastEvidenceAt || at.getTime() >= new Date(lastEvidenceAt).getTime())
  );
}

/** One Topic's row: its Level, which the student can assess themselves, when Evidence last supported it, and practice. */
function TopicRow({
  apiOrigin,
  courseId,
  topic,
  now,
}: {
  apiOrigin: string;
  courseId: string;
  topic: StudyTopic;
  now: Date;
}) {
  const queryClient = useQueryClient();
  const make = usePractice(apiOrigin, courseId, topic.id);
  const [asking, setAsking] = useState<boolean | null>(null);
  const assess = useMutation({
    mutationFn: async (level: LevelName) => {
      const result = await createApiClient(apiOrigin).POST(
        "/api/me/topics/{id}/self-assessment",
        { params: { path: { id: topic.id } }, body: { level } },
      );
      if (!result.data) throw new Error("Das konnte nicht gespeichert werden.");
    },
    onSuccess: () => setAsking(false),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: levelsQueries(apiOrigin, courseId).queryKey,
      }),
  });
  const { level, lastEvidenceAt } = topic.level;
  const practised = practisedToday(topic.level) && !assess.isSuccess;
  const open = asking ?? practised;
  return (
    <li
      aria-label={topic.title}
      className={cn(
        "flex flex-col border-t border-base-200 first:border-t-0",
        open && "pb-2.5",
      )}
    >
      <div className="flex items-center gap-3 px-1 py-2.5">
        <LevelIcon level={level} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-base-800">
          {topic.title}
        </span>
        <button
          type="button"
          aria-label={`${levels[level].label}: selbst einschätzen`}
          aria-expanded={open}
          onClick={() => setAsking(!open)}
          className="w-[130px] shrink-0 cursor-pointer text-left text-[13px] leading-4.5 text-base-600 hover:text-base-800"
        >
          <span>{levels[level].label}</span>
        </button>
        <span className="w-[120px] shrink-0 text-[13px] leading-4.5 text-base-500">
          {agoText(lastEvidenceAt, now)}
        </span>
        <span className="flex w-14 shrink-0 justify-end text-[13px] leading-4.5">
          {make.data ? (
            <Link
              href={`/artifacts/${make.data.artifactId}`}
              className="font-medium text-primary-600 hover:text-primary-700"
            >
              Öffnen
            </Link>
          ) : assess.isSuccess ? (
            <span className="text-success-600">Notiert.</span>
          ) : (
            <button
              type="button"
              disabled={make.isPending}
              onClick={() => make.mutate("practice_set")}
              className="cursor-pointer font-medium text-primary-600 hover:text-primary-700 disabled:opacity-50"
            >
              Üben
            </button>
          )}
        </span>
      </div>
      {open && (
        <div className="flex items-center gap-3 rounded-lg bg-base-50 py-2.5 pr-3 pl-1">
          <span className="w-5 shrink-0" />
          <span className="flex-1 text-[13px] leading-4.5 text-base-600">
            {practised && asking === null
              ? "Du hast gerade geübt. Wie sitzt das Thema jetzt?"
              : "Wie sitzt das Thema jetzt?"}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {assessments.map((option) => (
              <Button
                key={option.level}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-[13px] shadow-none"
                disabled={assess.isPending}
                onClick={() => assess.mutate(option.level)}
              >
                {option.text}
              </Button>
            ))}
          </span>
        </div>
      )}
      {(make.error ?? assess.error) && (
        <p
          role="alert"
          className="px-1 pb-2 pl-9 text-[13px] text-destructive-600"
        >
          {(make.error ?? assess.error)!.message}
        </p>
      )}
    </li>
  );
}

const filters: (LevelName | "all")[] = [
  "all",
  "weak",
  "shaky",
  "not_studied",
  "solid",
];

/** Every Topic of the Course, filtered by Level, with practice and Self-assessment inline. */
export function AllTopics({
  apiOrigin,
  courseId,
  topics,
  now,
}: {
  apiOrigin: string;
  courseId: string;
  topics: StudyTopic[];
  now: Date;
}) {
  const [filter, setFilter] = useState<LevelName | "all">("all");
  const [expanded, setExpanded] = useState(false);
  const matching = topics.filter(
    (topic) => filter === "all" || topic.level.level === filter,
  );
  const visible = expanded ? matching : matching.slice(0, shown);
  const remaining = matching.length - visible.length;
  return (
    <section aria-label="Alle Themen" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-medium text-base-800">Alle Themen</h2>
        <fieldset
          aria-label="Nach Verständnis filtern"
          className="flex flex-wrap items-center gap-1"
        >
          {filters.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={filter === name}
              onClick={() => setFilter(name)}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.75 text-[13px] leading-4.5 font-medium text-base-600 hover:text-base-800",
                filter === name && "bg-base-100 text-base-800",
              )}
            >
              {name === "all" ? "Alle" : levels[name].label}
              <span className="text-xs font-normal text-base-500">
                {name === "all"
                  ? topics.length
                  : topics.filter((topic) => topic.level.level === name).length}
              </span>
            </button>
          ))}
        </fieldset>
      </div>
      {visible.length ? (
        <ul className="flex flex-col border-y border-base-200">
          {visible.map((topic) => (
            <TopicRow
              key={topic.id}
              apiOrigin={apiOrigin}
              courseId={courseId}
              topic={topic}
              now={now}
            />
          ))}
        </ul>
      ) : (
        <p className="border-t border-base-200 px-1 py-3 text-[13px] text-base-500">
          {topics.length
            ? "Kein Thema mit diesem Stand."
            : "Für diesen Kurs kennt nunio noch keine Themen."}
        </p>
      )}
      {remaining > 0 && (
        <div className="flex px-1">
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="cursor-pointer text-[13px] leading-4.5 font-medium text-primary-600 hover:text-primary-700"
          >
            {remaining === 1
              ? "1 weiteres Thema anzeigen"
              : `${remaining} weitere Themen anzeigen`}
          </button>
        </div>
      )}
    </section>
  );
}
