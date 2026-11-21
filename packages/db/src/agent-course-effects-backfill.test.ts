import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "./index.js";
import { createPool, createPrismaClient } from "./index.js";
import type { TestDatabase } from "./testing.js";
import { startTestDatabase } from "./testing.js";

let db: TestDatabase;
/** Seeds fixtures and runs the migration as the migration role. */
let admin: PrismaClient;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
}, 180_000);

afterAll(async () => {
  await admin?.$disconnect();
  await db?.stop();
});

const migration = readFileSync(
  new URL(
    "../prisma/migrations/20261208100000_agent_course_effects/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("bringing existing Agents in line with their Courses", () => {
  it("moves entries on merged Courses, drops those on Rejected ones, and pauses an active free-text Agent left with none to act for, withdrawing its open Approvals", async () => {
    const studentId = randomUUID();
    await admin.user.create({
      data: { id: studentId, name: "Student", email: `${studentId}@x.com` },
    });
    const course = async (
      title: string,
      data: {
        status?: "accepted" | "merged" | "rejected";
        archivedAt?: Date;
        mergedIntoId?: string;
      } = {},
    ) => {
      const id = randomUUID();
      await admin.course.create({
        data: {
          id,
          studentId,
          title,
          matchTitle: title.toLowerCase(),
          semester: "2026-ws",
          color: "violet",
          status: data.status ?? "accepted",
          archivedAt: data.archivedAt ?? null,
          mergedIntoId: data.mergedIntoId ?? null,
        },
      });
      return id;
    };
    const agent = async (
      courseIds: string[],
      {
        preset,
        ...data
      }: {
        preset?: string;
        state?: "paused";
        pausedBy?: string;
      } = {},
    ) => {
      const id = randomUUID();
      await admin.agent.create({
        data: { id, studentId, budgetMicroUsd: 1_000_000, ...data },
      });
      // The column the Agents cutover dropped, put back as a preset had it then.
      await admin.$executeRaw`ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "preset" TEXT`;
      if (preset)
        await admin.$executeRaw`UPDATE "agent" SET "preset" = ${preset} WHERE "id" = ${id}`;
      await admin.agentCourse.createMany({
        data: courseIds.map((courseId) => ({
          agentId: id,
          courseId,
          studentId,
        })),
      });
      return id;
    };
    const statistics = await course("Statistics II");
    const merged = await course("Statistik II", {
      status: "merged",
      mergedIntoId: statistics,
    });
    const rejected = await course("Verworfen", { status: "rejected" });
    const archived = await course("Alt", { archivedAt: new Date() });

    const moved = await agent([merged]);
    const both = await agent([merged, statistics]);
    const dropped = await agent([rejected]);
    const allArchived = await agent([archived, rejected]);
    const oneLeft = await agent([archived, statistics]);
    const byStudent = await agent([rejected], {
      state: "paused",
      pausedBy: "student",
    });
    const preset = await agent([], { preset: "keep_course_organized" });
    // An open Approval of a Run of the Agent that loses its last Course, and one already decided.
    const runId = randomUUID();
    await admin.run.create({
      data: { id: runId, studentId, agentId: dropped, status: "done" },
    });
    const asked = async (decision: string | null) => {
      const id = randomUUID();
      await admin.action.create({
        data: {
          id,
          studentId,
          runId,
          key: `${runId}:1:${id}`,
          kind: "studyBlock.create",
          args: {},
          status: decision ? "done" : "awaiting_approval",
        },
      });
      await admin.approval.create({
        data: {
          id: randomUUID(),
          studentId,
          actionId: id,
          fingerprint: "f",
          expiresAt: new Date(Date.now() + 86_400_000),
          decision,
        },
      });
      return id;
    };
    const open = await asked(null);
    const approved = await asked("approve");

    await admin.$executeRawUnsafe(migration);

    const agents = await admin.agent.findMany({
      where: { studentId },
      include: { courses: true },
    });
    const of = (id: string) => {
      const r = agents.find((a) => a.id === id)!;
      return {
        state: r.state,
        pausedBy: r.pausedBy,
        courses: r.courses.map((c) => c.courseId).sort(),
      };
    };
    expect(of(moved)).toEqual({
      state: "active",
      pausedBy: null,
      courses: [statistics],
    });
    expect(of(both)).toEqual({
      state: "active",
      pausedBy: null,
      courses: [statistics],
    });
    expect(of(dropped)).toEqual({
      state: "paused",
      pausedBy: "no_course",
      courses: [],
    });
    expect(of(allArchived)).toEqual({
      state: "paused",
      pausedBy: "course_archived",
      courses: [archived],
    });
    expect(of(oneLeft)).toEqual({
      state: "active",
      pausedBy: null,
      courses: [archived, statistics].sort(),
    });
    expect(of(byStudent)).toEqual({
      state: "paused",
      pausedBy: "student",
      courses: [],
    });
    expect(of(preset)).toEqual({
      state: "active",
      pausedBy: null,
      courses: [],
    });
    const actions = await admin.action.findMany({
      where: { id: { in: [open, approved] } },
      select: { id: true, status: true, refusal: true, events: true },
    });
    expect(actions.find((a) => a.id === open)).toMatchObject({
      status: "refused",
      refusal: "approval_withdrawn",
      events: [
        expect.objectContaining({
          type: "refused",
          detail: { reason: "approval_withdrawn" },
        }),
      ],
    });
    expect(actions.find((a) => a.id === approved)).toMatchObject({
      status: "done",
      refusal: null,
      events: [],
    });
  });
});
