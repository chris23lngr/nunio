import { createHash } from "node:crypto";
import { z } from "zod";

/** A model or UI supplied arguments the kind does not accept. A programmer error: do not retry. */
export class InvalidIntentError extends Error {
  override name = "InvalidIntentError";
}

/** Study Blocks are at most two weeks long, as in the Plan. */
const maxBlockMs = 14 * 24 * 60 * 60_000;
const ordered = ({ start, end }: { start: Date; end: Date }) =>
  end > start && end.getTime() - start.getTime() <= maxBlockMs;
const message = "end must follow start within two weeks";

const schemas = {
  "studyBlock.create": z
    .strictObject({ workId: z.string().min(1), start: z.date(), end: z.date() })
    .refine(ordered, message),
  "studyBlock.move": z
    .strictObject({
      studyBlockId: z.string().min(1),
      start: z.date(),
      end: z.date(),
    })
    .refine(ordered, message),
  /**
   * A Task in a Course, toward an Obligation, or a Course Event's Preparation or Follow-up (ADR-0022). Toward an
   * Obligation it is in the Obligation's Course and names no Course or event. Only an Agent names an Obligation, and
   * Actions asked before it could have none, so their arguments and fingerprints stay as they were.
   */
  "task.create": z
    .strictObject({
      title: z.string().trim().min(1).max(500),
      courseId: z.string().min(1).nullable(),
      obligationId: z.string().min(1).optional(),
      fixedEventId: z.string().min(1).nullable(),
      role: z.enum(["preparation", "follow_up"]).nullable(),
      estimateMinutes: z.number().int().positive().max(60_000).nullable(),
    })
    .refine(
      (task) => !task.obligationId || (!task.courseId && !task.fixedEventId),
      "a Task toward an Obligation names no Course or Course Event",
    ),
  "task.reopen": z.strictObject({ taskId: z.string().min(1) }),
  // The block as the student was shown it, so a removed one can still be named (ADR-0021).
  "studyBlock.remove": z
    .strictObject({
      studyBlockId: z.string().min(1),
      workId: z.string().min(1),
      start: z.date(),
      end: z.date(),
    })
    .refine(ordered, message),
  /**
   * A call of one write tool of a Connection (#280). Only the Integration, Connection, tool and the pin hash of the
   * definition it was called under are stored in plain; the gate seals `arguments` under the Connection's content key.
   */
  "integration.call": z.strictObject({
    integrationKey: z.string().min(1),
    connectionId: z.string().min(1),
    toolName: z.string().min(1),
    pinHash: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
  }),
};

/** What the gate re-reads at dispatch about the work an Action is for. */
/** A Task toward no Obligation has its own Course, or none. */
export interface WorkSubject {
  courseId: string | null;
  obligationId: string | null;
}
/** ...and about the block a move would change. */
export interface BlockSubject extends WorkSubject {
  start: Date;
  end: Date;
  placedBy: "nunio" | "student";
  /** The Agent whose own block it is: the one that created it, until the student moves it. */
  createdBy: string | null;
  locked: boolean;
}
/** ...and about the Task a reopening would change. */
export interface TaskSubject extends WorkSubject {
  title: string;
}
/** ...and about the Connection and the tool an Integration Action calls, as they stand now. */
export interface IntegrationSubject {
  connection: { state: "connected" | "needs_reconnection" };
  /** The tool's catalog row; null for a tool nunio never classified or that is gone. */
  tool: {
    class: "read" | "write" | "write_always_asked" | "blocked";
    definitionHash: string;
    chatOnly: boolean;
  } | null;
}
type Subjects = {
  "studyBlock.create": WorkSubject;
  "studyBlock.move": BlockSubject;
  "task.create": WorkSubject;
  "task.reopen": TaskSubject;
  "studyBlock.remove": BlockSubject;
  "integration.call": IntegrationSubject;
};

const versions = {
  "studyBlock.create": 1,
  "studyBlock.move": 1,
  "studyBlock.remove": 1,
  "task.create": 1,
  "task.reopen": 1,
};
/** What the student is shown beyond the arguments: for a move or removal, where the block is now; for a reopening, which Task. */
const shown = {
  "studyBlock.create": () => null,
  "studyBlock.move": ({ start, end }: BlockSubject) => ({ start, end }),
  "studyBlock.remove": ({ start, end }: BlockSubject) => ({ start, end }),
  "task.create": () => null,
  "task.reopen": ({ title }: TaskSubject) => ({ title }),
};

/** JSON with sorted keys and ISO dates, so equal Actions always hash alike. */
export function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function definition<K extends keyof typeof versions>(kind: K) {
  return {
    /** The hash of kind@version, the canonical arguments, and what was re-read for them; an Approval is bound to it. */
    fingerprint(
      args: z.infer<(typeof schemas)[K]>,
      subject: Subjects[K],
    ): string {
      const shownNow = (shown[kind] as (s: Subjects[K]) => unknown)(subject);
      return createHash("sha256")
        .update(
          canonical({
            kind: `${kind}@${versions[kind]}`,
            args,
            shown: shownNow,
          }),
        )
        .digest("hex");
    },
    parse(input: unknown): z.infer<(typeof schemas)[K]> {
      const parsed = schemas[kind].safeParse(input);
      if (!parsed.success)
        throw new InvalidIntentError(`${kind}: ${parsed.error.message}`);
      return parsed.data as z.infer<(typeof schemas)[K]>;
    },
  };
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const integrationCall = {
  /**
   * The hash of the Connection, the tool, the pin hash it has now and the canonical tool arguments (#262). An Approval
   * asked against an older definition no longer matches once the tool is re-reviewed under a new pin.
   */
  fingerprint(
    args: z.infer<(typeof schemas)["integration.call"]>,
    subject: IntegrationSubject,
  ): string {
    return sha256(
      canonical({
        connectionId: args.connectionId,
        toolName: args.toolName,
        pinHash: subject.tool?.definitionHash ?? null,
        arguments: args.arguments,
      }),
    );
  },
  parse(input: unknown): z.infer<(typeof schemas)["integration.call"]> {
    const parsed = schemas["integration.call"].safeParse(input);
    if (!parsed.success)
      throw new InvalidIntentError(`integration.call: ${parsed.error.message}`);
    // As JSON, as they are sealed and opened again: what is fingerprinted and hashed is exactly what is performed.
    let toolArguments: Record<string, unknown>;
    try {
      toolArguments = JSON.parse(JSON.stringify(parsed.data.arguments));
    } catch {
      throw new InvalidIntentError("integration.call: arguments are not JSON");
    }
    return { ...parsed.data, arguments: toolArguments };
  },
};

/** Each Action kind the gate performs. Adding one changes this module: only vetted kinds can act. */
export const definitions = {
  "studyBlock.create": definition("studyBlock.create"),
  "studyBlock.move": definition("studyBlock.move"),
  "task.create": definition("task.create"),
  "task.reopen": definition("task.reopen"),
  "studyBlock.remove": definition("studyBlock.remove"),
  "integration.call": integrationCall,
};

export type Kind = keyof typeof definitions;
/** What a model or UI may supply: no actor, Grant, or Agent fields. */
export type ActionIntent = {
  [K in Kind]: { kind: K } & z.infer<(typeof schemas)[K]>;
}[Kind];
export type Subject<K extends Kind = Kind> = Subjects[K];
/** The arguments of an intent, without its kind. */
export type Args<K extends Kind = Kind> = z.infer<(typeof schemas)[K]>;
