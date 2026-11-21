// Agent Run Activities (#141): a free-text Agent's Run, one model step per Activity. All I/O lives here and in
// @nunio/chat's Agent Runs, never in workflow code.
import type { ModelConfig } from "@nunio/ai";
import {
  createAgentModel,
  createEmbedder,
  createGrader,
  createMaker,
  createModels,
} from "@nunio/ai";
import { createArtifacts } from "@nunio/artifacts";
import type { AgentRuns, RunEnd } from "@nunio/chat";
import { createAgentRuns } from "@nunio/chat";
import { createPool, createPrismaClient } from "@nunio/db";
import type { Schedules } from "@nunio/delegation";
import {
  createAgents,
  createDelegation,
  createModelCatalog,
  principal,
} from "@nunio/delegation";
import { sourceKeysFromEnv } from "@nunio/keys";
import { createFacts, createKnowledgeReader } from "@nunio/knowledge";
import { createPlan, createPlanExecutor, planRules } from "@nunio/planning";
import { createUnderstanding } from "@nunio/understanding";
import { Context } from "@temporalio/activity";

/**
 * What starts an Agent's Run: its Schedule, or the API once the student pressed "Jetzt starten", which already
 * recorded the Run as `runId`.
 */
export interface AgentRunRef {
  studentId: string;
  agentId: string;
  runId?: string;
}

export function createAgentRunActivities(
  runs: Pick<AgentRuns, "start" | "step" | "act" | "finish">,
) {
  return {
    /** Records the Run, or takes up the one the API recorded, and snapshots the Agent's configuration. */
    async startAgentRun(ref: AgentRunRef): Promise<string | null> {
      const execution = Context.current().info.workflowExecution!;
      return runs.start({
        studentId: ref.studentId,
        agentId: ref.agentId,
        runId: ref.runId ?? execution.runId,
        workflowId: execution.workflowId,
      });
    },
    /** One metered model step, idempotent on `(runId, n)`. */
    agentStep: ({ runId, n }: { runId: string; n: number }) =>
      runs.step(runId, n),
    /** Step `n`'s Action calls through the gate, each under `runId:n:call`, so a retry never acts twice. */
    agentActions: ({ runId, n }: { runId: string; n: number }) =>
      runs.act(runId, n),
    /** Ends the Run, if it was recorded; safe to repeat. */
    finishAgentRun: ({
      run,
      end,
    }: {
      run: { runId: string; studentId: string };
      end: RunEnd;
    }) => runs.finish(run, end),
  };
}

export type AgentRunActivities = ReturnType<typeof createAgentRunActivities>;

const settings = [
  "DATABASE_URL",
  "SOURCE_KEY_VERSION",
  "SOURCE_MASTER_KEYS",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
];

/**
 * The Agent Run Activities as the worker runs them. `catalog` is the Model Catalog's task Models, read once at start;
 * `schedules` are the Agents' Schedules, which the worker brings in line with their triggers as it starts.
 */
export function agentRunActivitiesFromEnv(
  env: NodeJS.ProcessEnv,
  catalog: readonly ModelConfig[],
  schedules: Schedules,
) {
  const missing = settings.filter((name) => !env[name]);
  if (missing.length)
    throw new Error(`Missing settings: ${missing.join(", ")}`);
  const db = createPrismaClient(createPool(env.DATABASE_URL!));
  const keys = sourceKeysFromEnv(env);
  const clock = { now: () => new Date() };
  const provider = {
    apiKey: env.OPENROUTER_API_KEY!,
    baseURL: env.OPENROUTER_BASE_URL!,
  };
  const models = createModels({ ...provider, catalog });
  const facts = createFacts({ db, keys, clock });
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
  const reader = createKnowledgeReader({
    db,
    keys,
    embedder: createEmbedder(provider),
    delegation,
    clock,
  });
  const agents = createAgents({ db, schedules, clock });
  const artifacts = createArtifacts({
    db,
    keys,
    reader,
    facts,
    agents,
    delegation,
    maker: createMaker(models),
    clock,
  });
  const runs = createAgentRuns({
    db,
    keys,
    reader,
    plan,
    understanding: createUnderstanding({
      db,
      keys,
      artifacts,
      reader,
      facts,
      delegation,
      grader: createGrader(models),
      clock,
    }),
    artifacts,
    delegation,
    agents,
    catalog: createModelCatalog({ db, clock }),
    modelFor: (model) => createAgentModel(models.fromConfig(model)),
    clock,
  });
  return {
    activities: createAgentRunActivities(runs),
    /** Saves the Schedule of every free-text Agent not Ended; safe on every start. */
    saveSchedules: () => agents.saveSchedules(),
    close: () => db.$disconnect(),
  };
}
