import { randomUUID } from "node:crypto";
import type { Transaction } from "@nunio/delegation";
import { normalize } from "./normalize.js";
import type { Semester } from "./semester.js";
import { semesterAt } from "./semester.js";

/** The palette a Course's color comes from, by name; how each looks is the client's concern. */
export const courseColors = [
  "rose",
  "orange",
  "amber",
  "emerald",
  "teal",
  "blue",
  "violet",
  "fuchsia",
] as const;
export type CourseColor = (typeof courseColors)[number];

/** What later Sources match a Course by: its code first, then its title. */
export const matchKeys = (title: string, code: string | null) => ({
  matchTitle: normalize(title),
  matchCode: code ? normalize(code) : null,
});

/** A random color for a new Course, from those no other Course in its Semester has while any is free. */
async function newCourseColor(
  tx: Transaction,
  semester: Semester,
): Promise<CourseColor> {
  const taken = new Set(
    (
      await tx.course.findMany({
        where: { semester, status: { in: ["proposed", "accepted"] } },
        select: { color: true },
      })
    ).map((c) => c.color),
  );
  const free = courseColors.filter((color) => !taken.has(color));
  const pool = free.length ? free : courseColors;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/** The fields every new Course gets, however it comes about: its name, match keys, Semester and a color. */
export async function newCourse(
  tx: Transaction,
  course: { title: string; code: string | null; semester: Semester },
) {
  return {
    title: course.title,
    code: course.code,
    ...matchKeys(course.title, course.code),
    semester: course.semester,
    color: await newCourseColor(tx, course.semester),
  };
}

/**
 * The Course a Source is bound to: an accepted, unarchived one, a new one the student names, or none (null), which lets
 * nunio recognize its Courses. A bound Source's extraction puts everything under that Course.
 */
export type CourseChoice =
  | { id: string }
  | { title: string; code: string | null }
  | null;

/**
 * Resolves the student's choice to a Course id, creating a new Course accepted in the current Semester as manual entry
 * does; "gone" for a Course that is not accepted, "course_archived" for an Archived one, "invalid" for an empty title.
 */
export async function chosenCourse(
  tx: Transaction,
  studentId: string,
  choice: CourseChoice,
  now: Date,
): Promise<
  | { status: "ok"; courseId: string | null }
  | { status: "invalid" | "gone" | "course_archived" }
> {
  if (!choice) return { status: "ok", courseId: null };
  if ("id" in choice) {
    const course = await tx.course.findFirst({
      where: { id: choice.id, status: "accepted" },
    });
    if (!course) return { status: "gone" };
    if (course.archivedAt) return { status: "course_archived" };
    return { status: "ok", courseId: course.id };
  }
  const title = choice.title.trim();
  if (!title) return { status: "invalid" };
  const courseId = randomUUID();
  await tx.course.create({
    data: {
      id: courseId,
      studentId,
      status: "accepted",
      enteredAt: now,
      ...(await newCourse(tx, {
        title,
        code: choice.code?.trim() || null,
        semester: semesterAt(now),
      })),
    },
  });
  return { status: "ok", courseId };
}
