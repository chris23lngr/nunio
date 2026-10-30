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
  await admin.$executeRawUnsafe(`GRANT SELECT, UPDATE ("limitMicroUsd", "updatedAt") ON "allowance" TO ${user}`);
  await admin.$executeRawUnsafe(`GRANT SELECT, INSERT ON "allowance_grant" TO ${user}`);
  const url = new URL(db.connectionString);
  url.username = user;
  url.password = password;
  operatorURL = url.toString();
}, 180_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
});

function grantAllowance(studentId: string, usd: string, operator: string) {
  return execute(process.execPath, [fileURLToPath(new URL("./grant-allowance.ts", import.meta.url)), studentId, usd], {
    env: { PATH: process.env.PATH, OPERATOR_DATABASE_URL: operatorURL, OPERATOR_ID: operator },
  });
}

async function student(): Promise<string> {
  const id = randomUUID();
  await admin.user.create({ data: { id, name: "Student", email: `${id}@example.com`, emailVerified: true } });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  await admin.allowance.create({ data: { studentId: id } });
  return id;
}

describe("grant-allowance under a least-privilege operator role", () => {
  it("raises the student's limit and records who granted how much", async () => {
    const id = await student();

    const { stdout } = await grantAllowance(id, "2.50", "founder");

    expect(JSON.parse(stdout)).toMatchObject({
      studentId: id, grantedMicroUsd: 2_500_000, limitMicroUsd: 7_500_000, grantedBy: "founder",
    });
    expect(await admin.allowanceGrant.findMany({ where: { studentId: id }, select: { amountMicroUsd: true, grantedBy: true } }))
      .toEqual([{ amountMicroUsd: 2_500_000n, grantedBy: "founder" }]);
  });

  it.each(["0", "-1", "2.5.0", "1e3", "0.0000001", "abc"])("refuses the amount %j without changing the limit", async usd => {
    const id = await student();

    await expect(grantAllowance(id, usd, "founder")).rejects.toMatchObject({
      code: 1, stdout: "", stderr: expect.stringContaining("Usage: grant-allowance.js"),
    });
    expect(await admin.allowance.findUnique({ where: { studentId: id }, select: { limitMicroUsd: true } }))
      .toEqual({ limitMicroUsd: 5_000_000n });
  });

  it("refuses a student without an Allowance and records no grant", async () => {
    const id = randomUUID();
    await admin.user.create({ data: { id, name: "Legacy", email: `${id}@example.com`, emailVerified: true } });

    await expect(grantAllowance(id, "1", "founder")).rejects.toMatchObject({
      code: 1, stdout: "", stderr: expect.stringContaining("Allowance not found"),
    });
    expect(await admin.allowanceGrant.count({ where: { studentId: id } })).toBe(0);
  });
});
