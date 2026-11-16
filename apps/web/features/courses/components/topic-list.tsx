import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@nunio/ui/components/collapsible/collapsible";
import type { CourseTopic, CourseTopicAreas } from "../api/course-queries";
import { dayAgoText } from "../course-format";
import { levelOf } from "../topic-levels";

/** Topics, each with the student's Level and when Evidence last supported it; a click opens its details. */
export function TopicList({
  topics,
  now,
  onOpen,
  label = "Themen",
}: {
  topics: CourseTopic[];
  now: Date;
  onOpen: (id: string) => void;
  label?: string;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-5">
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

/** One collapsible Topic Area: its name and count, then its Topics; collapsed until the student opens it. */
function TopicArea({
  name,
  topics,
  now,
  onOpen,
}: {
  name: string;
  topics: CourseTopic[];
  now: Date;
  onOpen: (id: string) => void;
}) {
  return (
    <Collapsible className="flex flex-col gap-4">
      <CollapsibleTrigger className="group flex cursor-pointer items-center gap-2 self-start rounded-sm text-sm focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-4 focus-visible:outline-none">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-4 shrink-0 -rotate-90 fill-base-500 stroke-base-500 transition-transform group-data-[panel-open]:rotate-0"
        >
          <path
            d="M4 6L8 10L12 6L4 6Z"
            strokeWidth="1.33"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="font-medium text-base-600">{name}</span>{" "}
        <span className="text-base-500">{topics.length}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-1">
        <TopicList topics={topics} now={now} onOpen={onOpen} label={name} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The Course's Topics grouped into Topic Areas (ADR-0024), then those in none under Weitere Themen. The Level and
 * last Evidence come from the page's Topics; a Topic only the page knows of counts as ungrouped.
 */
export function TopicAreaList({
  areas,
  topics,
  now,
  onOpen,
}: {
  areas: CourseTopicAreas["areas"];
  topics: CourseTopic[];
  now: Date;
  onOpen: (id: string) => void;
}) {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const grouped = areas
    .map((area) => ({
      ...area,
      topics: area.topics.flatMap((t) => byId.get(t.id) ?? []),
    }))
    .filter((area) => area.topics.length);
  const placed = new Set(grouped.flatMap((a) => a.topics.map((t) => t.id)));
  const rest = topics.filter((topic) => !placed.has(topic.id));
  return (
    <div className="flex flex-col gap-5">
      {grouped.map((area) => (
        <TopicArea
          key={area.id}
          name={area.name}
          topics={area.topics}
          now={now}
          onOpen={onOpen}
        />
      ))}
      {rest.length > 0 && (
        <TopicArea
          name="Weitere Themen"
          topics={rest}
          now={now}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}
