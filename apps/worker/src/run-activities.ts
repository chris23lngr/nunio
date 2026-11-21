// Run Activities: the reconcile, outreach and Routine ticks. Every Action goes through the gate, never around it.
import { createPool, createPrismaClient } from "@nunio/db";
import type { Delegation } from "@nunio/delegation";
import { createAgents, createDelegation, principal } from "@nunio/delegation";
// The mailer alone: the package root also loads Better Auth, which the worker image does not carry.
import { createScalewayMailer } from "@nunio/identity/email";
import { sourceKeysFromEnv } from "@nunio/keys";
import { createFacts } from "@nunio/knowledge";
import { createOutreachSender, createWebPusher } from "@nunio/outreach";
import { createPlan, createPlanExecutor, planRules } from "@nunio/planning";

export function createRunActivities({
  delegation,
}: {
  delegation: Delegation;
}) {
  return {
    /** Recovers in-flight dispatches a dead API or worker left behind. */
    async reconcileActions(): Promise<number> {
      return delegation.reconcile();
    },
  };
}

export type RunActivities = ReturnType<typeof createRunActivities>;

/** The Run Activities as the worker runs them: the real gate over the Plan executor, and the ticks over the Plan. */
export function runActivitiesFromEnv(env: NodeJS.ProcessEnv) {
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
    planRules,
    deadlineOf: async (studentId, obligationId) =>
      (await plan.view(principal.fromSession({ studentId }))).obligations.find(
        (o) => o.id === obligationId,
      )?.due ?? null,
  });
  const agents = createAgents({ db, clock });
  const outreach = createOutreachSender({
    db,
    clock,
    plan,
    facts,
    delegation,
    agents,
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
  });

  return {
    activities: {
      ...createRunActivities({ delegation }),
      /** Interventions are not Actions: raised and lapsed from their causes, outside the gate. */
      tickOutreach: () => outreach.tick(),
      /** A Routine's Tasks are the student's own planning, not Actions, so they are added outside the gate (ADR-0022). */
      tickRoutines: () => plan.tickRoutines(),
    },
    close: () => db.$disconnect(),
  };
}
