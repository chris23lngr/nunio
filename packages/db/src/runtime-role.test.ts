import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, createPrismaClient, type PrismaClient } from "./index.js";
import { startTestDatabase, type TestDatabase } from "./testing.js";

let db: TestDatabase;
/** Seeds fixtures as the migration role. */
let admin: PrismaClient;
/** Connects as the restricted runtime role, as the API does. */
let runtime: PrismaClient;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
  runtime = createPrismaClient(createPool(db.runtimeConnectionString));
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

async function invitation(): Promise<string> {
  const id = randomUUID();
  await admin.invitation.create({
    data: { id, tokenHash: id, email: `${id}@example.com`, issuedBy: "test", expiresAt: new Date(Date.now() + 60_000) },
  });
  return id;
}

async function user(): Promise<string> {
  const id = randomUUID();
  await admin.user.create({ data: { id, name: "Student", email: `${id}@example.com` } });
  return id;
}

describe("the runtime role's auth grants", () => {
  it("can claim an invitation but not extend it", async () => {
    const id = await invitation();

    await expect(runtime.invitation.updateMany({ where: { id, acceptedAt: null }, data: { acceptedAt: new Date() } }))
      .resolves.toEqual({ count: 1 });
    await expect(runtime.invitation.updateMany({ where: { id }, data: { expiresAt: new Date(Date.now() + 3_600_000) } }))
      .rejects.toThrow(/permission denied/);
  });

  it("can verify a user but not change their email", async () => {
    const id = await user();

    await runtime.user.update({ where: { id }, data: { emailVerified: true } });
    await expect(runtime.user.update({ where: { id }, data: { email: `changed-${id}@example.com` } }))
      .rejects.toThrow(/permission denied/);
    expect(await admin.user.findUnique({ where: { id }, select: { email: true, emailVerified: true } }))
      .toEqual({ email: `${id}@example.com`, emailVerified: true });
  });
});
