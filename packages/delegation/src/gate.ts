import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { CapabilityId } from "./capabilities.js";
import { capabilities } from "./capabilities.js";
import type {
  CapableAgent,
  Decision,
  PlanVerdict,
  Refusal,
  RunUse,
} from "./decision.js";
import { decideAction } from "./decision.js";
import { isHandedIn } from "./handed-in.js";
import type { ActionIntent, Args, Kind, Subject } from "./kinds.js";
import { canonical, definitions, InvalidIntentError } from "./kinds.js";
import type { Principal, Transaction } from "./principal.js";
import { principal as mint, withOwner } from "./principal.js";

/** The same key was used for a different intent. A programmer error: a changed Action needs a new key. */
export class KeyConflictError extends Error {
  override name = "KeyConflictError";
}
/** `decide` answered something other than the open request the student was shown. A programmer error. */
export class StaleApprovalError extends Error {
  override name = "StaleApprovalError";
}
/** An infrastructure fault, or the same Action is being dispatched right now. Safe to retry with the same key. */
/** `decide` named no Action of the student's: never theirs, or gone. */
export class UnknownActionError extends StaleApprovalError {
  override name = "UnknownActionError";
}
export class DelegationUnavailable extends Error {
  override name = "DelegationUnavailable";
}

export interface Clock {
  now(): Date;
}

/**
 * One port per capability. An executor must classify "sent but no answer" as `ambiguous`, and may answer `absent` from
 * `lookup` only when it honours idempotency keys, so a retry with the same key cannot take the effect twice.
 */
export interface Executor {
  execute(
    req: {
      studentId: string;
      actionId: string;
      intent: ActionIntent;
      /**
       * For a move or removal, where the gate saw the block when it decided. The executor takes no effect on a block
       * that is no longer there or is Locked, since the student changed it after the decision.
       */
      block?: { start: Date; end: Date };
    },
    opts: { idempotencyKey: string; signal: AbortSignal },
  ): Promise<
    | { status: "done"; effect: unknown }
    | { status: "rejected"; detail: string }
    | { status: "ambiguous" }
  >;
  lookup(
    idempotencyKey: string,
    req: { studentId: string },
  ): Promise<
    | { status: "found"; effect: unknown }
    | { status: "absent" }
    | { status: "unknown" }
  >;
}
/** The pilot's one capability: Study Blocks within nunio's Plan. */
export interface Executors {
  plan: Executor;
}

/** An Action on a Study Block. */
export type BlockIntent = Extract<
  ActionIntent,
  { kind: "studyBlock.create" | "studyBlock.move" | "studyBlock.remove" }
>;
/**
 * The Plan's rules for a Study Block Action, as `plan.check` applies them to a Chat's proposals, read in the gate's
 * transaction. A port, because `delegation` never imports `planning`.
 */
export interface PlanRules {
  check(tx: Transaction, intent: BlockIntent, now: Date): Promise<PlanVerdict>;
  /**
   * When a Course Event's new Preparation or Follow-up would be due: the end of its window (ADR-0022); null for any
   * other Task, or once the event is gone.
   */
  taskDue(
    tx: Transaction,
    task: {
      fixedEventId: string | null;
      role: "preparation" | "follow_up" | null;
    },
  ): Promise<Date | null>;
}

export type ActionOutcome =
  | { status: "done"; actionId: string; effect: unknown }
  | {
      status: "awaiting_approval";
      actionId: string;
      fingerprint: string;
      expiresAt: Date;
    }
  | { status: "refused"; actionId: string; reason: Refusal }
  | { status: "failed"; actionId: string; detail: string }
  | { status: "unconfirmed"; actionId: string };

export type Approve = {
  kind: "approve";
  actionId: string;
  fingerprint: string;
};
export type Deny = { kind: "deny"; actionId: string };
export type Resolve = {
  kind: "resolve";
  actionId: string;
  resolution: "happened" | "did_not_happen";
};

