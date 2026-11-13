import {
  addDays,
  addMinutes,
  differenceInMinutes,
  format,
  getISODay,
  isSameDay,
  max,
  min,
} from "date-fns";
import type { CourseColor } from "@/features/courses/api/course-queries";
import type { Plan, PlanMove } from "./api/plan-queries";

/** Minutes of Study Blocks that start on `day`. */
export function plannedMinutes(plan: Plan, day: Date) {
  return plan.studyBlocks
    .filter((block) => isSameDay(new Date(block.start), day))
    .reduce(
      (sum, block) =>
        sum + differenceInMinutes(new Date(block.end), new Date(block.start)),
      0,
    );
}

/**
 * The Protected Time on the given days, one range per rule and day. Weekly rules use
 * the browser's time zone, assumed to be the student's `timeZone`.
 */
export function protectedRanges(plan: Plan, days: Date[]) {
  return plan.limits.protectedTime.flatMap((rule) =>
    days.flatMap((day) => {
      const id = `${rule.id}-${format(day, "yyyy-MM-dd")}`;
      if ("weekday" in rule) {
        if (getISODay(day) !== rule.weekday) return [];
        return [
          {
            id,
            start: addMinutes(day, rule.fromMinute),
            end: addMinutes(day, rule.toMinute),
          },
        ];
      }
      const start = max([new Date(rule.start), day]);
      const end = min([new Date(rule.end), addDays(day, 1)]);
      return start < end ? [{ id, start, end }] : [];
    }),
  );
}

export type PlanEntry = {
  id: string;
  kind: "fixed" | "study" | "proposal";
  title: string;
  start: Date;
  end: Date;
  course: { title: string; color: CourseColor } | null;
  placedByStudent: boolean;
  locked: boolean;
};

/** Each Course's color by id, from the course list. */
export type CourseColors = Record<string, CourseColor>;

/** An Obligation or Task by id, with the Obligation it belongs to (itself for an Obligation) and its Course. */
function findWork(plan: Plan, id: string) {
  const own = plan.obligations.find((o) => o.id === id);
  if (own)
    return {
      title: own.title,
      obligation: own,
      course: { id: own.courseId, title: own.course },
      estimate: own.estimate,
    };
  const task = plan.tasks.find((t) => t.id === id);
  if (!task) return null;
  const obligation =
    plan.obligations.find((o) => o.id === task.obligationId) ?? null;
  // A Task toward no Obligation may be in a Course of its own.
  const course = obligation
    ? { id: obligation.courseId, title: obligation.course }
    : task.courseId && task.course
      ? { id: task.courseId, title: task.course }
      : null;
  return { title: task.title, obligation, course, estimate: task.estimate };
}

/** What a Fixed Event's popover shows: nunio knows no more than what, when and where from. */
export function fixedEventDetails(plan: Plan, eventId: string) {
  const event = plan.fixedEvents.find((e) => e.id === eventId);
  if (!event) return null;
  return {
    title: event.title,
    start: new Date(event.start),
    end: new Date(event.end),
    calendar:
      plan.calendars.find((c) => c.id === event.calendarId)?.name ?? null,
  };
}

/** What a Study Block's popover shows, or null when the block is gone. */
export function blockDetails(
  plan: Plan,
  blockId: string,
  colors: CourseColors,
) {
  const block = plan.studyBlocks.find((b) => b.id === blockId);
  if (!block) return null;
  const work = findWork(plan, block.work.id);
  const obligation = work?.obligation;
  const planned = plan.studyBlocks
    .filter((b) => b.work.id === block.work.id)
    .reduce(
      (sum, b) => sum + differenceInMinutes(new Date(b.end), new Date(b.start)),
      0,
    );
  return {
    course: courseOf(work, colors),
    title: work?.title ?? "",
    placedBy: block.placedBy,
    locked: block.locked,
    start: new Date(block.start),
    end: new Date(block.end),
    obligation: obligation?.due
      ? { title: obligation.title, due: new Date(obligation.due) }
      : null,
    estimate: work?.estimate
      ? {
          plannedMinutes: planned,
          estimatedMinutes: work.estimate.minutes,
          rationale: work.estimate.rationale,
        }
      : null,
  };
}

/** The Course of a piece of work, when it has one with a known color. */
function courseOf(work: ReturnType<typeof findWork>, colors: CourseColors) {
  const course = work?.course;
  const color = course ? colors[course.id] : undefined;
  return course && color ? { title: course.title, color } : null;
}

/** What the week grid shows of the Plan. */
export function planEntries(plan: Plan, colors: CourseColors): PlanEntry[] {
  const fixed = plan.fixedEvents.map(
    (event): PlanEntry => ({
      id: event.id,
      kind: "fixed",
      title: event.title,
      start: new Date(event.start),
      end: new Date(event.end),
      course: null,
      placedByStudent: false,
      locked: false,
    }),
  );
  const study = plan.studyBlocks.map((block): PlanEntry => {
    const work = findWork(plan, block.work.id);
    return {
      id: block.id,
      kind: "study",
      title: work?.title ?? "",
      start: new Date(block.start),
      end: new Date(block.end),
      course: courseOf(work, colors),
      placedByStudent: block.placedBy === "student",
      locked: block.locked,
    };
  });
  const proposed = timedMoves(plan).map(
    ({ id, move, start, end }): PlanEntry => {
      const work = findWork(plan, move.workId);
      return {
        id,
        kind: "proposal",
        title: work?.title ?? "",
        start,
        end,
        course: courseOf(work, colors),
        placedByStudent: false,
        locked: false,
      };
    },
  );
  return [...fixed, ...study, ...proposed];
}

/** What the suggestions sheet lists; ids match the grid's proposal entries. */
export function planSuggestions(plan: Plan) {
  return timedMoves(plan).map(({ id, move, start, end }) => ({
    id,
    kind: move.kind,
    title: findWork(plan, move.workId)?.title ?? "",
    start,
    end,
    needsApproval: move.needsApproval,
  }));
}

/** The proposal's moves that have a time, by id ("move-<index>"), with where they put their Study Block. */
export function timedMoves(plan: Plan) {
  return plan.proposal.moves.flatMap((move: PlanMove, index) => {
    const { start, end } = move.kind === "create" ? move : move.to;
    if (!start || !end) return [];
    return [
      { id: `move-${index}`, move, start: new Date(start), end: new Date(end) },
    ];
  });
}
