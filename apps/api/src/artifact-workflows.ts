import { payloadCodecFromEnv } from "@nunio/keys";
import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/client";

/** Starts an Artifact's Run once `artifacts.request` recorded and pinned it; the worker then makes the Artifact. */
export interface ArtifactWorkflows {
  start(runId: string): Promise<void>;
}

export function artifactWorkflowsFromEnv(
  env: NodeJS.ProcessEnv,
): ArtifactWorkflows {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  return {
    async start(runId) {
      const connection = await Connection.connect({
        address: required("TEMPORAL_ADDRESS"),
        ...(env.TEMPORAL_API_KEY
          ? { tls: true, apiKey: env.TEMPORAL_API_KEY }
          : {}),
      });
      try {
        const client = new Client({
          connection,
          namespace: required("TEMPORAL_NAMESPACE"),
          dataConverter: { payloadCodecs: [payloadCodecFromEnv(env)] },
        });
        // One workflow per Run (ADR-0006). An Artifact still making after this is shown as failed.
        await client.workflow.start("artifactRun", {
          taskQueue: required("TEMPORAL_TASK_QUEUE"),
          workflowId: `artifactRun/${runId}`,
          args: [{ runId }],
          workflowExecutionTimeout: "15 minutes",
        });
      } catch (error) {
        if (!(error instanceof WorkflowExecutionAlreadyStartedError))
          throw error;
      } finally {
        await connection.close();
      }
    },
  };
}
