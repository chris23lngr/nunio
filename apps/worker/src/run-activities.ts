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
// The mailer alone: the package root also loads Better Auth, which the worker image does not carry.
import { createScalewayMailer } from "@nunio/identity/email";
import { sourceKeysFromEnv } from "@nunio/keys";
import { createFacts } from "@nunio/knowledge";
import { createOutreachSender, createWebPusher, keyOf } from "@nunio/outreach";
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
              dedupeKey: keyOf({
                kind,
                subject: { kind: "action", id: actionId },
              }),
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
    "SCW_PROJECT_ID",
    "NOTIFY_SCW_SECRET_KEY",
    "NOTIFY_EMAIL_FROM",
    "APP_ORIGIN",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
    "UNSUBSCRIBE_SECRET",
    "API_ORIGIN",
  ].filter((name) => !env[name]);
  if (missing.length)
    throw new Error(`Missing settings: ${missing.join(", ")}`);
  const db = createPrismaClient(createPool(env.DATABASE_URL!));
  const clock = { now: () => new Date() };
  const facts = createFacts({ db, keys: sourceKeysFromEnv(env), clock });
  const plan = createPlan({ db, facts, clock });
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
  const responsibilities = createResponsibilities({ db, clock });
  const outreach = createOutreachSender({
    db,
    clock,
    plan,
    facts,
    delegation,
    responsibilities,
    // Its own key and sender, so notification email is tracked apart from authentication email (ADR-0014).
    mailer: createScalewayMailer({
      projectId: env.SCW_PROJECT_ID!,
      secretKey: env.NOTIFY_SCW_SECRET_KEY!,
      from: env.NOTIFY_EMAIL_FROM!,
    }),
    pusher: createWebPusher({
      publicKey: env.VAPID_PUBLIC_KEY!,
      privateKey: env.VAPID_PRIVATE_KEY!,
      subject: env.VAPID_SUBJECT!,
    }),
    inboxUrl: `${env.APP_ORIGIN}/inbox`,
    unsubscribe: {
      secret: env.UNSUBSCRIBE_SECRET!,
      url: `${env.API_ORIGIN}/unsubscribe/briefing-email`,
    },
  });
  /** Each preset's Actions: the Rebalance of the Responsibility's Course, or of its one exam. */
  const propose = async (runId: string) => {
    const scope = await responsibilities.scopeOfRun(runId);
    return scope ? plan.intentsFor(principal.fromRun(runId), scope) : [];
  };

  return {
    activities: {
      ...createRunActivities({
        db,
        delegation,
        responsibilities,
        propose,
        notifyDecision,
      }),
      /** Interventions are not Actions: raised and lapsed from their causes, outside the gate. */
      tickOutreach: () => outreach.tick(),
      /** A Routine's Tasks are the student's own planning, not Actions, so they are added outside the gate (ADR-0021). */
      tickRoutines: () => plan.tickRoutines(),
    },
    close: () => db.$disconnect(),
  };
}
