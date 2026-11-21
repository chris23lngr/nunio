import type {
  ActionIntent,
  CapabilityId,
  Kind,
  Principal,
  Refusal,
} from "@nunio/delegation";
import { capabilities } from "@nunio/delegation";
import type { KnowledgeReader } from "@nunio/knowledge";
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
/**
 * What each Action's tool takes: work or a block by its handle, and where it goes in the student's time zone; or for a
 * Task, its title, what it is for by handle, and the minutes it needs.
 */
const inputs: Partial<Record<Kind, JSONSchema7>> = {
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
  "task.create": {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      course: { type: "string", pattern: "^K\\d+$" },
      obligation: { type: "string", pattern: "^O\\d+$" },
      event: { type: "string", pattern: "^E\\d+$" },
      role: { type: "string", enum: ["preparation", "follow_up"] },
      minutes: { type: "integer", minimum: 15, maximum: 1440 },
    },
    required: ["title"],
    additionalProperties: false,
  },
};
/** What a Lernmaterial Capability's tool takes: the Topics, by the tags courseFacts gave them. */
const artifactInput: JSONSchema7 = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: { type: "string", pattern: "^S\\d+$" },
      minItems: 1,
      maxItems: 10,
    },
  },
  required: ["topics"],
  additionalProperties: false,
};
const artifactCap =
  "Read the Topics with courseFacts first, and name them by the tags it gave them, such as S3. Only one practice set or set of flashcards may start per Run.";
/** A Notice's length at most (#155). */
const maxNotice = 500;
/** What Dich benachrichtigen's tool takes: the Notice's plain text. */
const noticeInput: JSONSchema7 = {
  type: "object",
  properties: { text: { type: "string", minLength: 1, maxLength: maxNotice } },
  required: ["text"],
  additionalProperties: false,
};
/** A Briefing's length at most (#146). */
const maxBriefing = 1500;
/** What Briefing erstellen's tool takes: plain text and the handles of bundled Inbox items from `inbox`. */
const briefingInput: JSONSchema7 = {
  type: "object",
  properties: {
    text: { type: "string", minLength: 1, maxLength: maxBriefing },
    interventions: {
      type: "array",
      items: { type: "string", pattern: "^I\\d+$" },
    },
    approvals: {
      type: "array",
      items: { type: "string", pattern: "^A\\d+$" },
    },
    notices: {
      type: "array",
      items: { type: "string", pattern: "^N\\d+$" },
    },
    artifacts: {
      type: "array",
      items: { type: "string", pattern: "^R\\d+$" },
    },
  },
  required: ["text"],
  additionalProperties: false,
};
/** Anything that reads as a link, which a Notice or Briefing may not carry (ADR-0014). */
const link = /\b(?:https?:\/\/|www\.|mailto:)/i;

/** What the model is told of each Capability's tool; how the tool reads its call follows from the Capability's Action. */
const descriptions: Record<CapabilityId, string> = {
  createStudyBlocks: `Creates a Study Block for an Obligation or Task the Plan showed. Name the work by its handle, such as O1 or T1, and ${when}.`,
  moveOwnStudyBlocks: `Moves a Study Block you created that the student has not moved since. Name it by its handle, such as B1, and ${when}.`,
  moveStudyBlocks: `Moves any Study Block the Plan showed, also one the student or someone else placed; the student is always asked first. Name it by its handle, such as B1, and ${when}.`,
  removeOwnStudyBlocks:
    "Removes a Study Block you created that the student has not moved since. Name it by its handle, such as B1. A Locked block, or one that has started, cannot be removed.",
  createFlashcards: `Starts making flashcards on Topics of your Courses, which the student finds under Study once made. ${artifactCap}`,
  createPracticeSets: `Starts making a practice set on Topics of your Courses, which the student finds under Study once made. ${artifactCap}`,
  notifyStudent: `Writes the student a short Notice in their Inbox, shown as yours: plain text of at most ${maxNotice} characters, with no links or formatting. Only one may be sent per Run, so send it only when something needs the student's attention, and say all of it at once.`,
  createBriefing: `Writes the student a Briefing in their Inbox bundling open Inbox items: plain text of at most ${maxBriefing} characters, with no links or formatting, plus the handles (I1, A1, N1, R1) from inbox of the open items you are bundling. Read the Inbox with inbox first. Only write a Briefing when at least one open item is bundled; at most one may be written per Run.`,
  createTasks:
    "Creates a Task in one of your Courses. Name exactly one of: a Course by its handle, such as K1; an Obligation the Plan showed, such as O1, which the Task works toward; or a Course Event the Plan showed, such as E1, with role preparation or follow_up, only if it has no Task in that role yet. Give a short title and, if you can tell, the minutes it needs. Read the Plan with agenda first, so you add no Task it already has.",
};

