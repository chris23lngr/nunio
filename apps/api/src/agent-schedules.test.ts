import { randomUUID } from "node:crypto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentSchedules } from "./agent-schedules.js";

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
