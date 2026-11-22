import type { Client } from "@temporalio/client";
import {
  ScheduleAlreadyRunning,
  ScheduleOverlapPolicy,
} from "@temporalio/client";

/** Every five minutes, recover in-flight dispatches and approved Actions nobody performed, and end Agents' Runs whose workflow is gone. Safe to call on every start. */
export async function ensureReconcileSchedule(
  client: Client,
  taskQueue: string,
) {
  await client.schedule
    .create({
      scheduleId: "reconcile-actions",
      spec: { intervals: [{ every: "5 minutes" }] },
      action: {
        type: "startWorkflow",
        workflowType: "reconcileActions",
        taskQueue,
        workflowId: "reconcile-actions",
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
    })
    .catch((error: unknown) => {
      if (!(error instanceof ScheduleAlreadyRunning)) throw error;
    });
}