export interface ActionRecord {
  id: string;
  /** The key it was asked under, so a Chat Action can be performed again once approved. */
  key: string;
  runId: string | null;
  /** The Agent whose Run asked; null for a Chat. */
  agentId: string | null;
  kind: Kind;
  args: unknown;
  /** `kind` and `args` as `perform` takes them. */
  intent: ActionIntent;
  status:
    | "awaiting_approval"
    | "dispatching"
    | "done"
    | "failed"
    | "refused"
    | "unconfirmed";
  refusal: Refusal | null;
  /** The authority it was dispatched on. */
  authority: { grantId: string } | { approvalId: string } | null;
  approval: {
    id: string;
    fingerprint: string;
    expiresAt: Date;
    decision: "approved" | "denied" | null;
  } | null;
  events: { at: Date; type: string; detail: unknown }[];
}
/** An Action whose Approval is still open at `at`: unanswered, not withdrawn and not yet expired, which no timer marks. */
export const openApprovalAt = (at: Date) => ({
  status: "awaiting_approval" as const,
  approval: { is: { decision: null, expiresAt: { gt: at } } },
});

/**
 * Withdraws every open Approval of an Agent's Runs for good, as Pausing or Ending it does (ADR-0006): each Action is
 * refused as `approval_withdrawn` at `at`, so the student can no longer approve it, it stops counting as open, and the
 * Agent's next Run reads what became of it. Each Action is locked as deciding locks it and read again, so one the student answered meanwhile keeps its answer.
 * Called under the Agent's lock, which performing takes before an Action's, so the two never deadlock (#226).
 */
export async function withdrawApprovals(
  tx: Transaction,
  { studentId, agentId }: { studentId: string; agentId: string },
  at: Date,
) {
  const where = {
    ...openApprovalAt(at),
    run: { agentId },
  };
  const found = (await tx.action.findMany({ where, select: { id: true } })).map(
    (a) => a.id,
  );
  if (!found.length) return;
  await tx.$executeRaw`SELECT 1 FROM "action" WHERE "id" = ANY(${found}) FOR UPDATE`;
  const ids = (
    await tx.action.findMany({
      where: { ...where, id: { in: found } },
      select: { id: true },
    })
  ).map((a) => a.id);
  if (!ids.length) return;
  await tx.action.updateMany({
    where: { id: { in: ids } },
    data: { status: "refused", refusal: "approval_withdrawn" },
  });
  await tx.actionEvent.createMany({
    data: ids.map((actionId) => ({
      studentId,
      actionId,
      at,
      type: "refused",
      detail: { reason: "approval_withdrawn" },
    })),
  });
}

export interface HistoryQuery {
  /** These Actions only, whatever their status. */
  ids?: string[];
  /** The Actions asked under these keys, such as a Chat answer's `chatId:messageId:n`. */
  keys?: string[];
  runId?: string;
  agentId?: string;
  status?: ActionRecord["status"];
  limit?: number;
}

export interface GateDeps {
  db: PrismaClient;
  clock: Clock;
  executors?: Executors;
  /** Needed only to decide a free-text Agent's Study Block and Task Actions. */
  planRules?: PlanRules;
  /** An Obligation's deadline, which caps how long a request for Approval stays open. */
  deadlineOf?: (
    studentId: string,
    obligationId: string,
  ) => Promise<Date | null>;
}

const approvalMs = 7 * 24 * 60 * 60_000;
/** An in-flight Attempt older than this is recovered through the executor's lookup. */
const staleMs = 5 * 60_000;
const executeTimeoutMs = 60_000;

type Job = {
  studentId: string;
  actionId: string;
  attemptId: string;
  idempotencyKey: string;
  intent: ActionIntent;
  block?: { start: Date; end: Date };
};
type Row = NonNullable<Awaited<ReturnType<typeof findAction>>>;
const include = {
  approval: true,
  run: { select: { agentId: true, status: true } },
  attempts: { orderBy: { startedAt: "asc" } },
  events: { orderBy: { at: "asc" } },
} as const;
const findAction = (
  tx: Transaction,
  where: { id: string } | { studentId_key: { studentId: string; key: string } },
) => tx.action.findUnique({ where, include });

/** Arguments as stored: JSON, with dates as ISO strings. */
const stored = (args: unknown) =>
  JSON.parse(JSON.stringify(args)) as Record<string, unknown>;
function revive(kind: string, json: unknown): ActionIntent {
  const { start, end, ...rest } = json as Record<string, unknown>;
  return {
    kind,
    ...definitions[kind as Kind].parse({
      ...rest,
      // Only Study Block Actions have a time span; a Task Action has none (ADR-0022).
      ...(start === undefined ? {} : { start: new Date(start as string) }),
      ...(end === undefined ? {} : { end: new Date(end as string) }),
    }),
  } as ActionIntent;
}

