// Run Activities: all I/O of a Responsibility's Run. Every Action goes through the gate, never around it.
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type {
  ActionIntent,
  ActionOutcome,
  DecisionNotifier,
  Delegation,
  Responsibilities,
} from "@nunio/delegation";
import {
  createDelegation,
  createResponsibilities,
  principal,
  withOwner,
} from "@nunio/delegation";
import { sourceKeysFromEnv } from "@nunio/keys";
import { createFacts } from "@nunio/knowledge";
import { createPlan, createPlanExecutor } from "@nunio/planning";
import { Context } from "@temporalio/activity";

export interface RunRef {
  studentId: string;
  responsibilityId: string;
}

/** Dates cross Temporal as ISO strings; the gate takes Dates. */
const revive = (intent: ActionIntent): ActionIntent => ({
  ...intent,
  start: new Date(intent.start),
  end: new Date(intent.end),
});

export function createRunActivities({
  db,
  delegation,
  responsibilities,
  propose,
  notifyDecision,
}: {
  db: PrismaClient;
  notifyDecision: DecisionNotifier;
  delegation: Delegation;
  responsibilities: Responsibilities;
  /** The Responsibility's preset: the Actions this Run should take now. */
  propose: (runId: string) => Promise<ActionIntent[]>;
}) {
  return {
    async startRun(ref: RunRef): Promise<string | null> {
      return responsibilities.startRun({
        ...ref,
        runId: Context.current().info.workflowExecution!.runId,
        workflowId: Context.current().info.workflowExecution!.workflowId,
      });
    },
    async proposeActions(runId: string): Promise<ActionIntent[]> {
      return propose(runId);
    },
    async performAction({
      runId,
      key,
      intent,
    }: {
      runId: string;
      key: string;
      intent: ActionIntent;
    }): Promise<ActionOutcome> {
      return delegation.perform(principal.fromRun(runId), {
        key,
        intent: revive(intent),
      });
    },
    /** Recovers in-flight dispatches and decision wakes a dead API or worker left behind. */
    async reconcileActions(): Promise<number> {
      return delegation.reconcile(notifyDecision);
    },
    /** Interventions are not Actions: raised outside the gate, once per Action however often this is retried. */
    async raiseIntervention({
      runId,
      actionId,
      kind,
    }: {
      runId: string;
      actionId: string;
      kind: "approval_expired" | "unconfirmed";
    }) {
      await withOwner(db, principal.fromRun(runId), (tx, studentId) =>
        tx.intervention.createMany({
          data: [
            {
              id: randomUUID(),
              studentId,
              kind,
              actionId,
              dedupeKey: `${kind}:${actionId}`,
            },
          ],
          skipDuplicates: true,
        }),
      );
    },
  };
}

export type RunActivities = ReturnType<typeof createRunActivities>;

/** The Run Activities as the worker runs them: the real gate over the Plan executor, and the presets over the Plan. */
export function runActivitiesFromEnv(
  env: NodeJS.ProcessEnv,
  notifyDecision: DecisionNotifier,
) {
  const missing = [
    "DATABASE_URL",
    "SOURCE_KEY_VERSION",
    "SOURCE_MASTER_KEYS",
  ].filter((name) => !env[name]);
  if (missing.length)
    throw new Error(`Missing settings: ${missing.join(", ")}`);
  const db = createPrismaClient(createPool(env.DATABASE_URL!));
  const clock = { now: () => new Date() };
  const plan = createPlan({
    db,
    facts: createFacts({ db, keys: sourceKeysFromEnv(env), clock }),
    clock,
  });
  const delegation = createDelegation({
    db,
    aiEnabled: () => env.AI_DISABLED !== "true",
    clock,
    executors: { plan: createPlanExecutor({ db }) },
    deadlineOf: async (studentId, obligationId) =>
      (await plan.view(principal.fromSession({ studentId }))).obligations.find(
        (o) => o.id === obligationId,
      )?.due ?? null,
  });
  /** "Keep this course organized": the Rebalance of the Responsibility's Course. */
  const propose = async (runId: string) => {
    const p = principal.fromRun(runId);
    const courseId = await withOwner(
      db,
      p,
      async (tx) =>
        (
          await tx.run.findUnique({
            where: { id: runId },
            include: { responsibility: true },
          })
        )?.responsibility?.courseId,
    );
    return courseId ? plan.intentsFor(p, courseId) : [];
  };
  return {
    activities: createRunActivities({
      db,
      delegation,
      responsibilities: createResponsibilities({ db, clock }),
      propose,
      notifyDecision,
    }),
    close: () => db.$disconnect(),
  };
}
