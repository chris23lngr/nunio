import type { PrismaClient } from "@nunio/db";
import type {
  BrokenPreference,
  Principal,
  Refusal,
  Transaction,
} from "@nunio/delegation";
import { openApprovalAt, withOwner } from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import type { Facts } from "@nunio/knowledge";
import { createDerivedText } from "@nunio/knowledge";

/** What one model step read: the Plan, its Agent's Approvals, the Facts of these Courses, and these Sources. */
export type ReadEvent = {
  step: number;
  plan: boolean;
  /** It read the Agent's Approvals; absent in events written before that tool existed. */
  approvals?: boolean;
  courseIds: string[];
  sourceIds: string[];
};

/**
 * What became of one Action call: the gate's outcome for the Action it asked for, or a refusal without one when the call
 * named nothing the Run had read (`invalid`). A Preference it broke under Immer erlaubt is noted. The work and times are
 * kept as the call named them, so the entry still reads right once the block is moved or removed.
 */
export type ActionEvent = {
  step: number;
  call: number;
  /** The Capability whose tool the model called. */
  capability: string;
  /** Null when no Action was asked. */
  actionId: string | null;
  /** The Action's kind; null when none was asked. */
  kind: string | null;
  /** The Obligation or Task it was for, by id. */
  workId: string | null;
  /** Where a Study Block was put, or removed from, as ISO times; null for an Action that places nothing in time. */
  start: string | null;
  end: string | null;
  outcome: "done" | "awaiting_approval" | "refused" | "failed" | "unconfirmed";
  refusal: Refusal | "invalid" | null;
  brokenPreferences: BrokenPreference[];
};

/** Adds Activity events to a Run's Verlauf; one already written under its key stays as it was. */
export async function recordEvents(
  tx: Transaction,
  run: { runId: string; studentId: string },
  events: (
    | { key: string; type: "read"; detail: ReadEvent }
    | { key: string; type: "action"; detail: ActionEvent }
  )[],
) {
  if (!events.length) return;
  await tx.runEvent.createMany({
    data: events.map((event) => ({
      ...run,
      key: event.key,
      type: event.type,
      detail: event.detail as object,
    })),
    skipDuplicates: true,
  });
}

/** A Run in an Agent's list: its status, how it started and ended, and how many of its Approvals are still open. */
export type ActivityRun = {
  id: string;
  status: "running" | "done" | "stopped" | "failed";
  trigger: "schedule" | "manual";
  startedAt: Date;
  endedAt: Date | null;
  stopReason: string | null;
  /** Its Approvals still open and unexpired, which make it "Freigabe benötigt". */
  openApprovals: number;
};

/** One entry of a Run's Verlauf, with the Courses and Sources it names looked up now: null once deleted. */
export type VerlaufEntry =
  | { type: "start"; at: Date; trigger: ActivityRun["trigger"] }
  | {
      type: "read";
      at: Date;
      step: number;
      plan: boolean;
      approvals: boolean;
      courses: { id: string; title: string | null }[];
      sources: { id: string; title: string | null }[];
    }
  | {
      type: "action";
      at: Date;
      step: number;
      capability: string;
      /** The Action as the call named it; null when none was asked. */
      action: {
        kind: string;
        /** Its work by its title now; null once deleted. A null title is one that can no longer be read. */
        work: { title: string | null; course: string | null } | null;
        start: Date | null;
        end: Date | null;
      } | null;
      outcome: ActionEvent["outcome"];
      refusal: ActionEvent["refusal"];
      brokenPreferences: BrokenPreference[];
    }
  | {
      type: "approval";
      at: Date;
      /** The Action the Approval was asked for, named as in an `action` entry. */
      action: {
        kind: string;
        work: { title: string | null; course: string | null } | null;
        start: Date | null;
        end: Date | null;
      };
      /**
       * The student's answer, that none came in time (expiry is lazy, so no event marks it, #149), or that it was
       * withdrawn unanswered when the Agent was Paused or Ended.
       */
      decision: "approved" | "denied" | "expired" | "withdrawn";
      /** For an approved one, what the gate made of it then; `pending` while it is being performed. Null otherwise. */
      outcome: "done" | "refused" | "failed" | "unconfirmed" | "pending" | null;
      /** Why the gate refused the approved Action, such as out_of_scope or approval_mismatch. */
      refusal: Refusal | null;
    }
  | {
      type: "end";
      at: Date;
      status: Exclude<ActivityRun["status"], "running">;
      reason: string | null;
    };

