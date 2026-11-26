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
  /** Groups a Course's Topics into Topic Areas after a merge (ADR-0024). */
  groupCourse(studentId: string, courseId: string): Promise<void>;
  /** Promotes an Own Work file, or cleans up its objects after deletion (#306). */
  ownWork(
    kind: "promoteOwnWork" | "deleteOwnWork",
    studentId: string,
    fileId: string,
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
  /** Starts a workflow once; a run already started under its ID is left alone. */
  async function startOnce(
    kind: string,
    workflowId: string,
    args: unknown[],
    workflowExecutionTimeout: "7 days" | "20 minutes" | "10 minutes",
  ) {
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
        workflowId,
        args,
        workflowExecutionTimeout,
      });
    } catch (error) {
      if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
    } finally {
      await connection.close();
    }
  }
  return {
    async start(kind, studentId, sourceId, cleanupAfter) {
      await startOnce(
        kind,
        `${kind}/${sourceId}`,
        [{ studentId, sourceId, ...(cleanupAfter ? { cleanupAfter } : {}) }],
        kind === "deleteSource" ? "7 days" : "20 minutes",
      );
    },
    async groupCourse(studentId, courseId) {
      await startOnce(
        "groupCourse",
        `groupCourse/${courseId}`,
        [{ studentId, courseId }],
        "10 minutes",
      );
    },
    async ownWork(kind, studentId, fileId, cleanupAfter) {
      await startOnce(
        kind,
        `${kind}/${fileId}`,
        [{ studentId, fileId, ...(cleanupAfter ? { cleanupAfter } : {}) }],
        kind === "deleteOwnWork" ? "7 days" : "20 minutes",
      );
    },
  };
}
