import { payloadCodecFromEnv } from "@nunio/keys";
import {
  Client,
  Connection,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/client";

export interface SourceWorkflows {
  start(
    kind: "ingestSource" | "extractSource" | "deleteSource",
    studentId: string,
    sourceId: string,
    cleanupAfter?: string,
  ): Promise<void>;
}
export function sourceWorkflowsFromEnv(
  env: NodeJS.ProcessEnv,
): SourceWorkflows {
  const required = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  return {
    async start(kind, studentId, sourceId, cleanupAfter) {
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
        await client.workflow.start(kind, {
          taskQueue: required("TEMPORAL_TASK_QUEUE"),
          workflowId: `${kind}/${sourceId}`,
          args: [
            { studentId, sourceId, ...(cleanupAfter ? { cleanupAfter } : {}) },
          ],
          workflowExecutionTimeout:
            kind === "deleteSource" ? "7 days" : "20 minutes",
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