function outcomeOf(a: Row): ActionOutcome {
  switch (a.status) {
    case "done":
      return { status: "done", actionId: a.id, effect: a.effect };
    case "awaiting_approval":
      return {
        status: "awaiting_approval",
        actionId: a.id,
        fingerprint: a.approval!.fingerprint,
        expiresAt: a.approval!.expiresAt,
      };
    case "refused":
      return {
        status: "refused",
        actionId: a.id,
        reason: a.refusal as Refusal,
      };
    case "failed":
      return { status: "failed", actionId: a.id, detail: a.failure ?? "" };
    case "unconfirmed":
      return { status: "unconfirmed", actionId: a.id };
    case "dispatching":
      throw new DelegationUnavailable(`Action ${a.id} is being dispatched`);
  }
}

function recordOf(a: Row): ActionRecord {
  return {
    id: a.id,
    key: a.key,
    runId: a.runId,
    agentId: a.run?.agentId ?? null,
    kind: a.kind as Kind,
    args: a.args,
    intent: revive(a.kind, a.args),
    status: a.status,
    refusal: a.refusal as Refusal | null,
    authority: a.grantId
      ? { grantId: a.grantId }
      : a.approvalId
        ? { approvalId: a.approvalId }
        : null,
    approval: a.approval && {
      id: a.approval.id,
      fingerprint: a.approval.fingerprint,
      expiresAt: a.approval.expiresAt,
      decision: a.approval.decision as "approved" | "denied" | null,
    },
    events: a.events.map(({ at, type, detail }) => ({ at, type, detail })),
  };
}

/** The UTC offset of a time zone at an instant, in milliseconds. */
function offsetMs(ms: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(ms)
      .map((part) => [part.type, part.value]),
  );
  return (
    Date.UTC(
      +parts.year!,
      +parts.month! - 1,
      +parts.day!,
      +parts.hour!,
      +parts.minute!,
      +parts.second!,
    ) - ms
  );
}
/** The instant of a local minute on a local day (given as UTC midnight of that date). */
function localInstant(dayUtc: number, minute: number, timeZone: string) {
  const wall = dayUtc + minute * 60_000;
  const guess = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(guess, timeZone);
}

/** Whether an interval touches the student's Protected Time, weekly or one-off, on their local days. */
async function intoProtectedTime(
  tx: Transaction,
  args: { start?: Date; end?: Date },
) {
  // A Task Action places nothing in time.
  const { start, end } = args;
  if (!start || !end) return false;
  const timeZone =
    (await tx.planPreference.findFirst())?.timeZone ?? "Europe/Berlin";
  const from = start.getTime(),
    to = end.getTime();
  const day = 24 * 60 * 60_000;
  for (const span of await tx.protectedTime.findMany()) {
    if (span.start && span.end) {
      if (span.start.getTime() < to && from < span.end.getTime()) return true;
      continue;
    }
    // Every local day the interval could fall on, padded by a day for the time zone's offset.
    for (let d = Math.floor(from / day) * day - day; d <= to + day; d += day) {
      if ((new Date(d).getUTCDay() || 7) !== span.weekday) continue;
      if (
        localInstant(d, span.fromMinute!, timeZone) < to &&
        from < localInstant(d, span.toMinute!, timeZone)
      )
        return true;
    }
  }
  return false;
}

