import { createHash } from "node:crypto";
import { z } from "zod";

/** A model or UI supplied arguments the kind does not accept. A programmer error: do not retry. */
export class InvalidIntentError extends Error {
  override name = "InvalidIntentError";
}

/** Study Blocks are at most two weeks long, as in the Plan. */
const maxBlockMs = 14 * 24 * 60 * 60_000;
const ordered = ({ start, end }: { start: Date; end: Date }) => end > start && end.getTime() - start.getTime() <= maxBlockMs;
const message = "end must follow start within two weeks";

const schemas = {
  "studyBlock.create": z.strictObject({ workId: z.string().min(1), start: z.date(), end: z.date() }).refine(ordered, message),
  "studyBlock.move": z.strictObject({ studyBlockId: z.string().min(1), start: z.date(), end: z.date() }).refine(ordered, message),
};

/** What the gate re-reads at dispatch about the work an Action is for. */
/** A Task toward no Obligation has no Course. */
export interface WorkSubject { courseId: string | null; obligationId: string | null }
/** ...and about the block a move would change. */
export interface BlockSubject extends WorkSubject { start: Date; end: Date; placedBy: "nunio" | "student"; locked: boolean }
type Subjects = { "studyBlock.create": WorkSubject; "studyBlock.move": BlockSubject };

/** Where a Grant applies: one Course, or one Obligation. */
export type GrantScope = { courseId: string } | { obligationId: string };

const inScope = (scope: GrantScope, work: WorkSubject) =>
  "courseId" in scope ? scope.courseId === work.courseId : scope.obligationId === work.obligationId;
const covers = {
  "studyBlock.create": (scope: GrantScope, _: unknown, work: WorkSubject) => inScope(scope, work),
  // A Rebalance moves a block the student placed or moved only with their Approval.
  "studyBlock.move": (scope: GrantScope, _: unknown, block: BlockSubject) => inScope(scope, block) && block.placedBy === "nunio",
};

const versions = { "studyBlock.create": 1, "studyBlock.move": 1 };
/** What the student is shown beyond the arguments: for a move, where the block is now. */
const shown = {
  "studyBlock.create": () => null,
  "studyBlock.move": ({ start, end }: BlockSubject) => ({ start, end }),
};

/** JSON with sorted keys and ISO dates, so equal Actions always hash alike. */
export function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function definition<K extends keyof typeof schemas>(kind: K) {
  return {
    /** Pure: whether a Grant with this scope lets the Action happen without the student's Approval. */
    grantCovers(scope: GrantScope, args: z.infer<(typeof schemas)[K]>, subject: Subjects[K]): boolean {
      return (covers[kind] as (g: GrantScope, a: unknown, s: Subjects[K]) => boolean)(scope, args, subject);
    },
    /** The hash of kind@version, the canonical arguments, and what was re-read for them; an Approval is bound to it. */
    fingerprint(args: z.infer<(typeof schemas)[K]>, subject: Subjects[K]): string {
      const shownNow = (shown[kind] as (s: Subjects[K]) => unknown)(subject);
      return createHash("sha256").update(canonical({ kind: `${kind}@${versions[kind]}`, args, shown: shownNow })).digest("hex");
    },
    parse(input: unknown): z.infer<(typeof schemas)[K]> {
      const parsed = schemas[kind].safeParse(input);
      if (!parsed.success) throw new InvalidIntentError(`${kind}: ${parsed.error.message}`);
      return parsed.data as z.infer<(typeof schemas)[K]>;
    },
  };
}

/** Each Action kind the gate performs. Adding one changes this module: only vetted kinds can act. */
export const definitions = {
  "studyBlock.create": definition("studyBlock.create"),
  "studyBlock.move": definition("studyBlock.move"),
};

export type Kind = keyof typeof definitions;
/** What a model or UI may supply: no actor, Grant, or Responsibility fields. */
export type ActionIntent = { [K in Kind]: { kind: K } & z.infer<(typeof schemas)[K]> }[Kind];
export type Subject<K extends Kind = Kind> = Subjects[K];
/** The arguments of an intent, without its kind. */
export type Args<K extends Kind = Kind> = z.infer<(typeof schemas)[K]>;
