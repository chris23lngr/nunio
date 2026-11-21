import type {
  ActionIntent,
  CapabilityId,
  Principal,
  Refusal,
} from "@nunio/delegation";
import { capabilities } from "@nunio/delegation";
import type { Plan } from "@nunio/planning";
import { deadline } from "@nunio/planning";
import type { JSONSchema7, ToolSet } from "ai";
import { jsonSchema, tool } from "ai";
import type { Turn } from "./turn.js";

const localTime = {
  type: "string",
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$",
} as const;
const span = { start: localTime, end: localTime };
const when =
  "give start and end as YYYY-MM-DDTHH:MM in the student's time zone";

const block = { type: "string", pattern: "^B\\d+$" } as const;
/** What each Action's tool takes: work or a block by its handle, and where it goes in the student's time zone. */
const inputs: Record<(typeof capabilities)[CapabilityId]["kind"], JSONSchema7> =
  {
    "studyBlock.create": {
      type: "object",
      properties: { work: { type: "string", pattern: "^[OT]\\d+$" }, ...span },
      required: ["work", "start", "end"],
      additionalProperties: false,
    },
    "studyBlock.move": {
      type: "object",
      properties: { block, ...span },
      required: ["block", "start", "end"],
      additionalProperties: false,
    },
    "studyBlock.remove": {
      type: "object",
      properties: { block },
      required: ["block"],
      additionalProperties: false,
    },
  };

/** What the model is told of each Capability's tool; how the tool reads its call follows from the Capability's Action. */
const descriptions: Record<CapabilityId, string> = {
  createStudyBlocks: `Creates a Study Block for an Obligation or Task the Plan showed. Name the work by its handle, such as O1 or T1, and ${when}.`,
  moveOwnStudyBlocks: `Moves a Study Block you created that the student has not moved since. Name it by its handle, such as B1, and ${when}.`,
  moveStudyBlocks: `Moves any Study Block the Plan showed, also one the student or someone else placed; the student is always asked first. Name it by its handle, such as B1, and ${when}.`,
  removeOwnStudyBlocks:
    "Removes a Study Block you created that the student has not moved since. Name it by its handle, such as B1. A Locked block, or one that has started, cannot be removed.",
};

/**
 * The Agent's Action tools: exactly its Capabilities, one tool each, named by the Capability (ADR-0026). None has an
 * `execute`: the step hands its calls back, and the gate performs them after it, under `runId:step:call`.
 */
export function actionTools(held: readonly CapabilityId[]): ToolSet {
  return Object.fromEntries(
    held.map((id) => [
      id,
      tool({
        description: descriptions[id],
        inputSchema: jsonSchema(inputs[capabilities[id].kind]),
      }),
    ]),
  );
}

/** One Action call of a step as stored: the Action the gate performs, or why none could be asked. Dates as ISO strings. */
export type StoredCall = {
  toolCallId: string;
  toolName: string;
} & ({ intent: Record<string, unknown> } | { invalid: string });

/** A stored intent with its dates revived, as the gate takes it. */
export const intentOf = (call: { intent: Record<string, unknown> }) =>
  ({
    ...call.intent,
    start: new Date(call.intent.start as string),
    end: new Date(call.intent.end as string),
  }) as ActionIntent;

const maxBlockMs = 14 * 24 * 60 * 60_000;

