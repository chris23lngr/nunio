import type { Principal } from "@nunio/delegation";
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
  kind: "studyBlock.create";
  args: { workId: string; start: Date; end: Date };
  notes: BlockNote[];
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
      properties: {
        work: { type: "string", pattern: "^[OT]\\d+$" },
        start: localTime,
        end: localTime,
      },
      required: ["work", "start", "end"],
      additionalProperties: false,
    }),
  });
}

/** Checks a proposed Study Block against the Plan, holding a valid one in `proposals` under its tool call. */
export function approveStudyBlock(
  turn: Turn,
  {
    plan,
    p,
    timeZone,
    proposals,
  }: {
    plan: Pick<Plan, "check">;
    p: Principal;
    timeZone: string;
    proposals: Map<string, Proposal>;
  },
) {
  return async (
    input: { work: string; start: string; end: string },
    { toolCallId }: { toolCallId: string },
  ) => {
    const work = turn.lookup(input.work);
    if (!work || work.kind === "block")
      return {
        type: "denied" as const,
        reason: `Not proposed: no Obligation or Task has the handle ${input.work}. Read the Plan with agenda first.`,
      };
    const args = {
      workId: work.id,
      start: instant(input.start, timeZone),
      end: instant(input.end, timeZone),
    };
    const checked = await plan.check(p, {
      kind: "create",
      work: { kind: work.kind, id: work.id },
      start: args.start,
      end: args.end,
    });
    if (checked.status === "refused")
      return {
        type: "denied" as const,
        reason: `Not proposed: ${checked.reasons.map((reason) => why[reason]).join("; ")}. Choose another time.`,
      };
    proposals.set(toolCallId, {
      kind: "studyBlock.create",
      args,
      notes: checked.notes,
    });
    return { type: "user-approval" as const };
  };
}
