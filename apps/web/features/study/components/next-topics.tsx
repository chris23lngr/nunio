import { Button } from "@nunio/ui/components/button/button";
import type { Level } from "../api/study-queries";
import { agoText, inDaysText, levels } from "../study-format";
import { LevelIcon, PracticeMaking, usePractice } from "./topic-practice";

export type StudyTopic = { id: string; title: string; level: Level };

/** One Topic to practise next: its Level, when it was last practised, the next exam, and practice on it. */
function NextTopic({
  apiOrigin,
  courseId,
  topic,
  examInDays,
  now,
}: {
  apiOrigin: string;
  courseId: string;
  topic: StudyTopic;
  examInDays: number | null;
  now: Date;
}) {
  const make = usePractice(apiOrigin, courseId, topic.id);
  const { level, latestAttempt } = topic.level;
  return (
    <li
      aria-label={topic.title}
      className="flex items-center gap-3 border-b border-base-200 px-4 py-3.5 last:border-b-0"
    >
      <LevelIcon level={level} className="self-start pt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-base-800">{topic.title}</span>
        <span className="text-[13px] leading-4.5 text-base-500">
          <span className={`font-medium ${levels[level].text}`}>
            {levels[level].label}
          </span>
          {latestAttempt
            ? ` · Zuletzt geübt ${agoText(latestAttempt.at, now)}`
            : " · Noch nie geübt"}
          {examInDays !== null && ` · Klausur ${inDaysText(examInDays)}`}
        </span>
        {make.error && (
          <span role="alert" className="text-[13px] text-destructive-600">
            {make.error.message}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {make.data ? (
          <PracticeMaking started={make.data} />
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={make.isPending}
              onClick={() => make.mutate("flashcards")}
            >
              Karteikarten
            </Button>
            <Button
              type="button"
              className="px-3"
              disabled={make.isPending}
              onClick={() => make.mutate("practice_set")}
            >
              Üben
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/** Up to three Topics to practise next, weak ones first, then shaky, then those not studied yet. */
export function NextTopics({
  apiOrigin,
  courseId,
  topics,
  examInDays,
  now,
}: {
  apiOrigin: string;
  courseId: string;
  topics: StudyTopic[];
  examInDays: number | null;
  now: Date;
}) {
  const order = ["weak", "shaky", "not_studied"];
  const next = topics
    .filter((topic) => order.includes(topic.level.level))
    .sort((a, b) => order.indexOf(a.level.level) - order.indexOf(b.level.level))
    .slice(0, 3);
  return (
    <section aria-label="Als Nächstes üben" className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-base font-medium text-base-800">
          Als Nächstes üben
        </h2>
        <span className="text-[13px] leading-5 text-base-500">
          Schwache und unsichere Themen zuerst
        </span>
      </div>
      {next.length ? (
        <ul className="flex flex-col overflow-clip rounded-xl border border-base-200 bg-white">
          {next.map((topic) => (
            <NextTopic
              key={topic.id}
              apiOrigin={apiOrigin}
              courseId={courseId}
              topic={topic}
              examInDays={examInDays}
              now={now}
            />
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-base-200 px-4 py-6 text-center text-sm text-base-500">
          {topics.length
            ? "Alle Themen sitzen. Üben kannst du sie unten trotzdem."
            : "Noch keine Themen zum Üben. Sobald nunio Themen aus deinen Quellen erkennt, erscheinen sie hier."}
        </p>
      )}
    </section>
  );
}