/** A local YYYY-MM-DDTHH:MM in the student's time zone as an instant; null unless it names a day and time that exist. */
function instantOf(local: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [year, month, date, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const day = new Date(Date.UTC(year, month - 1, date));
  if (
    day.getUTCMonth() !== month - 1 ||
    day.getUTCDate() !== date ||
    hour > 23 ||
    minute > 59
  )
    return null;
  return deadline(local.slice(0, 10), local.slice(11, 16), timeZone);
}

/**
 * Reads one Action call into the Action it asks for, naming work and blocks by the handles the Run's tools gave out.
 * A call that names nothing the Run read, or a span that cannot be, asks for nothing, and the model is told why.
 */
export async function readCall(
  turn: Turn,
  {
    plan,
    p,
    timeZone,
  }: { plan: Pick<Plan, "view">; p: Principal; timeZone: string },
  call: { toolCallId: string; toolName: string; input: unknown },
): Promise<StoredCall> {
  const { toolCallId, toolName } = call;
  const invalid = (reason: string): StoredCall => ({
    toolCallId,
    toolName,
    invalid: reason,
  });
  const kind = Object.hasOwn(capabilities, toolName)
    ? capabilities[toolName as CapabilityId].kind
    : null;
  if (!kind) return invalid("you have no such tool.");
  // The model's arguments are checked here, never trusted: a malformed call asks for nothing.
  const fields = Object.keys(inputs[kind].properties ?? {});
  const given =
    call.input && typeof call.input === "object"
      ? (call.input as Record<string, unknown>)
      : {};
  if (fields.some((field) => typeof given[field] !== "string"))
    return invalid(`give ${fields.join(", ")}, each as text.`);
  const input = given as {
    work?: string;
    block?: string;
    start?: string;
    end?: string;
  };
  let times: { start: Date; end: Date } | null = null;
  if (input.start !== undefined && input.end !== undefined) {
    const start = instantOf(input.start, timeZone);
    const end = instantOf(input.end, timeZone);
    if (!start || !end)
      return invalid(
        "give start and end as YYYY-MM-DDTHH:MM, each a day and time that exist.",
      );
    if (!(end > start && end.getTime() - start.getTime() <= maxBlockMs))
      return invalid(
        "its end must come after its start, at most 14 days later.",
      );
    times = { start, end };
  }
  const intent = (value: object): StoredCall => ({
    toolCallId,
    toolName,
    intent: JSON.parse(JSON.stringify(value)),
  });
  if (kind === "studyBlock.create") {
    const work = turn.lookup(input.work ?? "");
    if (work?.kind !== "obligation" && work?.kind !== "task")
      return invalid(
        `no Obligation or Task has the handle ${input.work}. Read the Plan with agenda first.`,
      );
    return intent({ kind, workId: work.id, ...times });
  }
  const handled = turn.lookup(input.block ?? "");
  if (handled?.kind !== "block")
    return invalid(
      `no Study Block has the handle ${input.block}. Read the Plan with agenda first.`,
    );
  if (kind === "studyBlock.move")
    return intent({ kind, studyBlockId: handled.id, ...times });
  // The block as the Plan shows it now, so it can still be named once removed (ADR-0021).
  const block = (await plan.view(p)).studyBlocks.find(
    (b) => b.id === handled.id,
  );
  if (!block) return invalid(`the Study Block ${input.block} is gone.`);
  return intent({
    kind,
    studyBlockId: block.id,
    workId: block.work.id,
    start: block.start,
    end: block.end,
  });
}

/** Why the gate refused an Action, as the model is told. */
export const why: Record<Refusal, string> = {
  not_owner: "the work or block is gone",
  paused: "your Agent is Paused",
  ended: "your Agent is Ended",
  approval_denied: "the student said no",
  approval_expired: "the student did not answer in time",
  approval_withdrawn:
    "the student Paused or Ended your Agent before deciding, which withdrew it",
  approval_mismatch: "it changed since the student was asked",
  locked: "the block is Locked",
  started: "the block has already started",
  protected_time: "it overlaps the student's Protected Time",
  restricted: "your Agent may not do this",
  past: "it starts in the past",
  fixed_event: "it overlaps a Fixed Event",
  study_block: "it overlaps another Study Block",
  out_of_scope: "it is not work of your Courses",
  no_capability:
    "you may not do this, such as moving or removing a block you did not create",
  run_cap:
    "this Run has reached its limit of Action calls or of Approvals asked, so make no more such calls",
  open_approvals_cap:
    "the student has too many of your requests open already, so ask nothing more until they decide",
};

/** What the model is told became of one Action call: what the gate recorded for it, or why none was asked. */
export function resultOf(
  turn: Turn,
  call: StoredCall,
  action: {
    kind: string;
    status: string;
    refusal: string | null;
    failure: string | null;
    effect: unknown;
  } | null,
): string {
  if ("invalid" in call) return `Refused, nothing was asked: ${call.invalid}`;
  if (!action) throw new Error(`Call ${call.toolCallId} was never performed`);
  switch (action.status) {
    case "done": {
      if (action.kind === "studyBlock.move")
        return "Done: the Study Block was moved.";
      if (action.kind === "studyBlock.remove")
        return "Done: the Study Block was removed.";
      const { studyBlockId } = action.effect as { studyBlockId: string };
      return `Done: the Study Block was created as ${turn.handleFor("block", studyBlockId)}.`;
    }
    case "awaiting_approval":
      return "Asked, not happened: the student decides after this Run. Do not build on it, and do not ask for it again.";
    case "refused":
      return `Refused: ${why[action.refusal as Refusal] ?? action.refusal}.`;
    case "failed":
      return `Failed, it did not happen: ${action.failure}.`;
    case "unconfirmed":
      return "Unconfirmed: nunio cannot tell whether it happened, so the student resolves it.";
    default:
      throw new Error(`Call ${call.toolCallId} is still being performed`);
  }
}
