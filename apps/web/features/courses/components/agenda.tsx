import { endOfDay, format, isToday, isTomorrow } from "date-fns";
import type { LucideIcon } from "lucide-react";
import {
  BookCheck,
  ClipboardCheck,
  NotebookPen,
  Presentation,
} from "lucide-react";
import type { CoursePage } from "../api/course-queries";

type Dated = CoursePage["dated"][number];

/** How many items the page shows; the API returns every dated one. */
const shown = 5;

const obligationKinds: Record<NonNullable<Dated["obligationKind"]>, string> = {
  exam: "Klausur",
  assignment: "Abgabe",
  presentation: "Präsentation",
  thesis: "Abschlussarbeit",
  registration: "Anmeldung",
  other: "Frist",
};

/** Each kind's icon: Tailwind's teal 500 for study, as in Paper; deadlines in red. */
const icons: Record<Dated["kind"], { icon: LucideIcon; color: string }> = {
  study_block: { icon: NotebookPen, color: "text-[oklch(70.4%_0.14_182.5)]" },
  course_event: { icon: Presentation, color: "text-primary-500" },
  obligation: { icon: ClipboardCheck, color: "text-destructive-500" },
};

const time = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
});
const day = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const weekday = new Intl.DateTimeFormat("de-DE", { weekday: "long" });

/** When an item is over: a timed one at its end or due time, a whole-day one when its day ends. */
const endOf = (item: Dated) =>
  item.end
    ? new Date(item.end)
    : item.allDay
      ? endOfDay(new Date(item.start))
      : new Date(item.start);

/** What an item is and when, under its title. */
function detailOf(item: Dated) {
  const span = `${time.format(new Date(item.start))} - ${item.end ? time.format(new Date(item.end)) : ""}`;
  if (item.kind === "study_block") return `Lernblock • ${span}`;
  if (item.kind === "course_event") return `Lehrveranstaltung • ${span}`;
  if (item.unreviewed) return "Termin nicht bestätigt";
  const kind = obligationKinds[item.obligationKind ?? "other"];
  return `${kind} • ${item.allDay ? "ganztägig" : time.format(new Date(item.start))}`;
}

/** The next few dated items of the Course, by day. */
export function Agenda({ dated, now }: { dated: Dated[]; now: Date }) {
  const next = dated.filter((item) => endOf(item) > now).slice(0, shown);
  const days = new Map<string, Dated[]>();
  for (const item of next) {
    const key = format(new Date(item.start), "yyyy-MM-dd");
    days.set(key, [...(days.get(key) ?? []), item]);
  }
  if (!next.length)
    return (
      <div className="flex flex-col items-center gap-0.5 rounded-lg border border-dashed border-base-200 py-6 text-center">
        <p className="text-sm font-medium text-base-800">Keine Termine</p>
        <p className="text-xs text-base-500">
          Für diesen Kurs steht nichts an.
        </p>
      </div>
    );
  return (
    <ul className="flex flex-col gap-8">
      {[...days.values()].map((items) => {
        const at = new Date(items[0]!.start);
        const relative = isToday(at)
          ? "Heute"
          : isTomorrow(at)
            ? "Morgen"
            : null;
        return (
          <li key={at.toISOString()} className="flex flex-col">
            <h3 className="border-b border-base-200 pb-2 text-xs font-medium text-base-600">
              {day.format(at)} • {weekday.format(at)}
              {relative && (
                <>
                  {" • "}
                  <span className="text-primary-500">{relative}</span>
                </>
              )}
            </h3>
            <dl className="mt-4 flex flex-col gap-5">
              {items.map((item) => {
                const { icon: Icon, color } = icons[item.kind];
                const KindIcon =
                  item.obligationKind === "exam" ? BookCheck : Icon;
                return (
                  <div key={item.id} className="flex flex-col gap-0.5">
                    <dt className="flex items-center gap-2 text-sm text-base-700">
                      <KindIcon
                        aria-hidden="true"
                        className={`size-4 shrink-0 ${color}`}
                      />
                      {item.title}
                    </dt>
                    <dd className="pl-6 text-xs text-base-500">
                      {detailOf(item)}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
