import type { DecisionNotifier } from "@nunio/delegation";
import type { Client } from "@temporalio/client";
import { WorkflowNotFoundError } from "@temporalio/client";

/** Delivery can repeat after a lost acknowledgement, including after the original Run ended. */
export function createDecisionNotifier(client: Client): DecisionNotifier {
  return async ({ workflowId, runId, actionId }) => {
    try {
      await client.workflow
        .getHandle(workflowId, runId)
        .signal("approvalDecided", actionId);
    } catch (error) {
      // Closed executions (or ones aged out of retention) no longer need waking.
      if (!(error instanceof WorkflowNotFoundError)) throw error;
    }
  };
}
