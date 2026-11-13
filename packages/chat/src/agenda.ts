import type { Principal } from "@nunio/delegation";
import type { KnowledgeReader } from "@nunio/knowledge";
import type { Plan } from "@nunio/planning";
import { deadline } from "@nunio/planning";
import type { Tool } from "ai";
import { jsonSchema, tool } from "ai";
import type { ContextCourse } from "./context.js";
import type { Turn } from "./turn.js";
import { fenced } from "./turn.js";

/** What the student sees of a reading of the Plan: the days, and how much was in them. */
export type AgendaOutput = {
  from: string;
  to: string;
  obligations: number;
  studyBlocks: number;
  fixedEvents: number;
};

const dayMs = 24 * 60 * 60_000;
const maxDays = 31;
const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

/** The day after a YYYY-MM-DD date. */
const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + dayMs).toISOString().slice(0, 10);

/**
 * Reads the student's Plan for a range of days (ADR-0020): Obligations due in it, with their Tasks and the tag to
 * cite each by, open Tasks toward no Obligation (ADR-0021), then Study Blocks and Fixed Events. Titles may come from a
 * Source, so they are fenced as data.
 */
export function agendaTool(
  turn: Turn,
  {
    reader,
    plan,
    p,
    timeZone,
    courses,
  }: {
    reader: KnowledgeReader;
    plan: Pick<Plan, "view">;
    p: Principal;
    timeZone: string;
    /** The student's Courses by handle, as the context message lists them. */
    courses: ReadonlyMap<string, ContextCourse>;
  },
): Tool<{ from: string; to: string }, AgendaOutput> {
  const handleOf = new Map(
    [...courses].map(([handle, course]) => [course.id, handle]),
  );
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const at = (instant: Date) => local.format(instant).replace(",", "");
  const time = (instant: Date) => at(instant).slice(11);
  return tool({
    description: `Reads the student's Plan for a range of days: the Obligations due in it, each with its Tasks and the tag to cite it by, the open Tasks toward no Obligation, then Study Blocks and Fixed Events. A Fixed Event that is a Course Event names its Course and its Preparation and Follow-up, if any. Obligations, Tasks, Study Blocks and Course Events carry a handle such as O1, T1, B1 or E1, which proposals name them by. Dates are YYYY-MM-DD in the student's time zone, at most ${maxDays} days apart, both included.`,
    inputSchema: jsonSchema<{ from: string; to: string }>({
      type: "object",
      properties: { from: date, to: date },
      required: ["from", "to"],
      additionalProperties: false,
    }),
    execute: async ({ from, to }, { toolCallId }): Promise<AgendaOutput> => {
      const days = (Date.parse(to) - Date.parse(from)) / dayMs + 1;
      if (!(days >= 1 && days <= maxDays))
        throw new Error(
          `Choose a range of 1 to ${maxDays} days, with "from" not after "to".`,
        );
      const start = deadline(from, null, timeZone);
      const end = deadline(nextDay(to), null, timeZone);
      const [view, facts] = await Promise.all([
        plan.view(p),
        reader.retrieve(
          p,
          { planning: true },
          { kind: "facts", types: ["obligation"] },
        ),
      ]);
      if (facts.status === "refused")
        throw turn.refuse(facts.reason === "not_owner" ? "gone" : facts.reason);
      const obligationFacts = new Map(
        facts.items.flatMap((item) =>
          item.kind === "fact" ? [[item.factId, item] as const] : [],
        ),
      );
      const within = (instant: Date) => instant >= start && instant < end;
      const overlaps = (span: { start: Date; end: Date }) =>
        span.start < end && span.end > start;
      const obligations = view.obligations
        .filter((o) => o.due && within(o.due))
        .sort((a, b) => a.due!.getTime() - b.due!.getTime());
      const loose = view.tasks.filter((t) => !t.obligationId && !t.done);
      const blocks = view.studyBlocks.filter(overlaps);
      const events = view.fixedEvents.filter(overlaps);
      const titleOf = (work: { kind: string; id: string }) =>
        work.kind === "obligation"
          ? view.obligations.find((o) => o.id === work.id)?.title
          : view.tasks.find((t) => t.id === work.id)?.title;
      const lines = [
        `Obligations due ${from} to ${to}:`,
        ...(obligations.length ? [] : ["none"]),
        ...obligations.flatMap((o) => {
          const fact = obligationFacts.get(o.id);
          if (fact?.provenance.kind === "source")
            turn.sources.add(fact.provenance.sourceId);
          const notes = [
            o.state === "unreviewed" ? "not reviewed by the student" : null,
            o.reportedSubmittedAt ? "reported as submitted" : null,
          ].filter(Boolean);
          const course = handleOf.get(o.courseId);
          return [
            `${fact ? `[${turn.tagFor(fact.cite)}] ` : ""}${turn.handleFor("obligation", o.id)} · ${at(o.due!)} · ${o.title} · ${o.kind} · ${o.course}${course ? ` (${course})` : ""}${notes.length ? ` · ${notes.join(", ")}` : ""}`,
            ...view.tasks
              .filter((t) => t.obligationId === o.id)
              .map(
                (t) =>
                  `  Task ${turn.handleFor("task", t.id)}: ${t.title}${t.done ? " (done)" : ""}`,
              ),
          ];
        }),
        // They have no deadline, so they show whatever the range.
        "Open Tasks toward no Obligation:",
        ...(loose.length ? [] : ["none"]),
        ...loose.map((t) => {
          const course = t.courseId ? handleOf.get(t.courseId) : undefined;
          return `${turn.handleFor("task", t.id)} · ${t.title} · ${t.course ?? "no Course"}${course ? ` (${course})` : ""}`;
        }),
        "Study Blocks:",
        ...(blocks.length ? [] : ["none"]),
        ...blocks.map(
          (b) =>
            `${turn.handleFor("block", b.id)} · ${at(b.start)}–${time(b.end)} · for ${titleOf(b.work) ?? "work that is gone"}${b.locked ? " · locked" : ""}`,
        ),
        "Fixed Events:",
        ...(events.length ? [] : ["none"]),
        ...events.map((e) => {
          const line = `${at(e.start)}–${time(e.end)} · ${e.title}`;
          if (!e.courseId) return line;
          // A Course Event, with the Preparation and Follow-up it has, done or not (ADR-0021).
          const course = handleOf.get(e.courseId);
          const title = course ? courses.get(course)?.title : undefined;
          const roles = view.tasks
            .filter((t) => t.fixedEventId === e.id && t.role)
            .map(
              (t) =>
                `${t.role === "preparation" ? "Preparation" : "Follow-up"} ${turn.handleFor("task", t.id)} (${t.done ? "done" : "open"})`,
            );
          return [
            `${turn.handleFor("event", e.id)} · ${line} · Course Event of ${title ?? "a Course"}${course ? ` (${course})` : ""}`,
            ...roles,
          ].join(" · ");
        }),
      ];
      turn.give(toolCallId, fenced("plan", lines));
      return {
        from,
        to,
        obligations: obligations.length,
        studyBlocks: blocks.length,
        fixedEvents: events.length,
      };
    },
    toModelOutput: turn.modelOutput,
  });
}
