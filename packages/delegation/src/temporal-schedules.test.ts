import { randomUUID } from "node:crypto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentSchedules } from "./temporal-schedules.js";

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe("Agent Schedules on Temporal", () => {
  it("starts a Run of the Agent every day at 06:00 in the student's time zone", async () => {
    const schedules = createAgentSchedules({
      client: env.client,
      taskQueue: "runs",
    });
    const agentId = randomUUID(),
      studentId = randomUUID();

    await schedules.create({
      agentId,
      studentId,
      timeZone: "Europe/Berlin",
    });

    const described = await env.client.schedule
      .getHandle(`responsibility/${agentId}`)
      .describe();
    expect(described.spec.timezone).toBe("Europe/Berlin");
    expect(described.spec.calendars).toMatchObject([
      {
        hour: [{ start: 6, end: 6, step: 1 }],
        minute: [{ start: 0, end: 0, step: 1 }],
      },
    ]);
    expect(described.action).toMatchObject({
      type: "startWorkflow",
      workflowType: "responsibilityRun",
      taskQueue: "runs",
      args: [{ studentId, responsibilityId: agentId }],
    });
    expect(described.state.paused).toBe(false);
  });

  it("starts a free-text Agent's Runs at its Uhrzeit on its Wochentage, in the Plan's time zone, skipping while one runs", async () => {
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
      .getHandle(`responsibility/${agentId}`)
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

  it("brings a free-text Agent's Schedule in line with a saved trigger and its Paused state", async () => {
    const schedules = createAgentSchedules({
      client: env.client,
      taskQueue: "runs",
    });
    const agentId = randomUUID(),
      studentId = randomUUID();
    const handle = env.client.schedule.getHandle(`responsibility/${agentId}`);
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

  it("pauses, unpauses and deletes the Schedule, each safely repeated", async () => {
    const schedules = createAgentSchedules({
      client: env.client,
      taskQueue: "runs",
    });
    const agentId = randomUUID();
    const handle = env.client.schedule.getHandle(`responsibility/${agentId}`);
    const r = {
      agentId,
      studentId: randomUUID(),
      timeZone: "Europe/Berlin",
    };

    await schedules.create(r);
    await schedules.create(r);
    await schedules.pause(agentId);
    await schedules.pause(agentId);
    expect((await handle.describe()).state.paused).toBe(true);
    await schedules.unpause(agentId);
    expect((await handle.describe()).state.paused).toBe(false);
    await schedules.delete(agentId);
    await schedules.delete(agentId);

    await expect(handle.describe()).rejects.toThrow();
  });
});
