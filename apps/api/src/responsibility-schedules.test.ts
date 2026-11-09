import { randomUUID } from "node:crypto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createResponsibilitySchedules } from "./responsibility-schedules.js";

let env: TestWorkflowEnvironment;

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createLocal();
}, 120_000);

afterAll(async () => {
  await env?.teardown();
});

describe("Responsibility Schedules on Temporal", () => {
  it("starts a Run of the Responsibility every day at 06:00 in the student's time zone", async () => {
    const schedules = createResponsibilitySchedules({
      client: env.client,
      taskQueue: "runs",
    });
    const responsibilityId = randomUUID(),
      studentId = randomUUID();

    await schedules.create({
      responsibilityId,
      studentId,
      timeZone: "Europe/Berlin",
    });

    const described = await env.client.schedule
      .getHandle(`responsibility/${responsibilityId}`)
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
      args: [{ studentId, responsibilityId }],
    });
    expect(described.state.paused).toBe(false);
  });

  it("pauses, unpauses and deletes the Schedule, each safely repeated", async () => {
    const schedules = createResponsibilitySchedules({
      client: env.client,
      taskQueue: "runs",
    });
    const responsibilityId = randomUUID();
    const handle = env.client.schedule.getHandle(
      `responsibility/${responsibilityId}`,
    );
    const r = {
      responsibilityId,
      studentId: randomUUID(),
      timeZone: "Europe/Berlin",
    };

    await schedules.create(r);
    await schedules.create(r);
    await schedules.pause(responsibilityId);
    await schedules.pause(responsibilityId);
    expect((await handle.describe()).state.paused).toBe(true);
    await schedules.unpause(responsibilityId);
    expect((await handle.describe()).state.paused).toBe(false);
    await schedules.delete(responsibilityId);
    await schedules.delete(responsibilityId);

    await expect(handle.describe()).rejects.toThrow();
  });
});
