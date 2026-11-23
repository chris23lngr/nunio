import type { LevelName } from "../study-format";
import { levels } from "../study-format";
import type { StudyTopic } from "./next-topics";

/** Each Level in the bar, strongest first, with its swatch. */
const spread: { level: LevelName; swatch: string }[] = [
  { level: "solid", swatch: "bg-success-500" },
  { level: "shaky", swatch: "bg-warning-500" },
  { level: "weak", swatch: "bg-destructive-500" },
  { level: "not_studied", swatch: "bg-base-200" },
];

/** How the Course's Topics are spread over the Levels. */
export function Understanding({ topics }: { topics: StudyTopic[] }) {
  const counts = spread.map(({ level, swatch }) => ({
    level,
    swatch,
    count: topics.filter((topic) => topic.level.level === level).length,
  }));
  return (
    <section aria-label="Verständnis" className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium text-base-800">Verständnis</h2>
        <span className="text-[13px] leading-4.5 text-base-500">
          {topics.length === 1 ? "1 Thema" : `${topics.length} Themen`}
        </span>
      </div>
      <div
        aria-hidden="true"
        className="flex h-2 shrink-0 gap-0.5 overflow-clip rounded-sm bg-base-200"
      >
        {topics.length > 0 &&
          counts
            .filter(({ count }) => count > 0)
            .map(({ level, swatch, count }) => (
              <span
                key={level}
                className={swatch}
                style={{ width: `${(count / topics.length) * 100}%` }}
              />
            ))}
      </div>
      <ul className="flex flex-col gap-1.5">
        {counts.map(({ level, swatch, count }) => (
          <li key={level} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-xs ${swatch}`}
            />
            <span className="flex-1 text-[13px] leading-4.5 text-base-600">
              {levels[level].label}
            </span>
            <span className="text-[13px] leading-4.5 font-medium text-base-800">
              {count}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-base-500">
        Nach deiner letzten Selbsteinschätzung pro Thema.
      </p>
    </section>
  );
}
