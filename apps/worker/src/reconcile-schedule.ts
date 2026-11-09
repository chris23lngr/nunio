import type { Client } from "@temporalio/client";
import {
  ScheduleAlreadyRunning,
  ScheduleOverlapPolicy,
} from "@temporalio/client";

/** Every five minutes, `reconcile` asks executors about dispatches left in flight. Safe to call on every start. */
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