/**
 * The Agent's Capability tools: exactly its Capabilities, one tool each, named by the Capability (ADR-0026). None has
 * an `execute`: the step hands its calls back, and they are performed after it, under `runId:step:call`, an Action's
 * through the gate, a Lernmaterial one's by starting its Artifact Run, Dich benachrichtigen's by sending a Notice, and
 * Briefing erstellen's by writing a Briefing.
 */
export function capabilityTools(held: readonly CapabilityId[]): ToolSet {
  return Object.fromEntries(
    held.map((id) => {
      const capability = capabilities[id];
      return [
        id,
        tool({
          description: descriptions[id],
          inputSchema: jsonSchema(
            "kind" in capability
              ? inputs[capability.kind]!
              : "artifact" in capability
                ? artifactInput
                : "briefing" in capability
                  ? briefingInput
                  : noticeInput,
          ),
        }),
      ];
    }),
  );
}

/** The kind of Artifact a Lernmaterial Capability starts. */
export type ArtifactKind = "flashcards" | "practice_set";
/**
 * A Notice's or Briefing's text as its call is stored: sealed under every Source the Run had read, as base64, so the
 * model's words are never kept in the clear.
 */
export type SealedNotice = {
  content: string;
  contentKey: string | null;
  derivedFrom: string[];
};
/** A Briefing as its call is stored: its sealed text and the Inbox item IDs it bundles. */
export type SealedBriefing = {
  text: SealedNotice;
  items: {
    interventions: string[];
    approvals: string[];
    notices: string[];
    artifacts: string[];
  };
};
/**
 * One Capability call of a step as stored: the Action the gate performs, the Artifact Run it starts, the Notice it
 * sends, the Briefing it writes, or why none could be. Dates as ISO strings.
 */
export type StoredCall = {
  toolCallId: string;
  toolName: string;
} & (
  | { intent: Record<string, unknown> }
  | { artifact: { kind: ArtifactKind; topicIds: string[] } }
  | { notice: SealedNotice }
  | { briefing: SealedBriefing }
  | { invalid: string }
);
/** A call as read, before it is stored: a Notice's or Briefing's text is still plain until it is sealed with the step. */
export type ReadCall =
  | StoredCall
  | { toolCallId: string; toolName: string; noticeText: string }
  | {
      toolCallId: string;
      toolName: string;
      briefingDraft: {
        text: string;
        items: {
          interventions: string[];
          approvals: string[];
          notices: string[];
          artifacts: string[];
        };
      };
    };

/** Whether a call was to a Capability of this sort, valid or not. */
const callTo = (call: StoredCall, sort: "artifact" | "notice" | "briefing") =>
  sort in call ||
  ("invalid" in call &&
    Object.hasOwn(capabilities, call.toolName) &&
    sort in capabilities[call.toolName as CapabilityId]);
/** Whether a call was to a Lernmaterial Capability, which starts an Artifact Run instead of asking the gate. */
export const startsArtifact = (call: StoredCall) => callTo(call, "artifact");
/** Whether a call was to Dich benachrichtigen, which sends a Notice instead of asking the gate. */
export const sendsNotice = (call: StoredCall) => callTo(call, "notice");
/** Whether a call was to Briefing erstellen, which writes a Briefing instead of asking the gate. */
export const writesBriefing = (call: StoredCall) => callTo(call, "briefing");

