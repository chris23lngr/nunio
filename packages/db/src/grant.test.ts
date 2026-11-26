import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./index.js";
import { createPool, createPrismaClient } from "./index.js";
import type { TestDatabase } from "./testing.js";
import { startTestDatabase } from "./testing.js";

let db: TestDatabase;
let admin: PrismaClient;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
}, 180_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
});

/** A student with an Agent and an Email Connection. */
async function student() {
  const studentId = randomUUID();
  await admin.user.create({
    data: { id: studentId, name: "Lea", email: `${studentId}@example.com` },
  });
  const agentId = randomUUID();
  await admin.agent.create({
    data: {
      id: agentId,
      studentId,
      name: "Wochenplaner",
      instructions: "Plane meine Woche.",
      budgetMicroUsd: 1_000_000n,
    },
  });
  const connectionId = randomUUID();
  await admin.connection.create({
    data: {
      id: connectionId,
      studentId,
      integrationKey: "email",
      accountLabel: "lea@uni.test",
      keyVersion: "test",
      keyCiphertext: "wrapped",
    },
  });
  return { studentId, agentId, connectionId };
}

describe("a Grant", () => {
  it("is held by an Agent for a kind, or by a Connection for a tool", async () => {
    const { studentId, agentId, connectionId } = await student();

    await admin.grant.create({
      data: { id: randomUUID(), studentId, agentId, kind: "task.create" },
    });
    await admin.grant.create({
      data: {
        id: randomUUID(),
        studentId,
        connectionId,
        toolName: "notes.create_page",
      },
    });

    expect(await admin.grant.count({ where: { studentId } })).toBe(2);
  });

  it("is never held by both, by neither, or by half of either", async () => {
    const { studentId, agentId, connectionId } = await student();
    const holders = [
      { agentId, kind: "task.create", connectionId, toolName: "notes.share" },
      {},
      { agentId },
      { kind: "task.create" },
      { connectionId },
      { toolName: "notes.share" },
      { agentId, toolName: "notes.share" },
      { kind: "task.create", connectionId },
    ];

    for (const holder of holders)
      await expect(
        admin.grant.create({
          data: { id: randomUUID(), studentId, ...holder },
        }),
        JSON.stringify(Object.keys(holder)),
      ).rejects.toThrow(/grant_holder_check/);
    expect(await admin.grant.count({ where: { studentId } })).toBe(0);
  });

  it("is held once per Connection and tool", async () => {
    const { studentId, connectionId } = await student();
    const grant = () =>
      admin.grant.create({
        data: {
          id: randomUUID(),
          studentId,
          connectionId,
          toolName: "notes.create_page",
        },
      });
    await grant();

    await expect(grant()).rejects.toMatchObject({ code: "P2002" });
    // Another tool of the same Connection gets its own Grant.
    await admin.grant.create({
      data: { id: randomUUID(), studentId, connectionId, toolName: "notes.x" },
    });
    expect(await admin.grant.count({ where: { studentId } })).toBe(2);
  });

  it("goes with its Connection", async () => {
    const { studentId, connectionId } = await student();
    await admin.grant.create({
      data: {
        id: randomUUID(),
        studentId,
        connectionId,
        toolName: "notes.create_page",
      },
    });

    await admin.connection.delete({ where: { id: connectionId } });

    expect(await admin.grant.count({ where: { studentId } })).toBe(0);
  });
});
