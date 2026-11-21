// The Schedules port on Temporal: a separate entry, so the domain never imports Temporal. The API saves each Agent's
// Schedule through it, and the worker brings them all in line on start.
import type { Client } from "@temporalio/client";
import {
  ScheduleAlreadyRunning,
  ScheduleNotFoundError,
  ScheduleOverlapPolicy,
  WorkflowNotFoundError,
} from "@temporalio/client";
import type { AgentTrigger, Schedules } from "./agents.js";

const scheduleId = (agentId: string) => `agent/${agentId}`;

/** Each call is safe to repeat: a Schedule that already exists, or is already gone, is left as it is. */
const ignoring =
  (expected: new (...args: never[]) => Error) => (error: unknown) => {
    if (!(error instanceof expected)) throw error;
  };

const days = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

/** The calendar a trigger fires on: its Uhrzeit, every day or on its Wochentage. */
const calendarOf = (trigger: AgentTrigger) => ({
  hour: Math.floor(trigger.minute / 60),
  minute: trigger.minute % 60,
  ...(trigger.rhythm === "weekdays" && {
    dayOfWeek: trigger.weekdays.map((day) => days[day - 1]!),
  }),
});

/** The Temporal Schedules that start each Agent's Runs (ADR-0006), in the Plan's time zone. */
export function createAgentSchedules({
  client,
  taskQueue,
}: {
  client: Client;
  taskQueue: string;
}): Schedules {
  return {
    async save({ agentId, studentId, timeZone, trigger, paused }) {
      const options = {
        spec: { calendars: [calendarOf(trigger)], timezone: timeZone },
        action: {
          type: "startWorkflow" as const,
          workflowType: "agentRun",
          taskQueue,
          // Temporal appends each start's time, so every Run has its own workflow.
          workflowId: `agentRun/${agentId}`,
          args: [{ studentId, agentId }],
        },
        // One Run at a time (ADR-0006): a start is skipped while the last is under way, and none is queued.
        policies: { overlap: ScheduleOverlapPolicy.SKIP },
      };
      try {
        await client.schedule.create({
          scheduleId: scheduleId(agentId),
          ...options,
          state: { paused },
        });
      } catch (error) {
        ignoring(ScheduleAlreadyRunning)(error);
        await client.schedule
          .getHandle(scheduleId(agentId))
          .update((current) => ({
            ...current,
            ...options,
            state: { ...current.state, paused },
          }));
      }
    },
    async delete(agentId) {
      await client.schedule
        .getHandle(scheduleId(agentId))
        .delete()
        .catch(ignoring(ScheduleNotFoundError));
    },
  };
}

/**
 * Whether the workflow of an Agent's Run still runs, for `createAgents`'s `runAlive`: one terminated, timed out or
 * unknown to Temporal does not.
 */
export const workflowAlive =
  (client: Client) =>
  async (workflowId: string): Promise<boolean> => {
    try {
      const { status } = await client.workflow.getHandle(workflowId).describe();
      return status.name === "RUNNING";
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) return false;
      throw error;
    }
  };

/**
 * The Agents cutover (#192) on Temporal, before the worker polls: deletes every Schedule under the old ID
 * `responsibility/<agentId>`, a preset's or an Agent's, then terminates each preset Run (`responsibilityRun`) still
 * running, so no worker without that workflow ever has to run or replay one. Each Agent's Schedule is saved again under
 * `agent/<agentId>` by `agents.saveSchedules()`. Safe to repeat: once done, it finds nothing.
 */
export async function retirePresets(client: Client) {
  for await (const schedule of client.schedule.list())
    if (schedule.scheduleId.startsWith("responsibility/"))
      await client.schedule
        .getHandle(schedule.scheduleId)
        .delete()
        .catch(ignoring(ScheduleNotFoundError));
  for await (const run of client.workflow.list({
    query: `WorkflowType = 'responsibilityRun' AND ExecutionStatus = 'Running'`,
  }))
    await client.workflow
      .getHandle(run.workflowId, run.runId)
      .terminate("Agents cutover: preset Runs are retired (#192)")
      .catch(ignoring(WorkflowNotFoundError));
}
