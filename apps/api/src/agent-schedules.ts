import type { Schedules } from "@nunio/delegation";
import type { Client } from "@temporalio/client";
import {
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
} from "@temporalio/client";

// The Schedule ID, workflow type and `responsibilityId` arg keep the old name until the Agents cutover
// reschedules every Agent.
const scheduleId = (agentId: string) => `responsibility/${agentId}`;

/** Each call is safe to repeat: a Schedule that already exists, or is already gone, is left as it is. */
const ignoring =
  (expected: new (...args: never[]) => Error) => (error: unknown) => {
    if (!(error instanceof expected)) throw error;
  };

/** The Temporal Schedules that start each Agent's Runs (ADR-0006): daily at 06:00, the student's time. */
export function createAgentSchedules({
  client,
  taskQueue,
}: {
  client: Client;
  taskQueue: string;
}): Schedules {
  return {
    async create({ agentId, studentId, timeZone }) {
      await client.schedule
        .create({
          scheduleId: scheduleId(agentId),
          spec: { calendars: [{ hour: 6, minute: 0 }], timezone: timeZone },
          action: {
            type: "startWorkflow",
            workflowType: "responsibilityRun",
            taskQueue,
            workflowId: `run/${agentId}`,
            args: [{ studentId, responsibilityId: agentId }],
          },
          // A Run still waiting for an Approval is not joined by the next day's.
          policies: { overlap: ScheduleOverlapPolicy.SKIP },
        })
        .catch(ignoring(ScheduleAlreadyRunning));
    },
    async pause(agentId) {
      await client.schedule.getHandle(scheduleId(agentId)).pause();
    },
    async unpause(agentId) {
      await client.schedule.getHandle(scheduleId(agentId)).unpause();
    },
    async delete(agentId) {
      await client.schedule
        .getHandle(scheduleId(agentId))
        .delete()
        .catch(ignoring(ScheduleNotFoundError));
    },
  };
}
