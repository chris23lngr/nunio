import { randomUUID } from "node:crypto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentSchedules, retirePresets } from "./temporal-schedules.js";

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe("Agent Schedules on Temporal", () => {
  it("starts an Agent's Runs at its Uhrzeit on its Wochentage, in the Plan's time zone, skipping while one runs", async () => {
    const schedules = createAgentSchedules({
      client: env.client,
      taskQueue: "runs",
    });
    const agentId = randomUUID(),
      studentId = randomUUID();

    await schedules.save({
      agentId,
      studentId,
      timeZone: "Europe/Vienna",
      trigger: {
        rhythm: "weekdays",
        weekdays: [1, 3, 7],
        minute: 19 * 60 + 30,
      },
      paused: false,
    });

    const described = await env.client.schedule
      .getHandle(`agent/${agentId}`)
      .describe();
    expect(described.spec.timezone).toBe("Europe/Vienna");
    expect(described.spec.calendars).toMatchObject([
      {
        hour: [{ start: 19, end: 19, step: 1 }],
        minute: [{ start: 30, end: 30, step: 1 }],
        dayOfWeek: [
          { start: "MONDAY", end: "MONDAY" },
          { start: "WEDNESDAY", end: "WEDNESDAY" },
          { start: "SUNDAY", end: "SUNDAY" },
        ],
      },
    ]);
    expect(described.action).toMatchObject({
      type: "startWorkflow",
      workflowType: "agentRun",
      taskQueue: "runs",
      args: [{ studentId, agentId }],
    });
    expect(described.policies.overlap).toBe("SKIP");
    expect(described.state.paused).toBe(false);
  });

  it("brings an Agent's Schedule in line with a saved trigger and its Paused state", async () => {
    const schedules = createAgentSchedules({
      client: env.client,
      taskQueue: "runs",
    });
    const agentId = randomUUID(),
      studentId = randomUUID();
    const handle = env.client.schedule.getHandle(`agent/${agentId}`);
    await schedules.save({
      agentId,
      studentId,
      timeZone: "Europe/Berlin",
      trigger: { rhythm: "weekdays", weekdays: [2], minute: 360 },
      paused: false,
    });

    await schedules.save({
      agentId,
      studentId,
      timeZone: "Europe/Berlin",
      trigger: { rhythm: "daily", minute: 7 * 60 + 15 },
      paused: true,
    });

    const described = await handle.describe();
    expect(described.spec.calendars).toHaveLength(1);
    expect(described.spec.calendars![0]).toMatchObject({
      hour: [{ start: 7, end: 7, step: 1 }],
      minute: [{ start: 15, end: 15, step: 1 }],
    });
    // Every day of the week, as an unconstrained calendar has it.
    expect(described.spec.calendars![0]!.dayOfWeek).toEqual([
      { start: "SUNDAY", end: "SATURDAY", step: 1 },
    ]);
    expect(described.state.paused).toBe(true);
    expect(described.action).toMatchObject({ workflowType: "agentRun" });

    await schedules.save({
      agentId,
      studentId,
      timeZone: "Europe/Berlin",
      trigger: { rhythm: "daily", minute: 7 * 60 + 15 },
      paused: false,
    });
    expect((await handle.describe()).state.paused).toBe(false);
    await schedules.delete(agentId);
  });

  it("deletes the Schedule, safely repeated", async () => {
    const schedules = createAgentSchedules({
      client: env.client,
      taskQueue: "runs",
    });
    const agentId = randomUUID();
    const handle = env.client.schedule.getHandle(`agent/${agentId}`);
    await schedules.save({
      agentId,
      studentId: randomUUID(),
      timeZone: "Europe/Berlin",
      trigger: { rhythm: "daily", minute: 360 },
      paused: false,
    });

    await schedules.delete(agentId);
    await schedules.delete(agentId);

    await expect(handle.describe()).rejects.toThrow();
  });
});

describe("the Agents cutover on Temporal", () => {
  /** Waits until Temporal's visibility lists what was just started. */
  const listed = async (found: () => Promise<boolean>) => {
    for (let i = 0; i < 100 && !(await found()); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
  };

  it("deletes every Schedule under its old ID and terminates the preset Runs still running, leaving Agents' Schedules", async () => {
    const taskQueue = `cutover-${randomUUID()}`;
    const preset = randomUUID(),
      agent = randomUUID(),
      studentId = randomUUID();
    const old = (agentId: string, workflowType: string) =>
      env.client.schedule.create({
        scheduleId: `responsibility/${agentId}`,
        spec: { calendars: [{ hour: 6, minute: 0 }] },
        action: {
          type: "startWorkflow",
          workflowType,
          taskQueue,
          args: [{ studentId, agentId }],
        },
      });
    await old(preset, "responsibilityRun");
    await old(agent, "agentRun");
    await createAgentSchedules({ client: env.client, taskQueue }).save({
      agentId: agent,
      studentId,
      timeZone: "Europe/Berlin",
      trigger: { rhythm: "daily", minute: 360 },
      paused: true,
    });
    // A preset Run waiting on an Approval: no worker here runs it, so it stays running.
    const waiting = await env.client.workflow.start("responsibilityRun", {
      taskQueue,
      workflowId: `run/${preset}-${randomUUID()}`,
      args: [{ studentId, responsibilityId: preset }],
    });
    const other = await env.client.workflow.start("agentRun", {
      taskQueue,
      workflowId: `agentRun/${agent}-${randomUUID()}`,
      args: [{ studentId, agentId: agent }],
    });
    await listed(async () => {
      for await (const _ of env.client.workflow.list({
        query: `WorkflowId = '${waiting.workflowId}'`,
      }))
        return true;
      return false;
    });

    await retirePresets(env.client);
    await retirePresets(env.client);

    for (const id of [preset, agent])
      await expect(
        env.client.schedule.getHandle(`responsibility/${id}`).describe(),
      ).rejects.toThrow();
    expect(
      (await env.client.schedule.getHandle(`agent/${agent}`).describe()).state
        .paused,
    ).toBe(true);
    expect((await waiting.describe()).status.name).toBe("TERMINATED");
    expect((await other.describe()).status.name).toBe("RUNNING");
    await other.terminate();
  });
});
