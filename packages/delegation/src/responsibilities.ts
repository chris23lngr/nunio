import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { Clock } from "./gate.js";
import type { Kind } from "./kinds.js";
import type { Principal } from "./principal.js";
import { principal as mint, withOwner } from "./principal.js";

/**
 * The Temporal Schedules that start a Responsibility's Runs (ADR-0006). A port, because `delegation` never imports
 * Temporal; each call must be idempotent, so a repeated pause or end is harmless.
 */
export interface Schedules {
  create(r: {
    responsibilityId: string;
    studentId: string;
    timeZone: string;
  }): Promise<void>;
  pause(responsibilityId: string): Promise<void>;
  unpause(responsibilityId: string): Promise<void>;
  delete(responsibilityId: string): Promise<void>;
}

/** The pilot presets and the Grants each holds on its scope. */
const presets = {
  keep_course_organized: ["studyBlock.create", "studyBlock.move"] as Kind[],
};
export type Preset = keyof typeof presets;

/** Ongoing delegations the student owns: records plus the Schedules that start their Runs. */
export function createResponsibilities({
  db,
  schedules,
  clock,
}: {
  db: PrismaClient;
  /** Needed only to create, pause, resume or end; the worker only starts Runs. */
  schedules?: Schedules;
  clock: Clock;
}) {
  const scheduled = () => {
    if (!schedules)
      throw new Error(
        "createResponsibilities needs schedules to change a Responsibility",
      );
    return schedules;
  };
  return {
    async create(
      p: Principal,
      input: {
        preset: "keep_course_organized";
        courseId: string;
        budgetMicroUsd: number;
      },
    ) {
      return withOwner(db, p, async (tx, studentId) => {
        if (
          !(await tx.course.findFirst({
            where: { id: input.courseId, status: { not: "merged" } },
          }))
        ) {
          return { status: "gone" } as const;
        }
        const id = randomUUID();
        await tx.responsibility.create({
          data: {
            id,
            studentId,
            preset: input.preset,
            courseId: input.courseId,
            budgetMicroUsd: input.budgetMicroUsd,
          },
        });
        await tx.grant.createMany({
          data: presets[input.preset].map((kind) => ({
            id: randomUUID(),
            studentId,
            responsibilityId: id,
            kind,
            courseId: input.courseId,
          })),
        });
        const timeZone =
          (await tx.planPreference.findFirst())?.timeZone ?? "Europe/Berlin";
        // Inside the transaction: if the Schedule cannot be created, no Responsibility is recorded.
        await scheduled().create({ responsibilityId: id, studentId, timeZone });
        return { status: "ok", id } as const;
      });
    },

    /** Takes no further Actions, including in a Run under way, while keeping its Grants. */
    async pause(p: Principal, id: string) {
      const found = await withOwner(db, p, async (tx) => {
        await tx.responsibility.updateMany({
          where: { id, state: "active" },
          data: { state: "paused", pausedBy: "student" },
        });
        return (
          (await tx.responsibility.findUnique({ where: { id } }))?.state ===
          "paused"
        );
      });
      if (!found) return { status: "gone" } as const;
      // After the commit: the record is what the gate checks, so a Run firing meanwhile is refused anyway.
      await scheduled().pause(id);
      return { status: "ok" } as const;
    },

    /** Only the student resumes a Paused Responsibility, whoever paused it. */
    async resume(p: Principal, id: string) {
      const found = await withOwner(db, p, async (tx) => {
        await tx.responsibility.updateMany({
          where: { id, state: "paused" },
          data: { state: "active", pausedBy: null },
        });
        return (
          (await tx.responsibility.findUnique({ where: { id } }))?.state ===
          "active"
        );
      });
      if (!found) return { status: "gone" } as const;
      // A Budget pause leaves the Schedule running (its Runs start nothing), so unpausing is always safe.
      await scheduled().unpause(id);
      return { status: "ok" } as const;
    },

    /** Stops for good: its Grants are gone and its history remains. */
    async end(p: Principal, id: string) {
      const found = await withOwner(db, p, async (tx) => {
        await tx.responsibility.updateMany({
          where: { id, state: { not: "ended" } },
          data: { state: "ended", endedAt: clock.now() },
        });
        await tx.grant.deleteMany({ where: { responsibilityId: id } });
        return Boolean(await tx.responsibility.findUnique({ where: { id } }));
      });
      if (!found) return { status: "gone" } as const;
      await scheduled().delete(id);
      return { status: "ok" } as const;
    },

    /** Its scope, state, Grants, and usage against its Budget; null when it is not the student's. */
    async view(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        const r = await tx.responsibility.findUnique({
          where: { id },
          include: { grants: true },
        });
        if (!r) return null;
        return {
          id: r.id,
          preset: r.preset as Preset,
          scope: { courseId: r.courseId },
          state: r.state as "active" | "paused" | "ended",
          pausedBy: r.pausedBy as "student" | "budget" | null,
          grants: r.grants.map((g) => ({
            kind: g.kind as Kind,
            courseId: g.courseId,
          })),
          budget: {
            limitMicroUsd: Number(r.budgetMicroUsd),
            usedMicroUsd: Number(r.usedMicroUsd),
            heldMicroUsd: Number(r.heldMicroUsd),
          },
        };
      });
    },

    /** Records a Run of an active Responsibility, as its Schedule fires; null when it is not active. */
    async startRun({
      studentId,
      responsibilityId,
    }: {
      studentId: string;
      responsibilityId: string;
    }) {
      return withOwner(db, mint.fromSession({ studentId }), async (tx) => {
        const responsibility = await tx.responsibility.findUnique({
          where: { id: responsibilityId },
        });
        if (responsibility?.state !== "active") return null;
        const run = await tx.run.create({
          data: { id: randomUUID(), studentId, responsibilityId },
        });
        return run.id;
      });
    },
  };
}
export type Responsibilities = ReturnType<typeof createResponsibilities>;
