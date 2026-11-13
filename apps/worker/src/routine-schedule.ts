import type { Client } from "@temporalio/client";
import {
  ScheduleAlreadyRunning,
  ScheduleOverlapPolicy,
} from "@temporalio/client";

/** Daily, add the Tasks every student's Routines call for (ADR-0021); the first run starts at once. Safe on every start. */
export async function ensureRoutineSchedule(client: Client, taskQueue: string) {
  await client.schedule
    .create({
      scheduleId: "routine-tick",
      spec: { intervals: [{ every: "1 day" }] },
      action: {
        type: "startWorkflow",
        workflowType: "routineTick",
        taskQueue,
        workflowId: "routine-tick",
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
      state: { triggerImmediately: true },
    })
    .catch((error: unknown) => {
      if (!(error instanceof ScheduleAlreadyRunning)) throw error;
    });
}
