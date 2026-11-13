import type { ActionIntent, Principal } from "@nunio/delegation";
import type { BlockNote, BlockRefusal, Plan } from "@nunio/planning";
import { deadline } from "@nunio/planning";
import type { Tool } from "ai";
import { jsonSchema, tool } from "ai";
import type { Turn } from "./turn.js";

const localTime = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$",
} as const;
const why: Record<BlockRefusal, string> = {
  invalid: "its end must come after its start, at most 14 days later",
  gone: "the work or block is gone",
  past: "it starts in the past",
  protected_time: "it overlaps the student's Protected Time",
  fixed_event: "it overlaps a Fixed Event",
  study_block: "it overlaps another Study Block",
  locked: "the block is Locked",
};

/** A wall-clock time in the student's time zone, as the model gives it. */
const instant = (local: string, timeZone: string) =>
  deadline(local.slice(0, 10), local.slice(11, 16), timeZone);

/** A proposal the student is asked to approve once the answer is saved. */
export type Proposal = {
  notes: BlockNote[];
} & (
  | {
      kind: "studyBlock.create";
      args: { workId: string; start: Date; end: Date };
    }
  | {
      kind: "studyBlock.move";
      args: { studyBlockId: string; start: Date; end: Date };
    }
  | {
      kind: "task.create";
      args: {
        title: string;
        courseId: string | null;
        fixedEventId: string | null;
        role: "preparation" | "follow_up" | null;
        estimateMinutes: number | null;
      };
    }
  | { kind: "task.reopen"; args: { taskId: string } }
);

/** The Action a proposal is asked as. */
export const intentOf = (proposal: Proposal): ActionIntent =>
  ({ kind: proposal.kind, ...proposal.args }) as ActionIntent;

/**
 * Proposes a Task for the student to approve (ADR-0021): a Course Event's Preparation or Follow-up, or a Task in a
 * Course or none. Like a Study Block, it never runs; the student's Approval adds it.
 */
export function proposeTaskTool(): Tool<{
  title: string;
  course?: string;
  event?: string;
  role?: "preparation" | "follow_up";
  minutes?: number;
}> {
  return tool({
    description:
      "Proposes a Task for the student to approve. For a Course Event the Plan showed, name it by its handle, such as E1, with role preparation or follow_up, but only if it has no Task in that role yet; otherwise name a Course by its handle, such as K1, or none. Give a short title and, if the student said, the minutes it needs.",
    inputSchema: jsonSchema({
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 200 },
        course: { type: "string", pattern: "^K\\d+$" },
        event: { type: "string", pattern: "^E\\d+$" },
        role: { type: "string", enum: ["preparation", "follow_up"] },
        minutes: { type: "integer", minimum: 15, maximum: 1440 },
      },
      required: ["title"],
      additionalProperties: false,
    }),
  });
}

/** Proposes reopening a done Task the Plan showed, such as a Follow-up the student needs more time for. */
export function proposeTaskReopenTool(): Tool<{ task: string }> {
  return tool({
    description:
      "Proposes reopening a done Task the Plan showed, for the student to approve. Name it by its handle, such as T1.",
    inputSchema: jsonSchema<{ task: string }>({
      type: "object",
      properties: { task: { type: "string", pattern: "^T\\d+$" } },
      required: ["task"],
      additionalProperties: false,
    }),
  });
}

const times = {
  start: localTime,
  end: localTime,
};

/**
 * Proposes a new Study Block (ADR-0019). The tool never runs: its approval check refuses a proposal that breaks the
 * Plan's hard rules, with the reason, so the model can choose again, and otherwise holds it for the student. Authority
 * comes only from the gate, once the answer is saved (ADR-0010).
 */
export function proposeStudyBlockTool(): Tool<{
  work: string;
  start: string;
  end: string;
}> {
  return tool({
    description:
      "Proposes a new Study Block for an Obligation or Task the Plan showed, for the student to approve. Name the work by its handle, such as O1 or T1, and give start and end as YYYY-MM-DDTHH:MM in the student's time zone.",
    inputSchema: jsonSchema<{ work: string; start: string; end: string }>({
      type: "object",
      properties: { work: { type: "string", pattern: "^[OT]\\d+$" }, ...times },
      required: ["work", "start", "end"],
      additionalProperties: false,
    }),
  });
}

/** Proposes moving a Study Block the Plan showed; like a new one, it never runs and waits for the student. */
export function proposeStudyBlockMoveTool(): Tool<{
  block: string;
  start: string;
  end: string;
}> {
  return tool({
    description:
      "Proposes moving a Study Block the Plan showed, for the student to approve. Name it by its handle, such as B1, and give its new start and end as YYYY-MM-DDTHH:MM in the student's time zone.",
    inputSchema: jsonSchema<{ block: string; start: string; end: string }>({
      type: "object",
      properties: { block: { type: "string", pattern: "^B\\d+$" }, ...times },
      required: ["block", "start", "end"],
      additionalProperties: false,
    }),
  });
}

