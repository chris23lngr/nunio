import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Delegation, Principal } from "./index.js";
import { createDelegation, DefiniteFailure, principal } from "./index.js";

let db: TestDatabase;
/** Seeds fixtures as the migration role, outside RLS. */
let admin: PrismaClient;
/** Connects as the restricted runtime role, as the API and worker do. */
let runtime: PrismaClient;
let delegation: Delegation;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
  runtime = createPrismaClient(createPool(db.runtimeConnectionString));
  delegation = createDelegation({ db: runtime, aiEnabled: () => true });
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

async function student({
  limit,
  revoked = false,
}: {
  limit: number;
  revoked?: boolean;
}): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({
    data: {
      id,
      name: "Student",
      email: `${id}@example.com`,
      emailVerified: true,
    },
  });
  await admin.pilotEntitlement.create({
    data: {
      studentId: id,
      ...(revoked && { revokedAt: new Date(), revokedBy: "founder" }),
    },
  });
  await admin.allowance.create({
    data: { studentId: id, limitMicroUsd: limit },
  });
  return principal.fromSession({ studentId: id });
}

describe("meter", () => {
  it("charges a call's actual usage, not its estimate, to the student's Allowance", async () => {
    const p = await student({ limit: 1_000 });

    const result = await delegation.meter(p, { microUsd: 300 }, async () => ({
      value: "summary",
      usage: { microUsd: 120 },
    }));

    expect(result).toEqual({
      status: "ok",
      value: "summary",
      usage: { microUsd: 120 },
    });
    expect(await delegation.allowance(p)).toEqual({
      limitMicroUsd: 1_000,
      usedMicroUsd: 120,
      heldMicroUsd: 0,
    });
  });

  it("never lets concurrent calls overspend one Allowance", async () => {
    const p = await student({ limit: 1_000 });
    let calls = 0;
    const call = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { value: "ok", usage: { microUsd: 100 } };
    };

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        delegation.meter(p, { microUsd: 100 }, call),
      ),
    );

    expect(results.filter((r) => r.status === "ok")).toHaveLength(10);
    expect(results.filter((r) => r.status === "refused")).toEqual(
      Array(10).fill({ status: "refused", reason: "allowance_exhausted" }),
    );
    expect(calls).toBe(10);
    expect(await delegation.allowance(p)).toEqual({
      limitMicroUsd: 1_000,
      usedMicroUsd: 1_000,
      heldMicroUsd: 0,
    });
  });

  it("keeps the reservation held when a call times out after it was sent", async () => {
    const p = await student({ limit: 1_000 });
    const sentThenHung = (signal: AbortSignal) =>
      new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      );

    await expect(
      delegation.meter(p, { microUsd: 300 }, sentThenHung, { timeoutMs: 50 }),
    ).rejects.toThrow();

    expect(await delegation.allowance(p)).toEqual({
      limitMicroUsd: 1_000,
      usedMicroUsd: 0,
      heldMicroUsd: 300,
    });
  });

  it("lists each call of unknown outcome as a held reservation, and only those", async () => {
    const p = await student({ limit: 1_000 });
    const sentThenHung = (signal: AbortSignal) =>
      new Promise<never>((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      );
    const before = new Date();

    await delegation.meter(p, { microUsd: 100 }, async () => ({
      value: "ok",
      usage: { microUsd: 40 },
    }));
    await delegation
      .meter(p, { microUsd: 300 }, sentThenHung, { timeoutMs: 50 })
      .catch(() => undefined);

    const held = await delegation.held(p);
    expect(held).toEqual([
      {
        id: expect.any(String),
        estimateMicroUsd: 300,
        reservedAt: expect.any(Date),
      },
    ]);
    expect(held[0]!.reservedAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1_000,
    );
  });

  it("releases the reservation when the call definitely did not incur usage", async () => {
    const p = await student({ limit: 1_000 });
    const rejected = async () => {
      throw new DefiniteFailure("provider rejected the request (400)");
    };

    await expect(
      delegation.meter(p, { microUsd: 300 }, rejected),
    ).rejects.toThrow(DefiniteFailure);

    expect(await delegation.allowance(p)).toEqual({
      limitMicroUsd: 1_000,
      usedMicroUsd: 0,
      heldMicroUsd: 0,
    });
  });

  it("refuses new calls while the AI kill switch is on, without breaking reads", async () => {
    const p = await student({ limit: 1_000 });
    const killed = createDelegation({ db: runtime, aiEnabled: () => false });
    let called = false;

    const result = await killed.meter(p, { microUsd: 100 }, async () => {
      called = true;
      return { value: "ok", usage: { microUsd: 100 } };
    });

    expect(result).toEqual({ status: "refused", reason: "ai_disabled" });
    expect(called).toBe(false);
    expect(await killed.allowance(p)).toEqual({
      limitMicroUsd: 1_000,
      usedMicroUsd: 0,
      heldMicroUsd: 0,
    });
  });

  it("refuses a student whose pilot access was revoked, even with Allowance left", async () => {
    const p = await student({ limit: 1_000, revoked: true });
    let called = false;

    const result = await delegation.meter(p, { microUsd: 100 }, async () => {
      called = true;
      return { value: "ok", usage: { microUsd: 100 } };
    });

    expect(result).toEqual({ status: "refused", reason: "not_entitled" });
    expect(called).toBe(false);
  });
});

it("refuses new AI calls after a deletion request without reserving usage", async () => {
  const p = await student({ limit: 1_000 });
  if (p.kind !== "student") throw new Error("student");
  await admin.deletionRequest.create({ data: { studentId: p.studentId } });
  let called = false;
  expect(
    await delegation.meter(p, { microUsd: 100 }, async () => {
      called = true;
      return { value: "unexpected", usage: { microUsd: 100 } };
    }),
  ).toEqual({ status: "refused", reason: "deletion_pending" });
  expect(called).toBe(false);
  expect((await delegation.allowance(p)).heldMicroUsd).toBe(0);
});
