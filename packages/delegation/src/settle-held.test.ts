import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDelegation, principal, type Delegation, type Principal } from "./index.js";

const execute = promisify(execFile);

let db: TestDatabase;
/** Seeds fixtures as the migration role. */
let admin: PrismaClient;
let runtime: PrismaClient;
let delegation: Delegation;
/** An operator login with neither superuser nor BYPASSRLS, so forced RLS applies to it. */
let operatorURL: string;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
  runtime = createPrismaClient(createPool(db.runtimeConnectionString));
  delegation = createDelegation({ db: runtime, aiEnabled: () => true });
  const user = `nunio_operator_test_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  await admin.$executeRawUnsafe(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${user}`);
  await admin.$executeRawUnsafe(
    `GRANT SELECT, UPDATE ("status", "actualMicroUsd", "settledAt", "settledBy") ON "usage_reservation" TO ${user}`);
  await admin.$executeRawUnsafe(
    `GRANT SELECT, UPDATE ("usedMicroUsd", "heldMicroUsd", "updatedAt") ON "allowance" TO ${user}`);
  const url = new URL(db.connectionString);
  url.username = user;
  url.password = password;
  operatorURL = url.toString();
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

function settleHeld(studentId: string, reservationId: string, usd: string, operator = "founder") {
  const script = fileURLToPath(new URL("./settle-held.ts", import.meta.url));
  return execute(process.execPath, [script, studentId, reservationId, usd], {
    env: { PATH: process.env.PATH, OPERATOR_DATABASE_URL: operatorURL, OPERATOR_ID: operator },
  });
}

/** A student with one call of unknown outcome, held at an estimate of $0.0003. */
async function studentWithHeldCall(): Promise<{ id: string; p: Principal; reservationId: string }> {
  const id = randomUUID();
  await admin.user.create({ data: { id, name: "Student", email: `${id}@example.com`, emailVerified: true } });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  await admin.allowance.create({ data: { studentId: id, limitMicroUsd: 1_000 } });
  const p = principal.fromSession({ studentId: id });
  const sentThenHung = (signal: AbortSignal) => new Promise<never>((_, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason)));
  await delegation.meter(p, { microUsd: 300 }, sentThenHung, { timeoutMs: 50 }).catch(() => undefined);
  const [held] = await delegation.held(p);
  return { id, p, reservationId: held!.id };
}

describe("settle-held under a least-privilege operator role", () => {
  it("charges a held call at the cost the founder found, and frees the rest of its estimate", async () => {
    const { id, p, reservationId } = await studentWithHeldCall();

    const { stdout } = await settleHeld(id, reservationId, "0.00012");

    expect(JSON.parse(stdout)).toMatchObject({
      reservationId, studentId: id, estimateMicroUsd: 300, actualMicroUsd: 120, settledBy: "founder",
    });
    expect(await delegation.held(p)).toEqual([]);
    expect(await delegation.allowance(p)).toEqual({ limitMicroUsd: 1_000, usedMicroUsd: 120, heldMicroUsd: 0 });
  });

  it("releases a held call the provider never charged", async () => {
    const { id, p, reservationId } = await studentWithHeldCall();

    const { stdout } = await settleHeld(id, reservationId, "0");

    expect(JSON.parse(stdout)).toMatchObject({ status: "released", actualMicroUsd: 0 });
    expect(await delegation.allowance(p)).toEqual({ limitMicroUsd: 1_000, usedMicroUsd: 0, heldMicroUsd: 0 });
  });

  it("never charges twice: a repeat, or another student's ID, finds no held reservation", async () => {
    const { id, p, reservationId } = await studentWithHeldCall();
    const other = await studentWithHeldCall();
    await settleHeld(id, reservationId, "0.0001");

    for (const [studentId, reservation] of [[id, reservationId], [other.id, reservationId]] as const) {
      await expect(settleHeld(studentId, reservation, "0.0002")).rejects.toMatchObject({
        code: 1, stdout: "", stderr: expect.stringContaining("Held reservation not found"),
      });
    }
    expect(await delegation.allowance(p)).toEqual({ limitMicroUsd: 1_000, usedMicroUsd: 100, heldMicroUsd: 0 });
    expect(await delegation.held(other.p)).toHaveLength(1);
  });
});