/** Checks a proposal against the Plan, holding a valid one in `proposals` under its tool call. */
export function approveProposal(
  turn: Turn,
  {
    plan,
    p,
    timeZone,
    proposals,
    courses,
  }: {
    plan: Pick<Plan, "check" | "view">;
    p: Principal;
    timeZone: string;
    proposals: Map<string, Proposal>;
    /** The student's Courses by handle, as the context message lists them. */
    courses: ReadonlyMap<string, { id: string }>;
  },
) {
  const denied = (reason: string) => ({ type: "denied" as const, reason });
  const check = async (
    toolCallId: string,
    proposal: Proposal,
    checked: Awaited<ReturnType<Plan["check"]>>,
  ) => {
    if (checked.status === "refused")
      return denied(
        `Not proposed: ${checked.reasons.map((reason) => why[reason]).join("; ")}. Choose another time.`,
      );
    proposals.set(toolCallId, { ...proposal, notes: checked.notes });
    return { type: "user-approval" as const };
  };
  return {
    create: async (
      input: { work: string; start: string; end: string },
      { toolCallId }: { toolCallId: string },
    ) => {
      const work = turn.lookup(input.work);
      if (!work || (work.kind !== "obligation" && work.kind !== "task"))
        return denied(
          `Not proposed: no Obligation or Task has the handle ${input.work}. Read the Plan with agenda first.`,
        );
      const args = {
        workId: work.id,
        start: instant(input.start, timeZone),
        end: instant(input.end, timeZone),
      };
      return check(
        toolCallId,
        { kind: "studyBlock.create", args, notes: [] },
        await plan.check(p, {
          kind: "create",
          work: { kind: work.kind, id: work.id },
          start: args.start,
          end: args.end,
        }),
      );
    },
    move: async (
      input: { block: string; start: string; end: string },
      { toolCallId }: { toolCallId: string },
    ) => {
      const block = turn.lookup(input.block);
      if (block?.kind !== "block")
        return denied(
          `Not proposed: no Study Block has the handle ${input.block}. Read the Plan with agenda first.`,
        );
      const args = {
        studyBlockId: block.id,
        start: instant(input.start, timeZone),
        end: instant(input.end, timeZone),
      };
      return check(
        toolCallId,
        { kind: "studyBlock.move", args, notes: [] },
        await plan.check(p, {
          kind: "move",
          blockId: block.id,
          start: args.start,
          end: args.end,
        }),
      );
    },
    task: async (
      input: {
        title: string;
        course?: string;
        event?: string;
        role?: "preparation" | "follow_up";
        minutes?: number;
      },
      { toolCallId }: { toolCallId: string },
    ) => {
      let courseId: string | null = null;
      let fixedEventId: string | null = null;
      if (input.event) {
        const handled = turn.lookup(input.event);
        const view = await plan.view(p);
        const event =
          handled?.kind === "event"
            ? view.fixedEvents.find((e) => e.id === handled.id)
            : undefined;
        if (!event?.courseId)
          return denied(
            `Not proposed: no Course Event has the handle ${input.event}. Read the Plan with agenda first.`,
          );
        if (!input.role)
          return denied(
            "Not proposed: say whether the Task prepares for the Course Event or follows up on it.",
          );
        if (
          view.tasks.some(
            (t) => t.fixedEventId === event.id && t.role === input.role,
          )
        )
          return denied(
            `Not proposed: ${input.event} already has a ${input.role === "preparation" ? "Preparation" : "Follow-up"}. Propose a Study Block for it, or reopen it if it is done.`,
          );
        courseId = event.courseId;
        fixedEventId = event.id;
      } else if (input.course) {
        const course = courses.get(input.course);
        if (!course)
          return denied(
            `Not proposed: no Course has the handle ${input.course}.`,
          );
        courseId = course.id;
      }
      proposals.set(toolCallId, {
        kind: "task.create",
        args: {
          title: input.title.trim(),
          courseId,
          fixedEventId,
          role: fixedEventId ? (input.role ?? null) : null,
          estimateMinutes: input.minutes ?? null,
        },
        notes: [],
      });
      return { type: "user-approval" as const };
    },
    reopen: async (
      input: { task: string },
      { toolCallId }: { toolCallId: string },
    ) => {
      const handled = turn.lookup(input.task);
      const task =
        handled?.kind === "task"
          ? (await plan.view(p)).tasks.find((t) => t.id === handled.id)
          : undefined;
      if (!task)
        return denied(
          `Not proposed: no Task has the handle ${input.task}. Read the Plan with agenda first.`,
        );
      if (!task.done)
        return denied(
          `Not proposed: ${input.task} is not done, so it is open already.`,
        );
      proposals.set(toolCallId, {
        kind: "task.reopen",
        args: { taskId: task.id },
        notes: [],
      });
      return { type: "user-approval" as const };
    },
  };
}
