import type { Client } from "@temporalio/client";
import {
  ScheduleAlreadyRunning,
  ScheduleOverlapPolicy,
} from "@temporalio/client";

/** Daily, sync the Model Catalog's prices from OpenRouter; the first run starts at once. Safe to call on every start. */
export async function ensureModelPriceSchedule(
  client: Client,
  taskQueue: string,
) {
  await client.schedule
    .create({
      scheduleId: "sync-model-prices",
      spec: { intervals: [{ every: "1 day" }] },
      action: {
        type: "startWorkflow",
        workflowType: "syncModelPrices",
        taskQueue,
        workflowId: "sync-model-prices",
      },
      policies: { overlap: ScheduleOverlapPolicy.SKIP },
      state: { triggerImmediately: true },
    })
    .catch((error: unknown) => {
      if (!(error instanceof ScheduleAlreadyRunning)) throw error;
    });
}