export type ActivityCursor = { startedAt: Date; id: string };

/**
 * An Agent's Activity as the student reads it (#149): its Runs newest first, and each Run's cost, summary and Verlauf.
 * The Verlauf is built from structured events and the Run's own record, never from what the model wrote.
 */
export function createActivity({
  db,
  keys,
  facts,
  clock,
}: {
  db: PrismaClient;
  keys: SourceKeys;
  /** Obligations' titles as the student reviews them, Archived Courses included. */
  facts: Pick<Facts, "review">;
  clock: { now(): Date };
}) {
  const derived = createDerivedText(keys);
  const openApprovals = async (tx: Transaction, runIds: string[]) => {
    const open = await tx.action.findMany({
      where: { ...openApprovalAt(clock.now()), runId: { in: runIds } },
      select: { runId: true },
    });
    return (runId: string) =>
      open.filter((action) => action.runId === runId).length;
  };
  const shown = (
    run: {
      id: string;
      status: string | null;
      trigger: string | null;
      startedAt: Date;
      endedAt: Date | null;
      stopReason: string | null;
    },
    open: (runId: string) => number,
  ): ActivityRun => ({
    id: run.id,
    status: run.status as ActivityRun["status"],
    trigger: run.trigger as ActivityRun["trigger"],
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    stopReason: run.stopReason,
    openApprovals: open(run.id),
  });
  return {
    /** The Agent's Runs, newest first, `limit` at a time; null when the Agent is not the student's. */
    async runs(
      p: Principal,
      agentId: string,
      page: { limit: number; cursor?: ActivityCursor },
    ) {
      const after = page.cursor;
      return withOwner(db, p, async (tx) => {
        if (!(await tx.agent.findUnique({ where: { id: agentId } })))
          return null;
        const runs = await tx.run.findMany({
          // A preset's Runs record no status; they are not part of Activity.
          where: {
            agentId,
            status: { not: null },
            ...(after && {
              OR: [
                { startedAt: { lt: after.startedAt } },
                { startedAt: after.startedAt, id: { lt: after.id } },
              ],
            }),
          },
          orderBy: [{ startedAt: "desc" }, { id: "desc" }],
          take: page.limit + 1,
        });
        const listed = runs.slice(0, page.limit);
        const open = await openApprovals(
          tx,
          listed.map((run) => run.id),
        );
        const last = listed.at(-1);
        return {
          runs: listed.map((run) => shown(run, open)),
          nextCursor:
            runs.length > page.limit && last
              ? { startedAt: last.startedAt, id: last.id }
              : null,
        };
      });
    },

    /**
     * One of the Agent's Runs: its cost (settled usage plus what its calls in flight hold) against the Agent's Budget,
     * its summary, and its Verlauf. The summary is null without a final message, and `summaryGone` once a Source it
     * was drawn from is deleted. Courses, Sources and work are named as they are now, Archived ones included, and
     * null only once deleted. Null when the Run is not the student's.
     */
    async run(p: Principal, agentId: string, runId: string) {
      const read = await withOwner(db, p, async (tx) => {
        const run = await tx.run.findUnique({
          where: { id: runId },
          include: {
            agent: { select: { budgetMicroUsd: true } },
            events: { orderBy: { id: "asc" } },
          },
        });
        if (!run?.status || run.agentId !== agentId || !run.agent) return null;
        const reservations = await tx.usageReservation.findMany({
          where: { runId },
          select: {
            status: true,
            estimateMicroUsd: true,
            actualMicroUsd: true,
          },
        });
        const cost = reservations.reduce(
          (sum, r) =>
            sum +
            (r.status === "settled"
              ? (r.actualMicroUsd ?? 0n)
              : r.status === "released"
                ? 0n
                : r.estimateMicroUsd),
          0n,
        );
        const summary = run.summaryContent
          ? await derived.open(tx, `${runId}:summary`, {
              content: run.summaryContent,
              contentKey: run.summaryKey,
              derivedFrom: run.derivedFrom,
            })
          : null;
        const reads = run.events
          .filter((event) => event.type === "read")
          .map((event) => event.detail as ReadEvent);
        // Its Approvals as they stand: decided, expired, or still open.
        const approvals = await tx.approval.findMany({
          where: { action: { runId } },
          select: {
            decision: true,
            decidedAt: true,
            expiresAt: true,
            action: {
              select: {
                id: true,
                kind: true,
                args: true,
                status: true,
                refusal: true,
                // A withdrawal is dated only by its refusal's event.
                events: {
                  where: { type: "refused" },
                  select: { at: true },
                  take: 1,
                },
              },
            },
          },
        });
        const calls = run.events
          .filter((event) => event.type === "action")
          .map((event) => event.detail as ActionEvent);
        // A move names only its block, so its work is the one its call named when it was asked.
        const workOfAction = (action: { id: string; args: unknown }) =>
          (action.args as { workId?: string }).workId ??
          calls.find((call) => call.actionId === action.id)?.workId ??
          null;
        const workIds = [
          ...calls.flatMap((call) => (call.workId ? [call.workId] : [])),
          ...approvals.flatMap(({ action }) => {
            const workId = workOfAction(action);
            return workId ? [workId] : [];
          }),
        ];
        const [sources, obligations, tasks] = await Promise.all([
          tx.source.findMany({
            where: {
              id: { in: reads.flatMap((read) => read.sourceIds) },
              deletedAt: null,
            },
            select: { id: true, title: true },
          }),
          tx.obligation.findMany({
            where: { id: { in: workIds } },
            select: { id: true, courseId: true },
          }),
          tx.task.findMany({
            where: { id: { in: workIds } },
            select: {
              id: true,
              title: true,
              courseId: true,
              obligationId: true,
            },
          }),
        ]);
        const courses = await tx.course.findMany({
          where: {
            id: {
              in: [
                ...reads.flatMap((read) => read.courseIds),
                ...obligations.map((o) => o.courseId),
                ...tasks.flatMap((t) => (t.courseId ? [t.courseId] : [])),
              ],
            },
          },
          select: { id: true, title: true },
        });
        return {
          run,
          cost,
          summary,
          approvals,
          workOfAction,
          open: await openApprovals(tx, [runId]),
          sources,
          obligations,
          tasks,
          courses,
        };
      });
      if (!read) return null;
      const { run, sources, obligations, tasks, courses } = read;
      // An Obligation's title is read the way the student reviews it.
      const reviewed = obligations.length
        ? (await facts.review(p)).courses.flatMap((course) =>
            course.obligations.map((o) => ({ id: o.id, title: o.title })),
          )
        : [];
      const titled = (ids: string[], rows: { id: string; title: string }[]) =>
        ids.map((id) => ({
          id,
          title: rows.find((row) => row.id === id)?.title ?? null,
        }));
      const courseTitle = (id: string | null | undefined) =>
        courses.find((course) => course.id === id)?.title ?? null;
      const workOf = (workId: string | null) => {
        const task = tasks.find((t) => t.id === workId);
        const obligation = obligations.find(
          (o) => o.id === (task?.obligationId ?? workId),
        );
        if (task)
          return {
            title: task.title,
            course: courseTitle(task.courseId ?? obligation?.courseId),
          };
        if (!obligation) return null;
        return {
          title: reviewed.find((o) => o.id === obligation.id)?.title || null,
          course: courseTitle(obligation.courseId),
        };
      };
      const now = clock.now();
      const decided = read.approvals
        .flatMap(
          ({ decision, decidedAt, expiresAt, action }): VerlaufEntry[] => {
            const { start, end } = action.args as {
              start?: string;
              end?: string;
            };
            const shown = {
              kind: action.kind,
              work: workOf(read.workOfAction(action)),
              start: start ? new Date(start) : null,
              end: end ? new Date(end) : null,
            };
            if (decision === "approved" || decision === "denied")
              return [
                {
                  type: "approval",
                  at: decidedAt!,
                  action: shown,
                  decision: decision === "approved" ? "approved" : "denied",
                  outcome:
                    decision === "denied"
                      ? null
                      : action.status === "awaiting_approval" ||
                          action.status === "dispatching"
                        ? "pending"
                        : action.status,
                  refusal:
                    decision === "approved" && action.status === "refused"
                      ? (action.refusal as Refusal)
                      : null,
                },
              ];
            if (action.refusal === "approval_withdrawn")
              return [
                {
                  type: "approval",
                  at: action.events[0]!.at,
                  action: shown,
                  decision: "withdrawn",
                  outcome: null,
                  refusal: null,
                },
              ];
            // Unanswered past its expiry, or refused once a late answer came: shown as expired from then.
            if (
              (action.status === "awaiting_approval" && expiresAt <= now) ||
              action.refusal === "approval_expired"
            )
              return [
                {
                  type: "approval",
                  at: expiresAt,
                  action: shown,
                  decision: "expired",
                  outcome: null,
                  refusal: null,
                },
              ];
            return [];
          },
        )
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      // What was decided after the Run ended follows its end.
      const ended =
        run.status !== "running" && run.endedAt ? run.endedAt : null;
      const afterEnd = (entry: VerlaufEntry) =>
        ended !== null && entry.at >= ended;
      const verlauf: VerlaufEntry[] = [
        {
          type: "start",
          at: run.startedAt,
          trigger: run.trigger as ActivityRun["trigger"],
        },
        ...run.events.map((event): VerlaufEntry => {
          if (event.type === "read") {
            const read = event.detail as ReadEvent;
            return {
              type: "read",
              at: event.at,
              step: read.step,
              plan: read.plan,
              approvals: read.approvals ?? false,
              courses: titled(read.courseIds, courses),
              sources: titled(read.sourceIds, sources),
            };
          }
          const call = event.detail as ActionEvent;
          return {
            type: "action",
            at: event.at,
            step: call.step,
            capability: call.capability,
            action:
              call.actionId && call.kind
                ? {
                    kind: call.kind,
                    work: workOf(call.workId),
                    start: call.start ? new Date(call.start) : null,
                    end: call.end ? new Date(call.end) : null,
                  }
                : null,
            outcome: call.outcome,
            refusal: call.refusal,
            brokenPreferences: call.brokenPreferences,
          };
        }),
        ...decided.filter((entry) => !afterEnd(entry)),
        ...(ended
          ? [
              {
                type: "end" as const,
                at: ended,
                status: run.status as Exclude<ActivityRun["status"], "running">,
                reason: run.stopReason,
              },
            ]
          : []),
        ...decided.filter(afterEnd),
      ];
      return {
        ...shown(run, read.open),
        costMicroUsd: Number(read.cost),
        budgetMicroUsd: Number(run.agent!.budgetMicroUsd),
        summary: read.summary,
        summaryGone: run.summaryContent !== null && read.summary === null,
        verlauf,
      };
    },
  };
}
export type Activity = ReturnType<typeof createActivity>;
