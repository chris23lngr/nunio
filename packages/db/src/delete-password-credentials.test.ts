import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./index.js";
import { createPool, createPrismaClient } from "./index.js";
import type { TestDatabase } from "./testing.js";
import { startTestDatabase } from "./testing.js";

let db: TestDatabase;
/** Seeds fixtures and runs the migration as the migration role. */
let admin: PrismaClient;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
}, 180_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
});

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20261207100000_delete_password_credentials/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("deleting stored passwords (ADR-0027)", () => {
  it("removes every password credential and keeps the student and their sessions", async () => {
    const studentId = randomUUID();
    await admin.user.create({
      data: {
        id: studentId,
        name: "Student",
        email: `${studentId}@example.com`,
        emailVerified: true,
        accounts: {
          create: {
            id: randomUUID(),
            accountId: studentId,
            providerId: "credential",
            password: "salt:hash",
          },
        },
        sessions: {
          create: {
            id: randomUUID(),
            token: randomUUID(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        },
      },
    });

    await admin.$executeRawUnsafe(migration);

    expect(
      await admin.account.count({ where: { providerId: "credential" } }),
    ).toBe(0);
    expect(await admin.user.count({ where: { id: studentId } })).toBe(1);
    expect(await admin.session.count({ where: { userId: studentId } })).toBe(1);
  });
});
