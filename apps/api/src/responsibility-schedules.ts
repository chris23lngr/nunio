import type { Schedules } from "@nunio/delegation";
import type { Client } from "@temporalio/client";
import {
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
} from "@temporalio/client";

const scheduleId = (responsibilityId: string) =>
  `responsibility/${responsibilityId}`;

/** Each call is safe to repeat: a Schedule that already exists, or is already gone, is left as it is. */
const ignoring =
  (expected: new (...args: never[]) => Error) => (error: unknown) => {
    if (!(error instanceof expected)) throw error;
  };

/** The Temporal Schedules that start each Responsibility's Runs (ADR-0006): daily at 06:00, the student's time. */
export function createResponsibilitySchedules({
  client,
  taskQueue,
}: {
  client: Client;
  taskQueue: string;
}): Schedules {
  return {
    async create({ responsibilityId, studentId, timeZone }) {
      await client.schedule
        .create({
          scheduleId: scheduleId(responsibilityId),
          spec: { calendars: [{ hour: 6, minute: 0 }], timezone: timeZone },
          action: {
            type: "startWorkflow",
            workflowType: "responsibilityRun",
            taskQueue,
            workflowId: `run/${responsibilityId}`,
            args: [{ studentId, responsibilityId }],
          },
          // A Run still waiting for an Approval is not joined by the next day's.
          policies: { overlap: ScheduleOverlapPolicy.SKIP },
        })
        .catch(ignoring(ScheduleAlreadyRunning));
    },
    async pause(responsibilityId) {
      await client.schedule.getHandle(scheduleId(responsibilityId)).pause();
    },
    async unpause(responsibilityId) {
      await client.schedule.getHandle(scheduleId(responsibilityId)).unpause();
    },
    async delete(responsibilityId) {
      await client.schedule
        .getHandle(scheduleId(responsibilityId))
        .delete()
        .catch(ignoring(ScheduleNotFoundError));
    },
  };
}
