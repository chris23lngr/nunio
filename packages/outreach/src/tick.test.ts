import { randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Principal } from "@nunio/delegation";
import { createDelegation, principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import type { Facts } from "@nunio/knowledge";
import { createFacts } from "@nunio/knowledge";
import type { Plan } from "@nunio/planning";
import { createPlan } from "@nunio/planning";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Outreach } from "./index.js";
import { createOutreach, NotOpenError } from "./index.js";

let db: TestDatabase;
/** Seeds fixtures as the migration role, outside RLS. */
let admin: PrismaClient;
/** Connects as the restricted runtime role, as the API and worker do. */
let runtime: PrismaClient;
let facts: Facts;
let plan: Plan;
let outreach: Outreach;
/** A Berlin wall-clock time in November (CET, UTC+1). */
const at = (local: string) => new Date(`${local.replace(" ", "T")}:00+01:00`);
let now = at("2026-11-09 08:00");
const clock = { now: () => now };

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
  runtime = createPrismaClient(createPool(db.runtimeConnectionString));
  facts = createFacts({
    db: runtime,
    keys: createSourceKeys({
      activeVersion: "v1",
      masters: { v1: randomBytes(32) },
    }),
    clock,
  });
  plan = createPlan({ db: runtime, facts, clock });
  outreach = createOutreach({
    db: runtime,
    clock,
    plan,
    facts,
    delegation: createDelegation({ db: runtime, aiEnabled: () => true }),
  });
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

async function student(): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({
    data: { id, email: `${id}@example.com`, name: "Student" },
  });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  return principal.fromSession({ studentId: id });
}

/** An Obligation due tomorrow at noon whose Estimate decides whether there is a Shortfall. */
async function dueTomorrow(p: Principal, minutes: number) {
  const entered = await facts.enterObligation(p, {
    course: { title: "Analysis I", code: "MA-101" },
    kind: "assignment",
    title: "Problem sheet 3",
    due: { date: "2026-11-10", time: "12:00", timeZone: null },
    destination: null,
  });
  if (entered.status !== "ok") throw new Error(entered.status);
  const work = { kind: "obligation" as const, id: entered.id };
  await plan.estimate(p, work, minutes);
  return work;
}

const open = async (p: Principal) =>
  (await outreach.inbox(p)).interventions.filter((i) => i.state === "open");

describe("raising Interventions from their causes", () => {
  it("raises one Intervention for a Shortfall however often it looks", async () => {
    now = at("2026-11-09 08:00");
    const p = await student();
    const work = await dueTomorrow(p, 20 * 60);

    await outreach.tick();
    await outreach.tick();

    expect(await open(p)).toEqual([
      expect.objectContaining({
        kind: "shortfall",
        subject: { kind: "work", id: work.id },
      }),
    ]);
  });

  it("lapses the Intervention once its Shortfall is gone, and raises a new one when it returns", async () => {
    now = at("2026-11-09 08:00");
    const p = await student();
    const work = await dueTomorrow(p, 20 * 60);
    await outreach.tick();
    const [first] = await open(p);

    await plan.estimate(p, work, 30);
    await outreach.tick();
    expect(await open(p)).toEqual([]);

    await plan.estimate(p, work, 20 * 60);
    await outreach.tick();

    const { interventions } = await outreach.inbox(p);
    expect(interventions).toEqual([
      expect.objectContaining({ state: "open", kind: "shortfall" }),
      expect.objectContaining({
        id: first!.id,
        state: "lapsed",
        closedAt: now,
      }),
    ]);
    expect(interventions[0]!.id).not.toBe(first!.id);
  });

  it.each(["acknowledged", "dismissed"] as const)(
    "raises nothing for a Shortfall that continues after it was %s, until it ends and returns",
    async (as) => {
      now = at("2026-11-09 08:00");
      const p = await student();
      const work = await dueTomorrow(p, 20 * 60);
      await outreach.tick();
      const [first] = await open(p);
      await outreach.close(p, first!.id, as);

      await plan.estimate(p, work, 22 * 60);
      await outreach.tick();
      expect(await open(p)).toEqual([]);

      await plan.estimate(p, work, 30);
      await outreach.tick();
      await plan.estimate(p, work, 20 * 60);
      await outreach.tick();

      const { interventions } = await outreach.inbox(p);
      expect(interventions.map((i) => i.state)).toEqual(["open", as]);
    },
  );

  it("raises an Intervention for an Unconfirmed Action, which lapses once the student resolves it", async () => {
    now = at("2026-11-09 08:00");
    const p = await student();
    const actionId = randomUUID();
    await admin.action.create({
      data: {
        id: actionId,
        studentId: p.kind === "student" ? p.studentId : "",
        key: `chat:${actionId}`,
        kind: "studyBlock.create",
        args: {},
        status: "unconfirmed",
      },
    });
    await outreach.tick();
    expect(await open(p)).toEqual([
      expect.objectContaining({
        kind: "unconfirmed",
        subject: { kind: "action", id: actionId },
      }),
    ]);

    await admin.action.update({
      where: { id: actionId },
      data: { status: "done" },
    });
    await outreach.tick();

    expect((await outreach.inbox(p)).interventions).toEqual([
      expect.objectContaining({ kind: "unconfirmed", state: "lapsed" }),
    ]);
  });

  it("does not let the student close a lapsed Intervention", async () => {
    now = at("2026-11-09 08:00");
    const p = await student();
    const work = await dueTomorrow(p, 20 * 60);
    await outreach.tick();
    const [first] = await open(p);
    await plan.estimate(p, work, 30);
    await outreach.tick();

    await expect(outreach.close(p, first!.id, "dismissed")).rejects.toThrow(
      NotOpenError,
    );
  });
});