/** The work or block an Action is for, as the student's own rows show it; null when it is not theirs. */
async function subjectOf(
  tx: Transaction,
  intent: ActionIntent,
): Promise<Subject | null> {
  // An Obligation the student Rejected or reported as handed in is no work any more, as the Plan treats it, so no new
  // Task or Study Block counts toward it and none is moved for it; a leftover block may still be removed.
  const closed = (
    obligation: { state: string } & Parameters<typeof isHandedIn>[0],
  ) => obligation.state === "rejected" || isHandedIn(obligation);
  /** The work, directly or through its Task; with `open`, null once its Obligation is closed. */
  const workOf = async (
    ref: { obligationId: string | null; taskId: string | null },
    { open = false } = {},
  ) => {
    const task = ref.taskId
      ? await tx.task.findUnique({ where: { id: ref.taskId } })
      : null;
    const obligationId = ref.obligationId ?? task?.obligationId ?? null;
    const obligation = obligationId
      ? await tx.obligation.findUnique({ where: { id: obligationId } })
      : null;
    if (open && obligation && closed(obligation)) return null;
    // A Task toward no Obligation may still be in a Course of its own (ADR-0022).
    return {
      courseId: obligation?.courseId ?? task?.courseId ?? null,
      obligationId,
    };
  };
  if (intent.kind === "studyBlock.create") {
    if (await tx.obligation.findUnique({ where: { id: intent.workId } }))
      return workOf(
        { obligationId: intent.workId, taskId: null },
        { open: true },
      );
    if (await tx.task.findUnique({ where: { id: intent.workId } }))
      return workOf(
        { obligationId: null, taskId: intent.workId },
        { open: true },
      );
    return null;
  }
  if (intent.kind === "task.create") {
    // Its Obligation, Course and Course Event must be the student's own, and the Obligation still open.
    if (intent.obligationId) {
      const obligation = await tx.obligation.findUnique({
        where: { id: intent.obligationId },
      });
      if (!obligation || closed(obligation)) return null;
      return { courseId: obligation.courseId, obligationId: obligation.id };
    }
    if (
      intent.courseId &&
      !(await tx.course.findUnique({ where: { id: intent.courseId } }))
    )
      return null;
    if (!intent.fixedEventId)
      return { courseId: intent.courseId, obligationId: null };
    const event = await tx.fixedEvent.findUnique({
      where: { id: intent.fixedEventId },
      include: { series: true },
    });
    if (!event) return null;
    // A Preparation or Follow-up is in the Course its event is a Course Event of: none once the event left it.
    const ofEvent =
      event.series?.confirmedAt && !event.detachedAt
        ? event.series.courseId
        : null;
    return {
      courseId: ofEvent === intent.courseId ? ofEvent : null,
      obligationId: null,
    };
  }
  if (intent.kind === "task.reopen") {
    const task = await tx.task.findUnique({ where: { id: intent.taskId } });
    if (!task) return null;
    const work = await workOf({ obligationId: null, taskId: task.id });
    return work && { ...work, title: task.title };
  }
  const block = await tx.studyBlock.findUnique({
    where: { id: intent.studyBlockId },
  });
  if (!block) return null;
  // Removing a leftover block of closed work only does less, so only moving one is refused.
  const work = await workOf(block, {
    open: intent.kind !== "studyBlock.remove",
  });
  if (!work) return null;
  return {
    ...work,
    start: block.start,
    end: block.end,
    placedBy: block.placedBy,
    createdBy: block.createdByAgentId,
    locked: Boolean(block.lockedAt),
  };
}

/** The Run's Agent as the gate decides by it: its Capabilities, Grants and Courses. */
async function agentOf(
  tx: Transaction,
  agentId: string,
): Promise<CapableAgent> {
  const current = await tx.agent.findUniqueOrThrow({
    where: { id: agentId },
    include: {
      grants: true,
      capabilities: true,
      courses: { include: { course: true } },
    },
  });
  return {
    id: current.id,
    state: current.state,
    // A Capability no longer in code, or one that is no Action, authorises nothing.
    capabilities: current.capabilities.flatMap(({ capability, mode }) =>
      Object.hasOwn(capabilities, capability) && mode
        ? [{ id: capability as CapabilityId, mode }]
        : [],
    ),
    grants: current.grants.map((g) => ({ id: g.id, kind: g.kind as Kind })),
    courseIds: current.courses
      .filter(
        ({ course }) => course.status === "accepted" && !course.archivedAt,
      )
      .map(({ courseId }) => courseId),
  };
}

const isBlock = (intent: ActionIntent): intent is BlockIntent =>
  intent.kind === "studyBlock.create" ||
  intent.kind === "studyBlock.move" ||
  intent.kind === "studyBlock.remove";