/** A stored intent with its dates revived, as the gate takes it; a Task Action has none. */
export const intentOf = (call: { intent: Record<string, unknown> }) => {
  const { start, end } = call.intent;
  return {
    ...call.intent,
    ...(start === undefined ? {} : { start: new Date(start as string) }),
    ...(end === undefined ? {} : { end: new Date(end as string) }),
  } as ActionIntent;
};

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
    reader,
    p,
    timeZone,
    courses,
  }: {
    plan: Pick<Plan, "view">;
    reader: Pick<KnowledgeReader, "retrieve">;
    p: Principal;
    timeZone: string;
    /** The Agent's Courses by handle, as the context message lists them. */
    courses: ReadonlyMap<string, { id: string }>;
  },
  call: { toolCallId: string; toolName: string; input: unknown },
): Promise<ReadCall> {
  const { toolCallId, toolName } = call;
  const invalid = (reason: string): StoredCall => ({
    toolCallId,
    toolName,
    invalid: reason,
  });
  if (!Object.hasOwn(capabilities, toolName))
    return invalid("you have no such tool.");
  const capability = capabilities[toolName as CapabilityId];
  // The model's arguments are checked here, never trusted: a malformed call asks for nothing.
  const given =
    call.input && typeof call.input === "object"
      ? (call.input as Record<string, unknown>)
      : {};
  if ("notice" in capability) {
    const { text } = given;
    if (typeof text !== "string" || !text.trim())
      return invalid("give the Notice's text.");
    if (text.trim().length > maxNotice)
      return invalid(`write at most ${maxNotice} characters.`);
    if (link.test(text))
      return invalid(
        "write plain text with no links: the student is never sent anywhere from a Notice.",
      );
    return { toolCallId, toolName, noticeText: text.trim() };
  }
  if ("briefing" in capability) {
    const { text } = given;
    if (typeof text !== "string" || !text.trim())
      return invalid("give the Briefing's text.");
    if (text.trim().length > maxBriefing)
      return invalid(`write at most ${maxBriefing} characters.`);
    if (link.test(text))
      return invalid(
        "write plain text with no links: the student is never sent anywhere from a Briefing.",
      );
    const resolve = (
      field: string,
      kind: "intervention" | "approval" | "notice" | "artifact",
    ): string[] | StoredCall => {
      const value = given[field];
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string"))
        return invalid(`give ${field} as a list of handles from inbox.`);
      const ids: string[] = [];
      for (const handle of value as string[]) {
        const found = turn.lookup(handle);
        if (found?.kind !== kind)
          return invalid(
            `no ${kind} has the handle ${handle}. Read the Inbox with inbox first.`,
          );
        ids.push(found.id);
      }
      return [...new Set(ids)];
    };
    const interventions = resolve("interventions", "intervention");
    if (!Array.isArray(interventions)) return interventions;
    const approvals = resolve("approvals", "approval");
    if (!Array.isArray(approvals)) return approvals;
    const notices = resolve("notices", "notice");
    if (!Array.isArray(notices)) return notices;
    const artifacts = resolve("artifacts", "artifact");
    if (!Array.isArray(artifacts)) return artifacts;
    return {
      toolCallId,
      toolName,
      briefingDraft: {
        text: text.trim(),
        items: { interventions, approvals, notices, artifacts },
      },
    };
  }
  if ("artifact" in capability)
    return readArtifact(
      turn,
      { reader, p, courses },
      { toolCallId, toolName, kind: capability.artifact },
      given,
    );
  const { kind } = capability;
  const intent = (value: object): StoredCall => ({
    toolCallId,
    toolName,
    intent: JSON.parse(JSON.stringify(value)),
  });
  if (kind === "task.create")
    return readTask(turn, { plan, p, courses }, given, { invalid, intent });
  const fields = Object.keys(inputs[kind]!.properties ?? {});
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

/**
 * Reads a call of Aufgaben erstellen into the Task it asks for: in a Course by its handle, toward an Obligation, or as
 * a Course Event's missing Preparation or Follow-up (ADR-0022). Whether that is work of the Agent's Courses is the
 * gate's to decide.
 */
async function readTask(
  turn: Turn,
  {
    plan,
    p,
    courses,
  }: {
    plan: Pick<Plan, "view">;
    p: Principal;
    courses: ReadonlyMap<string, { id: string }>;
  },
  given: Record<string, unknown>,
  {
    invalid,
    intent,
  }: {
    invalid: (reason: string) => StoredCall;
    intent: (value: object) => StoredCall;
  },
): Promise<StoredCall> {
  const { title, course, obligation, event, role, minutes } = given;
  if (typeof title !== "string" || !title.trim() || title.trim().length > 200)
    return invalid("give a title of at most 200 characters.");
  const named = [course, obligation, event].filter((v) => v !== undefined);
  if (named.length !== 1 || typeof named[0] !== "string")
    return invalid("name exactly one Course, Obligation or Course Event.");
  if (
    minutes !== undefined &&
    !(
      Number.isInteger(minutes) &&
      Number(minutes) >= 15 &&
      Number(minutes) <= 1440
    )
  )
    return invalid("give the minutes as a whole number from 15 to 1440.");
  if ((event === undefined) !== (role === undefined))
    return invalid(
      "give a role, preparation or follow_up, with a Course Event, and only then.",
    );
  if (role !== undefined && role !== "preparation" && role !== "follow_up")
    return invalid("give the role as preparation or follow_up.");
  const task = {
    kind: "task.create",
    title: title.trim(),
    courseId: null as string | null,
    fixedEventId: null as string | null,
    role: null as "preparation" | "follow_up" | null,
    estimateMinutes: (minutes as number | undefined) ?? null,
  };
  if (typeof course === "string") {
    const known = courses.get(course);
    if (!known)
      return invalid(`none of your Courses has the handle ${course}.`);
    return intent({ ...task, courseId: known.id });
  }
  if (typeof obligation === "string") {
    const work = turn.lookup(obligation);
    if (work?.kind !== "obligation")
      return invalid(
        `no Obligation has the handle ${obligation}. Read the Plan with agenda first.`,
      );
    return intent({ ...task, obligationId: work.id });
  }
  const handled = turn.lookup(event as string);
  const view = await plan.view(p);
  const found =
    handled?.kind === "event"
      ? view.fixedEvents.find((e) => e.id === handled.id)
      : undefined;
  if (!found?.courseId)
    return invalid(
      `no Course Event has the handle ${event}. Read the Plan with agenda first.`,
    );
  // A Course Event has at most one Task in each role, which a new one would only repeat.
  if (view.tasks.some((t) => t.fixedEventId === found.id && t.role === role))
    return invalid(
      `${event} already has a ${role === "preparation" ? "Preparation" : "Follow-up"}, so add no other.`,
    );
  return intent({
    ...task,
    courseId: found.courseId,
    fixedEventId: found.id,
    role,
  });
}

/**
 * Reads a call of a Lernmaterial Capability into the Artifact Run it starts: on Topics of the Run's Courses, named by
 * the tags courseFacts gave out in this or an earlier step. Whether each is of the Agent's current, unarchived Courses
 * is decided as it starts.
 */
async function readArtifact(
  turn: Turn,
  {
    reader,
    p,
    courses,
  }: {
    reader: Pick<KnowledgeReader, "retrieve">;
    p: Principal;
    courses: ReadonlyMap<string, { id: string }>;
  },
  call: { toolCallId: string; toolName: string; kind: ArtifactKind },
  given: Record<string, unknown>,
): Promise<StoredCall> {
  const { toolCallId, toolName, kind } = call;
  const invalid = (reason: string): StoredCall => ({
    toolCallId,
    toolName,
    invalid: reason,
  });
  const { topics } = given;
  if (
    !Array.isArray(topics) ||
    !topics.length ||
    topics.length > 10 ||
    topics.some((tag) => typeof tag !== "string")
  )
    return invalid("name 1 to 10 Topics by the tags courseFacts gave them.");
  // The Topics of the Agent's Courses as courseFacts reads them, Archived Courses included as knowledge.
  const retrieval = await reader.retrieve(
    p,
    { planning: true },
    {
      kind: "facts",
      types: ["topic"],
      narrow: { courseIds: [...courses.values()].map((course) => course.id) },
    },
  );
  const ofCourses = new Map(
    retrieval.status === "ok"
      ? retrieval.items.flatMap((item) =>
          item.kind === "fact" ? [[item.cite, item.factId] as const] : [],
        )
      : [],
  );
  const topicIds = (topics as string[]).map((tag) => {
    const cite = turn.citations.find((c) => c.tag === tag)?.cite;
    return cite && ofCourses.get(cite);
  });
  if (topicIds.some((id) => !id))
    return invalid(
      "name only Topics of your Courses, by the tags courseFacts gave them. Read them with courseFacts first.",
    );
  return {
    toolCallId,
    toolName,
    artifact: { kind, topicIds: [...new Set(topicIds as string[])] },
  };
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
  past: "it is in the past: the block would start before now, or the Course Event has begun or its window has closed",
  fixed_event: "it overlaps a Fixed Event",
  study_block: "it overlaps another Study Block",
  out_of_scope: "it is not work of your Courses",
  no_capability:
    "you may not do this, such as moving or removing a block you did not create",
  run_cap:
    "this Run has reached its limit of Action calls or of Approvals asked, so make no more such calls",
  run_ended: "this Run has already ended",
  open_approvals_cap:
    "the student has too many of your requests open already, so ask nothing more until they decide",
};

/** Why an Artifact Run was not started, as the model is told. */
const notStarted: Record<string, string> = {
  gone: "a Topic is gone, or no longer of your Courses",
  run_ended: why.run_ended,
  paused: why.paused,
  ended: why.ended,
  no_capability: "the student no longer lets you make these",
  out_of_scope:
    "a Topic is not of your current Courses: you make nothing for a Course that is Archived or no longer yours",
  run_cap:
    "this Run has already started a practice set or flashcards, and only one may start per Run, so make no more such calls",
};

/** What the model is told became of one Lernmaterial call: the Artifact Run it started, or why none was. */
export function artifactResultOf(
  call: StoredCall,
  recorded: {
    kind: ArtifactKind;
    outcome: "started" | "refused";
    refusal: string | null;
  } | null,
): string {
  if ("invalid" in call) return `Refused, nothing was started: ${call.invalid}`;
  if (!recorded) throw new Error(`Call ${call.toolCallId} was never performed`);
  if (recorded.outcome === "started")
    return `Started: the ${recorded.kind === "flashcards" ? "flashcards are" : "practice set is"} being made, and the student finds ${recorded.kind === "flashcards" ? "them" : "it"} under Study once made. Do not start it again.`;
  return `Not started: ${notStarted[recorded.refusal ?? ""] ?? recorded.refusal}.`;
}

/** Why a Notice was not sent, as the model is told. */
const notSent: Record<string, string> = {
  run_ended: why.run_ended,
  paused: why.paused,
  ended: why.ended,
  no_capability: "the student no longer lets you send Notices",
  run_cap:
    "this Run has already sent a Notice, and only one may be sent per Run, so send no more",
};

/** What the model is told became of one call of Dich benachrichtigen: the Notice it sent, or why none was. */
export function noticeResultOf(
  call: StoredCall,
  recorded: { outcome: "sent" | "refused"; refusal: string | null } | null,
): string {
  if ("invalid" in call) return `Refused, nothing was sent: ${call.invalid}`;
  if (!recorded) throw new Error(`Call ${call.toolCallId} was never performed`);
  if (recorded.outcome === "sent")
    return "Sent: the student finds it in their Inbox. Send no other in this Run.";
  return `Not sent: ${notSent[recorded.refusal ?? ""] ?? recorded.refusal}.`;
}

/** Why a Briefing was not written, as the model is told. */
const notWritten: Record<string, string> = {
  run_ended: why.run_ended,
  paused: why.paused,
  ended: why.ended,
  no_capability: "the student no longer lets you write Briefings",
  run_cap:
    "this Run has already written a Briefing, and only one may be written per Run, so write no more",
  nothing_open:
    "nothing open was bundled: bundle at least one open Intervention, pending Approval, unread Notice or ready Artifact from inbox",
};

/** What the model is told became of one call of Briefing erstellen: the Briefing it wrote, or why none was. */
export function briefingResultOf(
  call: StoredCall,
  recorded: { outcome: "written" | "refused"; refusal: string | null } | null,
): string {
  if ("invalid" in call) return `Refused, nothing was written: ${call.invalid}`;
  if (!recorded) throw new Error(`Call ${call.toolCallId} was never performed`);
  if (recorded.outcome === "written")
    return "Written: the student finds the Briefing in their Inbox. Write no other in this Run.";
  return `Not written: ${notWritten[recorded.refusal ?? ""] ?? recorded.refusal}.`;
}

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
      if (action.kind === "task.create") {
        const { taskId } = action.effect as { taskId: string };
        return `Done: the Task was created as ${turn.handleFor("task", taskId)}.`;
      }
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
