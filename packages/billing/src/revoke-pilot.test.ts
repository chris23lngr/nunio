import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execute = promisify(execFile);

let db: TestDatabase;
/** Seeds fixtures as the migration role. */
let admin: PrismaClient;
/** An operator login with neither superuser nor BYPASSRLS, so forced RLS applies to it. */
let operatorURL: string;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
  const user = `nunio_operator_test_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  await admin.$executeRawUnsafe(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${user}`);
  await admin.$executeRawUnsafe(`GRANT SELECT, UPDATE ON "pilot_entitlement" TO ${user}`);
  const url = new URL(db.connectionString);
  url.username = user;
  url.password = password;
  operatorURL = url.toString();
}, 180_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
});

function revokePilot(studentId: string, operator: string) {
  return execute(process.execPath, [fileURLToPath(new URL("./revoke-pilot.ts", import.meta.url)), studentId], {
    env: { PATH: process.env.PATH, OPERATOR_DATABASE_URL: operatorURL, OPERATOR_ID: operator },
  });
}

describe("revoke-pilot under a least-privilege operator role", () => {
  it("records the revocation and preserves it on a repeat", async () => {
    const id = randomUUID();
    await admin.user.create({ data: { id, name: "Student", email: `${id}@example.com`, emailVerified: true } });
    await admin.pilotEntitlement.create({ data: { studentId: id } });

    const first = JSON.parse((await revokePilot(id, "original-founder")).stdout) as { revokedAt: string };
    const repeated = JSON.parse((await revokePilot(id, "another-operator")).stdout) as unknown;

    expect(first).toMatchObject({ studentId: id, revokedBy: "original-founder" });
    expect(repeated).toEqual(first);
    expect(await admin.pilotEntitlement.findUnique({ where: { studentId: id } }))
      .toMatchObject({ revokedAt: new Date(first.revokedAt), revokedBy: "original-founder" });
  });
});
