import { randomUUID } from "node:crypto";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAgentSchedules,
  retirePresets,
  saveAgentSchedules,
} from "./temporal-schedules.js";

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

describe("bringing every Agent's Schedule in line as the worker starts", () => {
  const exists = (scheduleId: string) =>
    env.client.schedule
      .getHandle(scheduleId)
      .describe()
      .then(
        () => true,
        () => false,
      );

  it("deletes the Schedule of an Agent that does not exist, once it is old enough that no create is still committing it", async () => {
    const schedules = createAgentSchedules({
      client: env.client,
      taskQueue: "runs",
    });
    const kept = randomUUID(),
      orphan = randomUUID(),
      studentId = randomUUID();
    for (const agentId of [kept, orphan])
      await schedules.save({
        agentId,
        studentId,
        timeZone: "Europe/Berlin",
        trigger: { rhythm: "daily", minute: 360 },
        paused: false,
      });
    const other = `reconcile-${randomUUID()}`;
    await env.client.schedule.create({
      scheduleId: other,
      spec: { calendars: [{ hour: 6, minute: 0 }] },
      action: {
        type: "startWorkflow",
        workflowType: "reconcile",
        taskQueue: "runs",
      },
    });
    // Waits until Temporal's visibility lists them.
    for (let i = 0; i < 100; i++) {
      const ids = new Set<string>();
      for await (const s of env.client.schedule.list()) ids.add(s.scheduleId);
      if (ids.has(`agent/${orphan}`) && ids.has(other)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const saved: string[] = [];
    const save = async () => {
      saved.push(kept);
      return [kept];
    };

    // Just created: an Agent create may still be committing it.
    await saveAgentSchedules(env.client, save);
    expect(await exists(`agent/${orphan}`)).toBe(true);
    // An hour on, by two workers starting at once.
    const later = () => new Date(Date.now() + 60 * 60_000);
    await Promise.all([
      saveAgentSchedules(env.client, save, later),
      saveAgentSchedules(env.client, save, later),
    ]);

    expect(await exists(`agent/${orphan}`)).toBe(false);
    expect(await exists(`agent/${kept}`)).toBe(true);
    expect(await exists(other)).toBe(true);
    expect(saved).toEqual([kept, kept, kept]);
  });

  it("deletes nothing when the Agents' Schedules cannot be saved", async () => {
    const orphan = randomUUID();
    await createAgentSchedules({ client: env.client, taskQueue: "runs" }).save({
      agentId: orphan,
      studentId: randomUUID(),
      timeZone: "Europe/Berlin",
      trigger: { rhythm: "daily", minute: 360 },
      paused: false,
    });

    await expect(
      saveAgentSchedules(
        env.client,
        async () => {
          throw new Error("Could not save 1 Agents' Schedules");
        },
        () => new Date(Date.now() + 60 * 60_000),
      ),
    ).rejects.toThrow("Could not save 1 Agents' Schedules");
    expect(await exists(`agent/${orphan}`)).toBe(true);
  });
});

describe("the Agents cutover on Temporal", () => {
  /** Waits until Temporal's visibility lists what was just started. */
  const listed = async (found: () => Promise<boolean>) => {
    for (let i = 0; i < 100 && !(await found()); i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
  };

  /** An Agent's Schedule under the old ID, as it stood before the cutover, and a preset Run waiting on an Approval. */
  async function asItStood(taskQueue: string) {
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
    // No worker here runs it, so it stays running.
    const waiting = await env.client.workflow.start("responsibilityRun", {
      taskQueue,
      workflowId: `run/${preset}-${randomUUID()}`,
      args: [{ studentId, responsibilityId: preset }],
    });
    await listed(async () => {
      for await (const _ of env.client.workflow.list({
        query: `WorkflowId = '${waiting.workflowId}'`,
      }))
        return true;
      return false;
    });
    const save = () =>
      createAgentSchedules({ client: env.client, taskQueue }).save({
        agentId: agent,
        studentId,
        timeZone: "Europe/Berlin",
        trigger: { rhythm: "daily", minute: 360 },
        paused: true,
      });
    return { preset, agent, studentId, waiting, save };
  }

  it("saves every Agent's Schedule under its own ID, then deletes every Schedule under the old one and terminates the preset Runs still running", async () => {
    const taskQueue = `cutover-${randomUUID()}`;
    const b = await asItStood(taskQueue);
    const other = await env.client.workflow.start("agentRun", {
      taskQueue,
      workflowId: `agentRun/${b.agent}-${randomUUID()}`,
      args: [{ studentId: b.studentId, agentId: b.agent }],
    });

    await retirePresets(env.client, b.save);
    await retirePresets(env.client, b.save);

    for (const id of [b.preset, b.agent])
      await expect(
        env.client.schedule.getHandle(`responsibility/${id}`).describe(),
      ).rejects.toThrow();
    expect(
      (await env.client.schedule.getHandle(`agent/${b.agent}`).describe()).state
        .paused,
    ).toBe(true);
    expect((await b.waiting.describe()).status.name).toBe("TERMINATED");
    expect((await other.describe()).status.name).toBe("RUNNING");
    await other.terminate();
  });

  it("touches nothing old when an Agent's Schedule cannot be saved, so the worker does not start", async () => {
    const taskQueue = `cutover-${randomUUID()}`;
    const b = await asItStood(taskQueue);

    await expect(
      retirePresets(env.client, async () => {
        throw new Error("Could not save 1 Agents' Schedules");
      }),
    ).rejects.toThrow("Could not save 1 Agents' Schedules");

    for (const id of [b.preset, b.agent])
      expect(
        (await env.client.schedule.getHandle(`responsibility/${id}`).describe())
          .scheduleId,
      ).toBe(`responsibility/${id}`);
    expect((await b.waiting.describe()).status.name).toBe("RUNNING");
    // A later start, once Temporal answers again, finishes the cutover.
    await retirePresets(env.client, b.save);
    expect((await b.waiting.describe()).status.name).toBe("TERMINATED");
  });
});
