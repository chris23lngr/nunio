import { randomUUID } from "node:crypto";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { principal, withOwner } from "./index.js";

let db: TestDatabase;
/** Seeds fixtures as the migration role, outside RLS. */
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

async function student({ entitled = true } = {}): Promise<string> {
  const id = randomUUID();
  await admin.user.create({ data: { id, name: "Student", email: `${id}@example.com`, emailVerified: true } });
  if (entitled) await admin.pilotEntitlement.create({ data: { studentId: id } });
  return id;
}

describe("withOwner under the runtime role", () => {
  it("shows a student only their own rows", async () => {
    const a = await student();
    const b = await student();

    const visible = await withOwner(runtime, principal.fromSession({ studentId: a }), tx =>
      tx.pilotEntitlement.findMany({ select: { studentId: true } }));

    expect(visible).toEqual([{ studentId: a }]);
    expect(visible).not.toContainEqual({ studentId: b });
  });

  it("lets a student create their own rows but not another student's", async () => {
    const a = await student({ entitled: false });
    const b = await student({ entitled: false });
    const asA = principal.fromSession({ studentId: a });

    await withOwner(runtime, asA, tx => tx.pilotEntitlement.create({ data: { studentId: a } }));
    await expect(withOwner(runtime, asA, tx => tx.pilotEntitlement.create({ data: { studentId: b } })))
      .rejects.toThrow(/row-level security/);

    const rows = await admin.pilotEntitlement.findMany({ where: { studentId: { in: [a, b] } } });
    expect(rows.map(row => row.studentId)).toEqual([a]);
  });

  it("never leaks one student's owner context to another request on a pooled connection", async () => {
    const a = await student();
    const b = await student();
    const seen = (id: string) => withOwner(runtime, principal.fromSession({ studentId: id }), async tx => {
      await tx.$executeRaw`SELECT pg_sleep(0.01)`;
      return tx.pilotEntitlement.findMany({ select: { studentId: true } });
    });

    // More concurrent transactions than the pool holds, so connections are reused across students.
    const ids = Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b));
    const results = await Promise.all(ids.map(seen));
    results.forEach((visible, i) => expect(visible).toEqual([{ studentId: ids[i] }]));

    const outside = await Promise.all(ids.map(() => runtime.pilotEntitlement.findMany()));
    expect(outside.flat()).toEqual([]);
  });

  it("refuses a run Principal: a run ID alone grants no authority", async () => {
    await expect(withOwner(runtime, principal.fromRun(randomUUID()), tx => tx.pilotEntitlement.findMany()))
      .rejects.toThrow(/not authorized/);
  });

  it("accepts only minted Principals", () => {
    // Checked by tsc, never run.
    const forged = () =>
      // @ts-expect-error A caller-built object carries no authority.
      withOwner(runtime, { kind: "student", studentId: randomUUID() }, async () => {});
    expect(forged).toBeTypeOf("function");
  });
});
