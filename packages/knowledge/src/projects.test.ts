import { randomBytes, randomUUID } from "node:crypto";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { startTestDatabase, type TestDatabase } from "@nunio/db/testing";
import { principal, type Principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createFacts, type Facts } from "./facts.js";
import { createProjects, type Projects } from "./projects.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
let facts: Facts;
let projects: Projects;

beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
  facts = createFacts({ db: runtime, keys: createSourceKeys({ activeVersion: "v1", masters: { v1: randomBytes(32) } }), clock: { now: () => new Date() } });
  projects = createProjects({ db: runtime });
}, 180_000);
afterAll(async () => { await runtime?.$disconnect(); await admin?.$disconnect(); await database?.stop(); });

async function student(): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({ data: { id, email: `${id}@example.com`, name: "Student" } });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  return principal.fromSession({ studentId: id });
}

/** An entered exam under a new accepted Course, returning both ids. */
async function exam(p: Principal, course: string) {
  const entered = await facts.enterObligation(p, { course: { title: course, code: null }, kind: "exam", title: "Klausur",
    due: { date: "2027-02-12", time: null, timeZone: null }, destination: null });
  if (entered.status !== "ok") throw new Error(entered.status);
  const courseId = (await facts.review(p)).courses.find(c => c.title === course)!.id;
  return { courseId, obligationId: entered.id };
}

it("creates, renames, relates and deletes a Project over the student's own Courses and Obligation", async () => {
  const p = await student();
  const analysis = await exam(p, "Analysis I");
  const algebra = await exam(p, "Lineare Algebra");

  const created = await projects.create(p, { name: "Klausurvorbereitung", courseIds: [analysis.courseId], obligationId: analysis.obligationId });
  if (created.status !== "ok") throw new Error(created.status);
  expect(await projects.rename(p, created.id, "Prüfungsphase")).toEqual({ status: "ok" });
  expect(await projects.relate(p, created.id, { courseIds: [analysis.courseId, algebra.courseId], obligationId: null })).toEqual({ status: "ok" });
  expect(await projects.list(p)).toEqual([{ id: created.id, name: "Prüfungsphase", courseIds: [analysis.courseId, algebra.courseId].sort(),
    obligationId: null }]);

  const stranger = await student();
  expect(await projects.create(stranger, { name: "Fremd", courseIds: [analysis.courseId], obligationId: null })).toEqual({ status: "gone" });
  expect(await projects.rename(stranger, created.id, "Fremd")).toEqual({ status: "gone" });
  expect(await projects.create(p, { name: "  ", courseIds: [], obligationId: null })).toEqual({ status: "invalid" });
  expect(await projects.remove(p, created.id)).toEqual({ status: "ok" });
  expect(await projects.list(p)).toEqual([]);
});
