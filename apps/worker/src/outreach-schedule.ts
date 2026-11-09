import type { Client } from "@temporalio/client";
import {
  ScheduleAlreadyRunning,
  ScheduleOverlapPolicy,
} from "@temporalio/client";

/** Every five minutes, raise and lapse Interventions from their causes. Safe to call on every start. */
export async function ensureOutreachSchedule(
  client: Client,
  taskQueue: string,
) {
  await client.schedule
    .create({
      scheduleId: "outreach-tick",
      spec: { intervals: [{ every: "5 minutes" }] },
      action: {
        type: "startWorkflow",
        workflowType: "outreachTick",
        taskQueue,
        workflowId: "outreach-tick",
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
    })
    .catch((error: unknown) => {
      if (!(error instanceof ScheduleAlreadyRunning)) throw error;
    });
}
