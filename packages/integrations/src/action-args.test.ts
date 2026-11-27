import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { principal, withOwner } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createActionArgs } from "./index.js";
import { seedIntegrationCatalog } from "./testing.js";

let db: TestDatabase;
/** The migration role, which seeds as the dev migrate step does. */
let admin: PrismaClient;
/** The restricted runtime role, as the API and worker connect. */
let runtime: PrismaClient;

const keys = createSourceKeys({
  activeVersion: "v1",
  masters: { v1: randomBytes(32) },
});
const actionArgs = createActionArgs({ keys });

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
  runtime = createPrismaClient(createPool(db.runtimeConnectionString));
  await seedIntegrationCatalog(admin, {
    url: "https://mcp.nunio.test",
    mcpUrl: "https://mcp.nunio.test/mcp",
  });
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

/** A student with a Connection to Testnotizen, its content key wrapped as connecting wraps it. */
async function connected() {
  const studentId = randomUUID(),
    connectionId = randomUUID();
  await admin.user.create({
    data: {
      id: studentId,
      name: "Student",
      email: `${studentId}@example.com`,
      emailVerified: true,
    },
  });
  const { wrapped } = keys.generateConnectionKey(connectionId);
  await admin.connection.create({
    data: {
      id: connectionId,
      studentId,
      integrationKey: "testnotizen",
      accountLabel: "Testnotizen",
      keyVersion: wrapped.version,
      keyCiphertext: wrapped.ciphertext,
    },
  });
  return { connectionId, p: principal.fromSession({ studentId }) };
}

const page = { title: "Lineare Algebra", body: "Zusammenfassung", tags: [1] };

describe("an Integration Action's sealed tool arguments", () => {
  it("open as they were sealed, under the student's owner context", async () => {
    const { connectionId, p } = await connected();
    const action = { id: randomUUID(), connectionId };

    const sealed = await withOwner(runtime, p, (tx) =>
      actionArgs.seal(tx, action, page),
    );

    expect(Buffer.from(sealed).toString("latin1")).not.toContain(
      "Lineare Algebra",
    );
    expect(
      await withOwner(runtime, p, (tx) => actionArgs.open(tx, action, sealed)),
    ).toEqual(page);
  });

  it("open only for the Action they were sealed for", async () => {
    const { connectionId, p } = await connected();
    const sealed = await withOwner(runtime, p, (tx) =>
      actionArgs.seal(tx, { id: randomUUID(), connectionId }, page),
    );

    await expect(
      withOwner(runtime, p, (tx) =>
        actionArgs.open(tx, { id: randomUUID(), connectionId }, sealed),
      ),
    ).rejects.toThrow();
  });

  it("are shredded with the Connection's content key", async () => {
    const { connectionId, p } = await connected();
    const action = { id: randomUUID(), connectionId };
    const sealed = await withOwner(runtime, p, (tx) =>
      actionArgs.seal(tx, action, page),
    );

    await admin.connection.delete({ where: { id: connectionId } });

    await expect(
      withOwner(runtime, p, (tx) => actionArgs.open(tx, action, sealed)),
    ).rejects.toThrow();
  });
});
