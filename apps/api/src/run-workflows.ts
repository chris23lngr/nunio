import type { Schedules } from "@nunio/delegation";
import { payloadCodecFromEnv } from "@nunio/keys";
import { Client, Connection } from "@temporalio/client";
import { createAgentSchedules } from "./agent-schedules.js";

/** The Temporal side of Runs as the API needs it: waking a Run once the student decided on one of its Actions. */
export interface RunWorkflows {
  /** Carries no authority: the decision is already recorded through the gate; the Run only asks the gate again. */
  signalDecided(
    run: { workflowId: string; runId: string },
    actionId: string,
  ): Promise<void>;
  /** Starts the workflow of a free-text Agent's Run that the student started now and the API already recorded. */
  startAgentRun(run: {
    studentId: string;
    agentId: string;
    runId: string;
    workflowId: string;
  }): Promise<void>;
}

/** Signals by workflow and run ID, so a decision never reaches another Run of the same Agent. */
export function createRunWorkflows({
  client,
  taskQueue,
}: {
  client: Client;
  taskQueue: string;
}): RunWorkflows {
  return {
    async signalDecided({ workflowId, runId }, actionId) {
      await client.workflow
        .getHandle(workflowId, runId)
        .signal("approvalDecided", actionId);
    },
    // One workflow per Run (ADR-0006), under the ID the Run was recorded with.
    async startAgentRun({ studentId, agentId, runId, workflowId }) {
      await client.workflow.start("agentRun", {
        taskQueue,
        workflowId,
        args: [{ studentId, agentId, runId }],
      });
    },
  };
}

/** Runs and Agent Schedules on the deployment's Temporal namespace, connecting per call as Source workflows do. */
export function runWorkflowsFromEnv(env: NodeJS.ProcessEnv) {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  async function withClient<T>(use: (client: Client) => Promise<T>) {
    const connection = await Connection.connect({
      address: required("TEMPORAL_ADDRESS"),
      ...(env.TEMPORAL_API_KEY
        ? { tls: true, apiKey: env.TEMPORAL_API_KEY }
        : {}),
    });
    try {
      return await use(
        new Client({
          connection,
          namespace: required("TEMPORAL_NAMESPACE"),
          dataConverter: { payloadCodecs: [payloadCodecFromEnv(env)] },
        }),
      );
    } finally {
      await connection.close();
    }
  }
  const schedulesOf = (client: Client) =>
    createAgentSchedules({
      client,
      taskQueue: required("TEMPORAL_TASK_QUEUE"),
    });
  const runWorkflowsOf = (client: Client) =>
    createRunWorkflows({ client, taskQueue: required("TEMPORAL_TASK_QUEUE") });
  const runWorkflows: RunWorkflows = {
    signalDecided: (run, actionId) =>
      withClient((client) =>
        runWorkflowsOf(client).signalDecided(run, actionId),
      ),
    startAgentRun: (run) =>
      withClient((client) => runWorkflowsOf(client).startAgentRun(run)),
  };
  const schedules: Schedules = {
    create: (r) => withClient((client) => schedulesOf(client).create(r)),
    pause: (id) => withClient((client) => schedulesOf(client).pause(id)),
    unpause: (id) => withClient((client) => schedulesOf(client).unpause(id)),
    delete: (id) => withClient((client) => schedulesOf(client).delete(id)),
  };
  return { runWorkflows, schedules };
}
