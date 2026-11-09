import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { principal } from "@nunio/delegation";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createOutreach,
  NotOpenError,
  UnknownInterventionError,
} from "./index.js";

let db: TestDatabase;
/** Seeds fixtures as the migration role, outside RLS. */
let admin: PrismaClient;
/** Connects as the restricted runtime role, as the API and worker do. */
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

const now = new Date("2026-11-10T07:00:00Z");
const clock = { now: () => now };

function make() {
  return createOutreach({
    db: runtime,
    clock,
    vapidPublicKey: "test-vapid-key",
    unsubscribeSecret: "test-unsubscribe-secret",
  });
}

async function student() {
  const studentId = randomUUID();
  await admin.user.create({
    data: {
      id: studentId,
      name: "Student",
      email: `${studentId}@example.com`,
      emailVerified: true,
    },
  });
  return principal.fromSession({ studentId });
}

/** An Intervention as a Run raises it, for an Action whose Approval expired. */
async function raised(p: ReturnType<typeof principal.fromSession>, at = now) {
  const actionId = randomUUID();
  const id = randomUUID();
  await admin.intervention.create({
    data: {
      id,
      studentId: p.kind === "student" ? p.studentId : "",
      kind: "approval_expired",
      dedupeKey: `approval_expired:${actionId}`,
      actionId,
      createdAt: at,
    },
  });
  return { id, actionId };
}

describe("the Inbox", () => {
  it("records an Acknowledgement apart from a Dismissal, and either closes the Intervention", async () => {
    const outreach = make();
    const p = await student();
    const noted = await raised(p);
    const useless = await raised(p);

    await outreach.close(p, noted.id, "acknowledged");
    await outreach.close(p, useless.id, "dismissed");

    const { interventions } = await outreach.inbox(p);
    expect(interventions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: noted.id,
          state: "acknowledged",
          closedAt: now,
        }),
        expect.objectContaining({
          id: useless.id,
          state: "dismissed",
          closedAt: now,
        }),
      ]),
    );
  });

  it("closes an Intervention only once, keeping how it was first closed", async () => {
    const outreach = make();
    const p = await student();
    const { id } = await raised(p);
    await outreach.close(p, id, "acknowledged");

    await expect(outreach.close(p, id, "dismissed")).rejects.toThrow(
      NotOpenError,
    );

    const { interventions } = await outreach.inbox(p);
    expect(interventions).toEqual([
      expect.objectContaining({ id, state: "acknowledged" }),
    ]);
  });

  it("lists open Interventions first, newest first, then closed ones", async () => {
    const outreach = make();
    const p = await student();
    const oldest = await raised(p, new Date("2026-11-08T07:00:00Z"));
    const closed = await raised(p, new Date("2026-11-09T07:00:00Z"));
    const newest = await raised(p, new Date("2026-11-09T08:00:00Z"));
    await outreach.close(p, closed.id, "acknowledged");

    const { interventions } = await outreach.inbox(p);

    expect(interventions.map((i) => i.id)).toEqual([
      newest.id,
      oldest.id,
      closed.id,
    ]);
  });

  it("neither shows nor closes another student's Intervention", async () => {
    const outreach = make();
    const owner = await student();
    const other = await student();
    const { id } = await raised(owner);

    await expect(outreach.close(other, id, "dismissed")).rejects.toThrow(
      UnknownInterventionError,
    );

    expect((await outreach.inbox(other)).interventions).toEqual([]);
    expect((await outreach.inbox(owner)).interventions).toEqual([
      expect.objectContaining({ id, state: "open", closedAt: null }),
    ]);
  });
});
