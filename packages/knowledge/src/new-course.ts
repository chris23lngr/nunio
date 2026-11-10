import type { Transaction } from "@nunio/delegation";
import { normalize } from "./normalize.js";
import type { Semester } from "./semester.js";

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
