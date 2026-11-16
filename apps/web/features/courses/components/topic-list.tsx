import type { CourseTopic } from "../api/course-queries";
import { dayAgoText } from "../course-format";
import { levelOf } from "../topic-levels";

/** The Course's Topics, each with the student's Level and when Evidence last supported it; a click opens its details. */
export function TopicList({
  topics,
  now,
  onOpen,
}: {
  topics: CourseTopic[];
  now: Date;
  onOpen: (id: string) => void;
}) {
  return (
    <ul aria-label="Themen" className="flex flex-col gap-5">
      {topics.map((topic) => {
        const { label, icon: Icon, color } = levelOf(topic.level);
        return (
          <li key={topic.id}>
            <button
              type="button"
              onClick={() => onOpen(topic.id)}
              className="group flex max-w-full cursor-pointer items-center gap-2 rounded-sm text-left text-sm focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-4 focus-visible:outline-none"
            >
              <Icon aria-hidden="true" className={`size-4 shrink-0 ${color}`} />
              <span className="sr-only">{label}</span>
              <span className="truncate font-medium text-base-600 group-hover:text-base-800">
                {topic.title}
              </span>
              <span className="shrink-0 text-base-500">
                {dayAgoText(topic.lastEvidenceAt, now)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
