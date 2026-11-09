import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type { Principal, Transaction } from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";

type Relations = { courseIds: string[]; obligationId: string | null };

/** Projects: optional workspaces over the student's Courses, optionally toward one Obligation. */
export function createProjects({ db }: { db: PrismaClient }) {
  /** RLS hides another student's rows, so a foreign ID counts as gone like a deleted one. */
  const owned = async (
    tx: Transaction,
    { courseIds, obligationId }: Relations,
  ) =>
    (await tx.course.count({
      where: { id: { in: courseIds }, status: { not: "merged" } },
    })) === new Set(courseIds).size &&
    (!obligationId ||
      Boolean(await tx.obligation.findUnique({ where: { id: obligationId } })));
  const relateCourses = (
    tx: Transaction,
    projectId: string,
    studentId: string,
    courseIds: string[],
  ) =>
    tx.projectCourse.createMany({
      data: [...new Set(courseIds)].map((courseId) => ({
        projectId,
        courseId,
        studentId,
      })),
    });
  const nameOf = (name: string) => {
    const trimmed = name.trim();
    return trimmed && trimmed.length <= 255 ? trimmed : null;
  };
  return {
    async list(p: Principal) {
      return withOwner(db, p, async (tx) =>
        (
          await tx.project.findMany({
            orderBy: { createdAt: "asc" },
            include: { courses: true },
          })
        ).map((project) => ({
          id: project.id,
          name: project.name,
          courseIds: project.courses.map((c) => c.courseId).sort(),
          obligationId: project.obligationId,
        })),
      );
    },
    async create(p: Principal, input: { name: string } & Relations) {
      const name = nameOf(input.name);
      if (!name) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx, studentId) => {
        if (!(await owned(tx, input))) return { status: "gone" } as const;
        const project = await tx.project.create({
          data: {
            id: randomUUID(),
            studentId,
            name,
            obligationId: input.obligationId,
          },
        });
        await relateCourses(tx, project.id, studentId, input.courseIds);
        return { status: "ok", id: project.id } as const;
      });
    },
    async rename(p: Principal, id: string, newName: string) {
      const name = nameOf(newName);
      if (!name) return { status: "invalid" } as const;
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.project.updateMany({
          where: { id },
          data: { name },
        });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
    /** Replaces the Project's Courses and Obligation. */
    async relate(p: Principal, id: string, relations: Relations) {
      return withOwner(db, p, async (tx, studentId) => {
        if (
          !(await tx.project.findUnique({ where: { id } })) ||
          !(await owned(tx, relations))
        )
          return { status: "gone" } as const;
        await tx.project.update({
          where: { id },
          data: { obligationId: relations.obligationId },
        });
        await tx.projectCourse.deleteMany({ where: { projectId: id } });
        await relateCourses(tx, id, studentId, relations.courseIds);
        return { status: "ok" } as const;
      });
    },
    async remove(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.project.deleteMany({ where: { id } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
  };
}
export type Projects = ReturnType<typeof createProjects>;