export function createGate({
  db,
  clock,
  executors,
  planRules,
  deadlineOf,
}: GateDeps) {
  const event = (
    tx: Transaction,
    studentId: string,
    actionId: string,
    type: string,
    detail: object = {},
  ) =>
    tx.actionEvent.create({
      data: {
        studentId,
        actionId,
        at: clock.now(),
        type,
        detail: stored(detail) as object,
      },
    });

  /** Records the executor's answer for one Attempt, in one transaction. */
  async function settle(
    studentId: string,
    actionId: string,
    attemptId: string,
    result:
      | { status: "done"; effect: unknown }
      | { status: "rejected"; detail: string }
      | { status: "ambiguous" },
  ) {
    return withOwner(db, mint.fromSession({ studentId }), async (tx) => {
      const at = clock.now();
      // The Action row first: perform locks it to read the Action and its Attempts consistently.
      if (result.status === "done") {
        await tx.action.update({
          where: { id: actionId },
          data: {
            status: "done",
            effect: stored({ effect: result.effect }).effect as object,
          },
        });
        await tx.attempt.update({
          where: { id: attemptId },
          data: { status: "done", finishedAt: at },
        });
        await event(tx, studentId, actionId, "done", { attemptId });
      } else if (result.status === "rejected") {
        await tx.action.update({
          where: { id: actionId },
          data: { status: "failed", failure: result.detail },
        });
        await tx.attempt.update({
          where: { id: attemptId },
          data: { status: "failed", finishedAt: at },
        });
        await event(tx, studentId, actionId, "failed", {
          attemptId,
          detail: result.detail,
        });
      } else {
        await tx.action.update({
          where: { id: actionId },
          data: { status: "unconfirmed" },
        });
        await tx.attempt.update({
          where: { id: attemptId },
          data: { status: "unconfirmed", finishedAt: at },
        });
        await event(tx, studentId, actionId, "unconfirmed", { attemptId });
      }
      return outcomeOf((await findAction(tx, { id: actionId }))!);
    });
  }

  /** One executor call outside any transaction. A failure leaves the Attempt in flight for lookup. */
  async function execute(job: Job) {
    if (!executors)
      throw new Error("createDelegation needs executors to perform Actions");
    try {
      return await executors.plan.execute(
        {
          studentId: job.studentId,
          actionId: job.actionId,
          intent: job.intent,
          block: job.block,
        },
        {
          idempotencyKey: job.idempotencyKey,
          signal: AbortSignal.timeout(executeTimeoutMs),
        },
      );
    } catch {
      throw new DelegationUnavailable(
        `Action ${job.actionId} could not be confirmed; retry with the same key`,
      );
    }
  }

  /** A new dispatch gets one lookup and, only if absent, one recovery dispatch. */
  async function dispatch(job: Job): Promise<ActionOutcome> {
    let result: Awaited<ReturnType<Executor["execute"]>>;
    try {
      result = await execute(job);
    } catch (error) {
      if (!(error instanceof DelegationUnavailable)) throw error;
      return recover(job);
    }
    return settle(job.studentId, job.actionId, job.attemptId, result);
  }

  /** Asks the executor what became of an in-flight Attempt: found is done, absent is a retry with the same key, else Unconfirmed. */
  async function recover(job: Job): Promise<ActionOutcome> {
    if (!executors)
      throw new Error("createDelegation needs executors to perform Actions");
    const found = await executors.plan
      .lookup(job.idempotencyKey, { studentId: job.studentId })
      .catch(() => ({ status: "unknown" as const }));
    if (found.status === "found")
      return settle(job.studentId, job.actionId, job.attemptId, {
        status: "done",
        effect: found.effect,
      });
    if (found.status === "absent") {
      // Recovery never enters dispatch again: another failure yields to the caller.
      const result = await execute(job);
      return settle(job.studentId, job.actionId, job.attemptId, result);
    }
    return settle(job.studentId, job.actionId, job.attemptId, {
      status: "ambiguous",
    });
  }

  const inFlight = (a: Row) =>
    a.attempts.find((attempt) => attempt.status === "in_flight")!;
  const jobOf = (a: Row, studentId: string): Job => {
    const attempt = inFlight(a);
    // Where the gate saw the block when it dispatched this Attempt, as recorded then.
    const seen = (
      a.events.find(
        (e) =>
          e.type === "dispatched" &&
          (e.detail as { attemptId?: string }).attemptId === attempt.id,
      )?.detail as { block?: { start: string; end: string } } | undefined
    )?.block;
    return {
      studentId,
      actionId: a.id,
      attemptId: attempt.id,
      idempotencyKey: attempt.idempotencyKey,
      intent: revive(a.kind, a.args),
      ...(seen && {
        block: { start: new Date(seen.start), end: new Date(seen.end) },
      }),
    };
  };

  const gate = {
    async perform(
      p: Principal,
      { key, intent }: { key: string; intent: ActionIntent },
    ): Promise<ActionOutcome> {
      const definition = definitions[intent?.kind as Kind];
      if (!definition)
        throw new InvalidIntentError(
          `Unknown Action kind ${String(intent?.kind)}`,
        );
      const { kind, ...raw } = intent;
      const args = definition.parse(raw) as Args;
      const parsed = { kind, ...args } as ActionIntent;

      const next = await withOwner(db, p, async (tx, studentId) => {
        // Serializes calls with one key, so a repeat waits for the first to commit and then sees its record.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${studentId}:${key}`}))`;
        const run =
          p.kind === "run"
            ? await tx.run.findUnique({
                where: { id: p.runId },
              })
            : null;
        // The Agent before its Action, as pausing, ending, metering and deleting it lock them, so none deadlocks (#226).
        if (run?.agentId)
          await tx.$executeRaw`SELECT 1 FROM "agent" WHERE "id" = ${run.agentId} FOR UPDATE`;
        // Settling writes the Action row first, so this lock keeps the Action and its Attempts read consistently.
        await tx.$executeRaw`SELECT 1 FROM "action" WHERE "studentId" = ${studentId} AND "key" = ${key} FOR UPDATE`;
        const existing = await findAction(tx, {
          studentId_key: { studentId, key },
        });
        if (
          existing &&
          canonical({ kind: existing.kind, args: existing.args }) !==
            canonical({ kind: intent.kind, args: stored(args) })
        ) {
          throw new KeyConflictError(
            `Key ${key} was used for a different Action`,
          );
        }
        if (existing?.status === "dispatching") {
          if (
            clock.now().getTime() - inFlight(existing).startedAt.getTime() <
            staleMs
          ) {
            throw new DelegationUnavailable(
              `Action ${existing.id} is being dispatched`,
            );
          }
          return { recover: jobOf(existing, studentId) } as const;
        }
        if (existing && existing.status !== "awaiting_approval")
          return { outcome: outcomeOf(existing) } as const;

        // Read authority only after the lock, including changes committed while we waited.
        const agent = run?.agentId ? await agentOf(tx, run.agentId) : null;
        const subject = await subjectOf(tx, parsed);
        const now = clock.now();
        let planCheck: PlanVerdict | null = null;
        if (agent && subject && isBlock(parsed)) {
          if (!planRules)
            throw new Error(
              "createDelegation needs planRules to decide an Agent's Study Block Actions",
            );
          planCheck = await planRules.check(tx, parsed, now);
        }
        // When a free-text Agent's new Task would be due, which Automatisch asks for within the next 24 hours.
        let taskDue: Date | null = null;
        if (agent && subject && parsed.kind === "task.create") {
          if (!planRules)
            throw new Error(
              "createDelegation needs planRules to decide an Agent's Task Actions",
            );
          taskDue = parsed.obligationId
            ? ((await deadlineOf?.(studentId, parsed.obligationId)) ?? null)
            : await planRules.taskDue(tx, parsed);
        }
        // Counted under the Agent's lock, for a new call only: an Action already asked was counted when it was.
        const runUse: RunUse | null =
          run && agent && !existing
            ? {
                calls: await tx.action.count({ where: { runId: run.id } }),
                // Its key is `runId:step:call`, so a step's calls share the key up to the call.
                stepCalls: await tx.action.count({
                  where: {
                    runId: run.id,
                    key: { startsWith: key.slice(0, key.lastIndexOf(":") + 1) },
                  },
                }),
                approvals: await tx.approval.count({
                  where: { action: { runId: run.id } },
                }),
                openApprovals: await tx.action.count({
                  where: { ...openApprovalAt(now), run: { agentId: agent.id } },
                }),
                // An Approval it asked is still applied once it ended; only a new call is refused.
                ended: run.status !== null && run.status !== "running",
              }
            : null;
        const fingerprint = subject
          ? (definition.fingerprint as (a: Args, s: Subject) => string)(
              args,
              subject,
            )
          : "";
        const decision: Decision = decideAction({
          intent: { kind: intent.kind, args },
          subject,
          fingerprint,
          now,
          agent,
          // Removing a block places nothing, and a Task Action has no time, so neither enters Protected Time.
          intoProtectedTime:
            intent.kind !== "studyBlock.remove" &&
            (await intoProtectedTime(tx, args as { start?: Date; end?: Date })),
          planCheck,
          taskDue,
          runUse,
          approval: existing?.approval
            ? {
                id: existing.approval.id,
                decision: existing.approval.decision as
                  | "approved"
                  | "denied"
                  | null,
                fingerprint: existing.approval.fingerprint,
                expiresAt: existing.approval.expiresAt,
              }
            : null,
        });
        // Asking keeps the record as it is: an unanswered request stays open with what the student was shown.
        if (existing && decision.outcome === "await_approval")
          return { outcome: outcomeOf(existing) } as const;

        const actionId = existing?.id ?? randomUUID();
        if (!existing) {
          await tx.action.create({
            data: {
              id: actionId,
              studentId,
              runId: run?.id ?? null,
              key,
              kind: intent.kind,
              args: stored(args) as object,
              status:
                decision.outcome === "await_approval"
                  ? "awaiting_approval"
                  : "refused",
            },
          });
          await event(tx, studentId, actionId, "proposed", { fingerprint });
        }
        if (decision.outcome === "refuse") {
          await tx.action.update({
            where: { id: actionId },
            data: { status: "refused", refusal: decision.reason },
          });
          await event(tx, studentId, actionId, "refused", {
            reason: decision.reason,
          });
          return {
            outcome: outcomeOf((await findAction(tx, { id: actionId }))!),
          } as const;
        }
        if (decision.outcome === "await_approval") {
          const obligationId = subject!.obligationId;
          const deadline =
            obligationId && deadlineOf
              ? await deadlineOf(studentId, obligationId)
              : null;
          const expiresAt = new Date(
            Math.min(
              now.getTime() + approvalMs,
              deadline?.getTime() ?? Infinity,
            ),
          );
          await tx.approval.create({
            data: {
              id: randomUUID(),
              studentId,
              actionId,
              fingerprint,
              expiresAt,
            },
          });
          await event(tx, studentId, actionId, "approval_requested", {
            fingerprint,
            expiresAt,
          });
          return {
            outcome: outcomeOf((await findAction(tx, { id: actionId }))!),
          } as const;
        }
        const attemptId = randomUUID(),
          idempotencyKey = `${actionId}:${(existing?.attempts.length ?? 0) + 1}`;
        // The block a move or removal is for, as decided on; the executor acts only if it is still there.
        const block =
          subject && "start" in subject
            ? { start: subject.start, end: subject.end }
            : undefined;
        await tx.action.update({
          where: { id: actionId },
          data: { status: "dispatching", ...decision.authority },
        });
        await tx.attempt.create({
          data: {
            id: attemptId,
            studentId,
            actionId,
            idempotencyKey,
            startedAt: now,
          },
        });
        // A Preference it breaks on Immer erlaubt is noted for the Run's Activity.
        await event(tx, studentId, actionId, "dispatched", {
          ...decision.authority,
          attemptId,
          ...(block && { block }),
          ...(decision.brokenPreferences && {
            brokenPreferences: decision.brokenPreferences,
          }),
        });
        return {
          dispatch: {
            studentId,
            actionId,
            attemptId,
            idempotencyKey,
            intent: parsed,
            block,
          },
        } as const;
      });
      if (next.outcome) return next.outcome;
      if (next.recover) return recover(next.recover);
      return dispatch(next.dispatch!);
    },

    async decide(
      student: Principal,
      d: Approve | Deny | Resolve,
    ): Promise<ActionRecord> {
      if (student.kind !== "student")
        throw new Error("Only the student decides");
      return withOwner(db, student, async (tx, studentId) => {
        await tx.$executeRaw`SELECT 1 FROM "action" WHERE "id" = ${d.actionId} FOR UPDATE`;
        const action = await findAction(tx, { id: d.actionId });
        if (!action) throw new UnknownActionError(`No Action ${d.actionId}`);
        const now = clock.now();
        if (d.kind === "resolve") {
          if (action.status !== "unconfirmed")
            throw new StaleApprovalError(
              `Action ${action.id} is not Unconfirmed`,
            );
          await tx.action.update({
            where: { id: action.id },
            data:
              d.resolution === "happened"
                ? { status: "done" }
                : {
                    status: "failed",
                    failure: "the student reported it did not happen",
                  },
          });
          await event(tx, studentId, action.id, "resolved", {
            resolution: d.resolution,
          });
        } else {
          const approval = action.approval;
          const repeated =
            approval?.decision ===
              (d.kind === "approve" ? "approved" : "denied") &&
            (d.kind === "deny" || approval.fingerprint === d.fingerprint);
          if (repeated) return recordOf(action);
          if (
            action.status !== "awaiting_approval" ||
            !approval ||
            approval.decision
          ) {
            throw new StaleApprovalError(
              `Action ${action.id} awaits no Approval`,
            );
          }
          if (d.kind === "approve" && d.fingerprint !== approval.fingerprint) {
            throw new StaleApprovalError(
              `Action ${action.id} was shown with another fingerprint`,
            );
          }
          // An Agent's Approval expires lazily (ADR-0006), so any late decision is refused; a Chat's late denial is
          // still recorded.
          if (
            now >= approval.expiresAt &&
            (d.kind === "approve" || action.runId !== null)
          ) {
            await tx.action.update({
              where: { id: action.id },
              data: { status: "refused", refusal: "approval_expired" },
            });
            await event(tx, studentId, action.id, "refused", {
              reason: "approval_expired",
            });
          } else {
            const decision = d.kind === "approve" ? "approved" : "denied";
            await tx.approval.update({
              where: { id: approval.id },
              data: { decision, decidedAt: now },
            });
            if (decision === "denied")
              await tx.action.update({
                where: { id: action.id },
                data: { status: "refused", refusal: "approval_denied" },
              });
            await event(tx, studentId, action.id, decision, {
              approvalId: approval.id,
            });
          }
        }
        return recordOf((await findAction(tx, { id: action.id }))!);
      });
    },

    /**
     * Recovers stale dispatches, and performs approved Actions the API never went on to perform; recovery grants no
     * authority to act, and an approved Action goes through `perform`, which rechecks it and refuses it once expired.
     */
    async reconcile(): Promise<number> {
      // Older than this, a dispatch or a decision is no longer in the hands of the call that started it.
      const before = new Date(clock.now().getTime() - staleMs);
      const stale = await db.$queryRaw<
        { actionId: string; studentId: string }[]
      >`
        SELECT * FROM stale_attempts(${before}::timestamp(3))`;
      for (const { actionId, studentId } of stale) {
        const action = await withOwner(
          db,
          mint.fromSession({ studentId }),
          (tx) => findAction(tx, { id: actionId }),
        );
        if (action?.status === "dispatching")
          await recover(jobOf(action, studentId));
      }
      const approved = await db.$queryRaw<
        { actionId: string; studentId: string }[]
      >`
        SELECT * FROM unperformed_approvals(${before}::timestamp(3))`;
      for (const { actionId, studentId } of approved) {
        const student = mint.fromSession({ studentId });
        const action = await withOwner(db, student, (tx) =>
          findAction(tx, { id: actionId }),
        );
        // Performed meanwhile, or gone with its Run.
        if (action?.status !== "awaiting_approval") continue;
        // As the API performs it: a Run's Action as the Run's, so its Agent's state, Courses and Capabilities decide.
        await gate
          .perform(action.runId ? mint.fromRun(action.runId) : student, {
            key: action.key,
            intent: revive(action.kind, action.args),
          })
          .catch((error: unknown) => {
            // An unreachable Plan fails the whole pass, to be retried; an Action that fails otherwise must not hold up
            // the newer ones behind it, and stays to be tried again on the next pass.
            if (error instanceof DelegationUnavailable) throw error;
            console.error(
              JSON.stringify({
                msg: "reconcile could not perform an approved Action",
                actionId,
                error: error instanceof Error ? error.name : typeof error,
              }),
            );
          });
      }
      return stale.length + approved.length;
    },

    async history(
      student: Principal,
      q: HistoryQuery = {},
    ): Promise<ActionRecord[]> {
      if (student.kind !== "student")
        throw new Error("Only the student reads their history");
      const rows = await withOwner(db, student, (tx) =>
        tx.action.findMany({
          where: {
            ...(q.ids && { id: { in: q.ids } }),
            ...(q.keys && { key: { in: q.keys } }),
            ...(q.runId && { runId: q.runId }),
            ...(q.status && { status: q.status }),
            ...(q.agentId && {
              run: { agentId: q.agentId },
            }),
          },
          include,
          orderBy: { createdAt: "desc" },
          take: q.limit ?? 50,
        }),
      );
      return rows.map(recordOf);
    },
  };
  return gate;
}
