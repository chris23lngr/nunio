import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { Decision, Refusal, Restrictions } from "./decision.js";
import { decideAction } from "./decision.js";
import type { ActionIntent, Args, GrantScope, Kind, Subject } from "./kinds.js";
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
    req: { studentId: string; actionId: string; intent: ActionIntent },
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
  /** The Responsibility whose Run asked; null for a Chat. */
  responsibilityId: string | null;
  /** The workflow running that Run, to wake it once the student decides. */
  workflowId: string | null;
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
export interface HistoryQuery {
  /** These Actions only, whatever their status. */
  ids?: string[];
  /** The Actions asked under these keys, such as a Chat answer's `chatId:messageId:n`. */
  keys?: string[];
  runId?: string;
  responsibilityId?: string;
  status?: ActionRecord["status"];
  limit?: number;
}

/** A wake carries no authority; it may be delivered more than once. */
export type DecisionNotifier = (notice: {
  actionId: string;
  workflowId: string;
  runId: string;
}) => Promise<void>;

export interface GateDeps {
  db: PrismaClient;
  clock: Clock;
  executors?: Executors;
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
};
type Row = NonNullable<Awaited<ReturnType<typeof findAction>>>;
const include = {
  approval: true,
  run: { select: { responsibilityId: true, workflowId: true } },
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
  const { start, end, ...rest } = json as Record<string, string>;
  return {
    kind,
    ...definitions[kind as Kind].parse({
      ...rest,
      start: new Date(start!),
      end: new Date(end!),
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
    responsibilityId: a.run?.responsibilityId ?? null,
    workflowId: a.run?.workflowId ?? null,
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
  { start, end }: { start: Date; end: Date },
) {
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
  const workOf = async (ref: {
    obligationId: string | null;
    taskId: string | null;
  }) => {
    const task = ref.taskId
      ? await tx.task.findUnique({ where: { id: ref.taskId } })
      : null;
    const obligationId = ref.obligationId ?? task?.obligationId ?? null;
    const obligation = obligationId
      ? await tx.obligation.findUnique({ where: { id: obligationId } })
      : null;
    return { courseId: obligation?.courseId ?? null, obligationId };
  };
  if (intent.kind === "studyBlock.create") {
    if (await tx.obligation.findUnique({ where: { id: intent.workId } }))
      return workOf({ obligationId: intent.workId, taskId: null });
    if (await tx.task.findUnique({ where: { id: intent.workId } }))
      return workOf({ obligationId: null, taskId: intent.workId });
    return null;
  }
  const block = await tx.studyBlock.findUnique({
    where: { id: intent.studyBlockId },
  });
  if (!block) return null;
  return {
    ...(await workOf(block)),
    start: block.start,
    end: block.end,
    placedBy: block.placedBy,
    locked: Boolean(block.lockedAt),
  };
}

export function createGate({ db, clock, executors, deadlineOf }: GateDeps) {
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
  const jobOf = (a: Row, studentId: string) => {
    const attempt = inFlight(a);
    return {
      studentId,
      actionId: a.id,
      attemptId: attempt.id,
      idempotencyKey: attempt.idempotencyKey,
      intent: revive(a.kind, a.args),
    };
  };

  /** The decision is already durable. Acknowledge its wake only after delivery, never before it. */
  async function notifyDecision(
    p: Principal,
    actionId: string,
    notify: DecisionNotifier,
  ) {
    const action = await withOwner(db, p, (tx) =>
      findAction(tx, { id: actionId }),
    );
    if (
      !action?.approval?.decision ||
      !action.runId ||
      !action.run?.workflowId ||
      action.events.some((e) => e.type === "decision_notified")
    )
      return false;
    await notify({
      actionId,
      runId: action.runId,
      workflowId: action.run.workflowId,
    });
    await withOwner(db, p, (tx, studentId) =>
      event(tx, studentId, actionId, "decision_notified"),
    );
    return true;
  }

  return {
    notifyDecision,
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

        const run =
          p.kind === "run"
            ? await tx.run.findUnique({
                where: { id: p.runId },
              })
            : null;
        if (run?.responsibilityId)
          await tx.$executeRaw`SELECT 1 FROM "responsibility" WHERE "id" = ${run.responsibilityId} FOR UPDATE`;
        // Read authority only after the lock, including changes committed while we waited.
        const current = run?.responsibilityId
          ? await tx.responsibility.findUniqueOrThrow({
              where: { id: run.responsibilityId },
              include: { grants: true },
            })
          : null;
        const responsibility = current
          ? {
              state: current.state,
              grants: current.grants.map((g) => ({
                id: g.id,
                kind: g.kind as Kind,
                scope: (g.courseId
                  ? { courseId: g.courseId }
                  : { obligationId: g.obligationId! }) as GrantScope,
              })),
              restrictions: current.restrictions as Restrictions,
            }
          : null;
        const subject = await subjectOf(tx, parsed);
        const now = clock.now();
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
          responsibility,
          // Removing a block places nothing, so it never enters Protected Time.
          intoProtectedTime:
            intent.kind !== "studyBlock.remove" &&
            (await intoProtectedTime(tx, args)),
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
        await event(tx, studentId, actionId, "dispatched", {
          ...decision.authority,
          attemptId,
        });
        return {
          dispatch: {
            studentId,
            actionId,
            attemptId,
            idempotencyKey,
            intent: parsed,
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
          if (d.kind === "approve" && now >= approval.expiresAt) {
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

    /** Recovers stale dispatches and pending decision wakes; neither recovery grants authority to act. */
    async reconcile(notify?: DecisionNotifier): Promise<number> {
      const stale = await db.$queryRaw<
        { actionId: string; studentId: string }[]
      >`
        SELECT * FROM stale_attempts(${new Date(clock.now().getTime() - staleMs)}::timestamp(3))`;
      for (const { actionId, studentId } of stale) {
        const action = await withOwner(
          db,
          mint.fromSession({ studentId }),
          (tx) => findAction(tx, { id: actionId }),
        );
        if (action?.status === "dispatching")
          await recover(jobOf(action, studentId));
      }
      let notified = 0;
      if (notify) {
        const pending = await db.$queryRaw<
          { actionId: string; studentId: string }[]
        >`SELECT * FROM pending_approval_decisions()`;
        for (const { actionId, studentId } of pending) {
          if (
            await notifyDecision(
              mint.fromSession({ studentId }),
              actionId,
              notify,
            )
          )
            notified++;
        }
      }
      return stale.length + notified;
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
            ...(q.responsibilityId && {
              run: { responsibilityId: q.responsibilityId },
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
}
