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

/** No Agent create holds its transaction open this long, so an `agent/*` Schedule older than this without its Agent is orphaned. */
const orphanAfterMs = 10 * 60_000;

/**
 * Brings every Agent's Schedule in line as the worker starts: `saveSchedules` saves the Schedule of every Agent not
 * Ended and returns their IDs, then every `agent/*` Schedule listed before it whose Agent is not among them is deleted,
 * such as one an Agent create saved before its commit failed, or one left by an Ended Agent. A Schedule younger than
 * `orphanAfterMs` is left alone, as its Agent may still be committing. If `saveSchedules` rejects, nothing is deleted.
 * Safe to repeat, and for several workers at once.
 */
export async function saveAgentSchedules(
  client: Client,
  saveSchedules: () => Promise<string[]>,
  now = () => new Date(),
) {
  // Listed first, so an Agent created meanwhile is either among those saved or too young to delete.
  const listed: string[] = [];
  for await (const schedule of client.schedule.list())
    if (schedule.scheduleId.startsWith("agent/"))
      listed.push(schedule.scheduleId);
  const agents = new Set((await saveSchedules()).map(scheduleId));
  for (const id of listed) {
    if (agents.has(id)) continue;
    const handle = client.schedule.getHandle(id);
    try {
      const { info } = await handle.describe();
      if (now().getTime() - info.createdAt.getTime() < orphanAfterMs) continue;
      await handle.delete();
    } catch (error) {
      ignoring(ScheduleNotFoundError)(error);
    }
  }
}

/**
 * The Agents cutover (#192) on Temporal, before the worker polls. First `saveSchedules` saves every Agent's Schedule
 * under `agent/<agentId>`; if any save fails it rejects, and nothing old is touched, so the worker does not start and no
 * Agent is left without a Schedule. Only then is every Schedule under the old ID `responsibility/<agentId>` deleted, a
 * preset's or an Agent's, and each preset Run (`responsibilityRun`) still running terminated, so no worker without that
 * workflow ever has to run or replay one. Safe to repeat, and for several workers at once: once done, it finds nothing.
 */
export async function retirePresets(
  client: Client,
  saveSchedules: () => Promise<void>,
) {
  await saveSchedules();
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
