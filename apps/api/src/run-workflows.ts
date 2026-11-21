import type { Schedules } from "@nunio/delegation";
import { createAgentSchedules } from "@nunio/delegation/temporal-schedules";
import { payloadCodecFromEnv } from "@nunio/keys";
import { Client, Connection, WorkflowNotFoundError } from "@temporalio/client";

/**
 * The Temporal side of Runs as the API needs it: waking a Run once the student decided on one of its Actions, and
 * starting, stopping and checking on a free-text Agent's Runs.
 */
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
  /**
   * Tells the workflow of a free-text Agent's Run to stop at once, as the student Paused or Ended the Agent; the
   * database already refuses its next step and Action. False when the workflow no longer runs.
   */
  stopAgentRun(
    workflowId: string,
    reason: "paused" | "ended",
  ): Promise<boolean>;
  /** Whether the workflow of a free-text Agent's Run still runs. */
  agentRunAlive(workflowId: string): Promise<boolean>;
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
    async stopAgentRun(workflowId, reason) {
      try {
        await client.workflow
          .getHandle(workflowId)
          .signal("stopAgentRun", reason);
        return true;
      } catch (error) {
        // Temporal answers so for a workflow that has closed, however it closed.
        if (error instanceof WorkflowNotFoundError) return false;
        throw error;
      }
    },
    async agentRunAlive(workflowId) {
      try {
        const { status } = await client.workflow
          .getHandle(workflowId)
          .describe();
        return status.name === "RUNNING";
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) return false;
        throw error;
      }
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
    stopAgentRun: (workflowId, reason) =>
      withClient((client) =>
        runWorkflowsOf(client).stopAgentRun(workflowId, reason),
      ),
    agentRunAlive: (workflowId) =>
      withClient((client) => runWorkflowsOf(client).agentRunAlive(workflowId)),
  };
  const schedules: Schedules = {
    create: (r) => withClient((client) => schedulesOf(client).create(r)),
    save: (r) => withClient((client) => schedulesOf(client).save(r)),
    pause: (id) => withClient((client) => schedulesOf(client).pause(id)),
    unpause: (id) => withClient((client) => schedulesOf(client).unpause(id)),
    delete: (id) => withClient((client) => schedulesOf(client).delete(id)),
  };
  return { runWorkflows, schedules };
}
