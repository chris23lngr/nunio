import { randomBytes, randomUUID } from "node:crypto";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { principal, type Principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { createFacts, type Facts } from "@nunio/knowledge";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPlan, type Plan } from "./plan.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
let facts: Facts;
let plan: Plan;
/** A Berlin wall-clock time in November (CET, UTC+1). */
const at = (local: string) => new Date(`${local.replace(" ", "T")}:00+01:00`);
let now = at("2026-11-09 08:00");
const clock = { now: () => now };

beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
  facts = createFacts({ db: runtime, keys: createSourceKeys({ activeVersion: "v1", masters: { v1: randomBytes(32) } }), clock });
  plan = createPlan({ db: runtime, facts, clock });
}, 180_000);
afterAll(async () => { await runtime?.$disconnect(); await admin?.$disconnect(); await database?.stop(); });

async function student(): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({ data: { id, email: `${id}@example.com`, name: "Student" } });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  return principal.fromSession({ studentId: id });
}

/** Enters an Obligation under a new accepted Course through the Facts interface, returning its id. */
async function obligation(p: Principal, title: string, date: string, time: string | null) {
  const entered = await facts.enterObligation(p, { course: { title: "Analysis I", code: "MA-101" }, kind: "assignment", title,
    due: { date, time, timeZone: null }, destination: null });
  if (entered.status !== "ok") throw new Error(entered.status);
  return entered.id;
}

it("proposes Study Blocks before an Obligation's deadline from the student's own Estimate", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");

  expect(await plan.estimate(p, { kind: "obligation", id: sheet }, 120)).toEqual({ status: "ok" });
  const view = await plan.view(p);

  expect(view.obligations).toEqual([expect.objectContaining({ id: sheet, title: "Blatt 3", due: at("2026-11-11 12:00"),
    estimate: { minutes: 120, estimatedBy: "student", rationale: null } })]);
  expect(view.proposal.moves).toEqual([
    { kind: "create", workId: sheet, start: at("2026-11-09 09:00"), end: at("2026-11-09 11:00"), needsApproval: false },
  ]);
});

it("applies a move only while it matches a fresh proposal", async () => {
  now = at("2026-11-09 08:00");
  const p = await student();
  const sheet = await obligation(p, "Blatt 3", "2026-11-11", "12:00");
  await plan.estimate(p, { kind: "obligation", id: sheet }, 120);
  const [move] = (await plan.view(p)).proposal.moves;
  const forged = { kind: "create" as const, workId: sheet, start: at("2026-11-10 09:00"), end: at("2026-11-10 17:00"), needsApproval: false };

  expect(await plan.apply(p, forged)).toEqual({ status: "stale" });
  expect(await plan.apply(p, move!)).toEqual({ status: "ok" });
  expect(await plan.apply(p, move!)).toEqual({ status: "stale" });

  const view = await plan.view(p);
  expect(view.studyBlocks).toEqual([{ id: expect.any(String), work: { kind: "obligation", id: sheet },
    start: at("2026-11-09 09:00"), end: at("2026-11-09 11:00"), placedBy: "nunio", locked: false }]);
  expect(view.proposal.moves).toEqual([]);
});
