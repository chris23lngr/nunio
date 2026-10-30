import { randomUUID } from "node:crypto";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import pg from "pg";
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
    const singleConnection = createPrismaClient(new pg.Pool({ connectionString: db.runtimeConnectionString, max: 1 }));
    try {
      const backends: number[] = [];
      for (const id of [a, b, a, b]) {
        const visible = await withOwner(singleConnection, principal.fromSession({ studentId: id }), async tx => {
          const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          backends.push(backend!.pid);
          return tx.pilotEntitlement.findMany({ select: { studentId: true } });
        });
        expect(visible).toEqual([{ studentId: id }]);
        expect(await singleConnection.pilotEntitlement.findMany()).toEqual([]);
      }
      expect(new Set(backends).size).toBe(1);
    } finally {
      await singleConnection.$disconnect();
    }
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
