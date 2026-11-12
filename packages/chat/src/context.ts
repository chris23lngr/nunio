import { randomBytes } from "node:crypto";

export type ContextCourse = {
  id: string;
  title: string;
  code: string | null;
  /** A Semester key, such as "2026-ws". */
  semester: string;
};

const semesterName = (semester: string) => {
  const [year, season] = semester.split("-");
  return season === "ws"
    ? `Wintersemester ${year}/${String((Number(year) + 1) % 100).padStart(2, "0")}`
    : `Sommersemester ${year}`;
};

/**
 * What the model needs to read the Plan and a Course's Facts (ADR-0019, ADR-0020): today in the student's time
 * zone, and their Courses under short handles such as K1, which the tools take instead of IDs. Course titles may come
 * from a Source, so the list is fenced as data.
 */
export function chatContext(
  now: Date,
  timeZone: string,
  courses: readonly ContextCourse[],
) {
  const handles = new Map(
    courses.map((course, i) => [`K${i + 1}`, course.id] as const),
  );
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone,
  }).format(now);
  const date = now.toLocaleDateString("en-CA", { timeZone });
  const fence = randomBytes(8).toString("hex");
  const text = [
    `Today is ${day}, ${date}, in the student's time zone ${timeZone}.`,
    courses.length
      ? [
          "The student's Courses, by the handle to name them with in tools:",
          `<<<BEGIN courses ${fence}>>>`,
          ...courses.map(
            (course, i) =>
              `K${i + 1}: ${course.title}${course.code ? ` (${course.code})` : ""}, ${semesterName(course.semester)}`,
          ),
          `<<<END courses ${fence}>>>`,
        ].join("\n")
      : "The student has no Courses yet.",
  ].join("\n");
  return { text, handles };
}
