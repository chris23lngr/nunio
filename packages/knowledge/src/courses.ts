import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import type {
  Principal,
  Responsibilities,
  Transaction,
} from "@nunio/delegation";
import { withOwner } from "@nunio/delegation";
import type { Facts } from "./facts.js";
import type { CourseColor } from "./new-course.js";
import { courseColors, matchKeys, newCourse } from "./new-course.js";
import type { Semester } from "./semester.js";
import { semesterAt, semesterChoices } from "./semester.js";
import { similarCourses } from "./similar-courses.js";

export type Courses = ReturnType<typeof createCourses>;

type Due = {
  date: string | null;
  time: string | null;
  timeZone: string | null;
};

/** The local date and time now in a time zone, as "YYYY-MM-DD" and "HH:MM". */
function localNow(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** A due moment comparable as text; a date without a time lasts the whole day. */
const dueKey = (due: Due) => `${due.date} ${due.time ?? "24:00"}`;

/**
 * The earliest Obligation still ahead: not rejected, not Reported as Submitted, and with a date. An unreviewed one counts,
 * marked, because the Plan counts it too.
 */
function nextObligation(
  obligations: Awaited<
    ReturnType<Facts["review"]>
  >["courses"][number]["obligations"],
  now: Date,
) {
  const ahead = obligations
    .filter(
      (o) =>
        o.state !== "rejected" &&
        !o.reportedSubmittedAt &&
        o.due.date &&
        dueKey(o.due) > localNow(now, o.due.timeZone ?? "Europe/Berlin"),
    )
    .sort((a, b) => dueKey(a.due).localeCompare(dueKey(b.due)));
  const next = ahead[0];
  return next
    ? {
        id: next.id,
        kind: next.kind,
        title: next.title,
        due: {
          date: next.due.date,
          time: next.due.time,
          timeZone: next.due.timeZone,
        },
        unreviewed: next.state === "unreviewed",
      }
    : null;
}

/** A Course's own fields as the student sends them. */
type CourseInput = {
  title: string;
  code: string | null;
  semester: string;
  color: string;
};
type CourseFields = {
  title: string;
  code: string | null;
  semester: Semester;
  color: CourseColor;
};

const isColor = (value: string): value is CourseColor =>
  (courseColors as readonly string[]).includes(value);

/**
 * The given fields, trimmed, or null when one is not valid: no or an overlong title or code, an unknown color, or a
 * Semester that is not offered. The Semester a Course already has stays valid, however long ago it was.
 */
function cleaned(
  input: Partial<CourseInput>,
  offered: Semester[],
  kept?: string,
): Partial<CourseFields> | null {
  const fields: Partial<CourseFields> = {};
  if (input.title !== undefined) {
    fields.title = input.title.trim();
    if (!fields.title || fields.title.length > 500) return null;
  }
  if (input.code !== undefined) {
    fields.code = input.code?.trim() || null;
    if (fields.code && fields.code.length > 50) return null;
  }
  if (input.semester !== undefined) {
    if (
      input.semester !== kept &&
      !offered.includes(input.semester as Semester)
    )
      return null;
    fields.semester = input.semester as Semester;
  }
  if (input.color !== undefined) {
    if (!isColor(input.color)) return null;
    fields.color = input.color;
  }
  return fields;
}

const dueOf = (next: ReturnType<typeof nextObligation>) =>
  next ? dueKey(next.due) : null;

/** Soonest upcoming Obligation first, then those with nothing due by title; Archived Courses last. */
function overviewOrder(
  a: {
    title: string;
    archived: boolean;
    next: ReturnType<typeof nextObligation>;
  },
  b: {
    title: string;
    archived: boolean;
    next: ReturnType<typeof nextObligation>;
  },
) {
  if (a.archived !== b.archived) return a.archived ? 1 : -1;
  const [da, db] = [dueOf(a.next), dueOf(b.next)];
  if (da !== db) {
    if (da && db) return da.localeCompare(db);
    return da ? -1 : 1;
  }
  return a.title.localeCompare(b.title, "de");
}

/** Another Course with this code or title, which would make matching a later Source to either one ambiguous. */
async function clashing(
  tx: Transaction,
  names: { matchTitle: string; matchCode: string | null },
  except?: string,
) {
  const other = await tx.course.findFirst({
    where: {
      status: { not: "merged" },
      ...(except ? { id: { not: except } } : {}),
      OR: [
        { matchTitle: names.matchTitle },
        ...(names.matchCode ? [{ matchCode: names.matchCode }] : []),
      ],
    },
  });
  return other
    ? ({
        status: "clash",
        course: {
          id: other.id,
          title: other.title,
          status: other.status as "proposed" | "accepted" | "rejected",
          archived: other.archivedAt !== null,
        },
      } as const)
    : null;
}

/** The student's Courses: their Semester, color, and lifecycle beyond review. */
export function createCourses({
  db,
  clock,
  facts,
  responsibilities,
}: {
  db: PrismaClient;
  clock: { now(): Date };
  facts: Pick<Facts, "review">;
  responsibilities: Pick<Responsibilities, "pauseForCourse" | "endForCourse">;
}) {
  /** The Study Blocks for the Course's work: its Obligations, and Tasks toward them. */
  const blocks = (courseId: string) => ({
    OR: [{ obligation: { courseId } }, { task: { obligation: { courseId } } }],
  });
  /** Those still ahead. */
  const futureBlocks = (courseId: string) => ({
    start: { gte: clock.now() },
    ...blocks(courseId),
  });
  return {
    async list(p: Principal) {
      const reviewed = new Map(
        (await facts.review(p)).courses.map((c) => [c.id, c.obligations]),
      );
      const now = clock.now();
      return withOwner(db, p, async (tx) => {
        const rows = await tx.course.findMany({
          where: { status: { in: ["proposed", "accepted"] } },
          orderBy: { createdAt: "asc" },
        });
        return {
          current: semesterAt(now),
          choices: semesterChoices(now),
          courses: rows
            .map((course) => ({
              id: course.id,
              code: course.code,
              title: course.title,
              status: course.status as "proposed" | "accepted",
              semester: course.semester as Semester,
              color: course.color as CourseColor,
              entered: course.enteredAt !== null,
              archived: course.archivedAt !== null,
              next: nextObligation(reviewed.get(course.id) ?? [], now),
            }))
            .sort(overviewOrder),
        };
      });
    },

    async create(
      p: Principal,
      input: { title: string; code: string | null; semester: string },
    ) {
      const fields = cleaned(input, semesterChoices(clock.now()));
      if (!fields?.title || !fields.semester)
        return { status: "invalid" } as const;
      const course = {
        title: fields.title,
        code: fields.code ?? null,
        semester: fields.semester,
      };
      return withOwner(db, p, async (tx, studentId) => {
        const clash = await clashing(tx, matchKeys(course.title, course.code));
        if (clash) return clash;
        const id = randomUUID();
        await tx.course.create({
          data: {
            id,
            studentId,
            status: "accepted",
            enteredAt: clock.now(),
            ...(await newCourse(tx, course)),
          },
        });
        return { status: "ok", id } as const;
      });
    },

    async edit(p: Principal, id: string, input: Partial<CourseInput>) {
      return withOwner(db, p, async (tx) => {
        const course = await tx.course.findFirst({
          where: { id, status: "accepted" },
        });
        if (!course) return { status: "gone" } as const;
        const fields = cleaned(
          input,
          semesterChoices(clock.now()),
          course.semester,
        );
        if (!fields) return { status: "invalid" } as const;
        const renamed = fields.title !== undefined || fields.code !== undefined;
        const names = matchKeys(
          fields.title ?? course.title,
          fields.code !== undefined ? fields.code : course.code,
        );
        // No two Courses may share a name; checked on the name as shown, whoever created the Course.
        if (renamed) {
          const clash = await clashing(tx, names, id);
          if (clash) return clash;
        }
        await tx.course.update({
          where: { id },
          // The student's own Course is matched by its name; one nunio proposed keeps the wording its Sources use.
          data: { ...fields, ...(course.enteredAt && renamed ? names : {}) },
        });
        return { status: "ok" } as const;
      });
    },

    /** What archiving (future Study Blocks) or deleting (all of them) the Course touches, for the student to confirm. */
    async impact(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        if (!(await tx.course.findFirst({ where: { id, status: "accepted" } })))
          return null;
        return {
          obligations: await tx.obligation.count({ where: { courseId: id } }),
          tasks: await tx.task.count({
            where: { obligation: { courseId: id } },
          }),
          studyBlocks: await tx.studyBlock.count({ where: blocks(id) }),
          futureStudyBlocks: await tx.studyBlock.count({
            where: futureBlocks(id),
          }),
          responsibilities: await tx.responsibility.count({
            where: { courseId: id, state: { not: "ended" } },
          }),
        };
      });
    },

    /**
     * nunio stops planning and acting for the Course: its future Study Blocks go, Locked ones too, since the student
     * chose this, and its Responsibilities are Paused. They are Paused first, so a failure leaves nunio doing less.
     */
    async archive(p: Principal, id: string) {
      const accepted = await withOwner(db, p, (tx) =>
        tx.course.findFirst({ where: { id, status: "accepted" } }),
      );
      if (!accepted) return { status: "gone" } as const;
      await responsibilities.pauseForCourse(p, id);
      return withOwner(db, p, async (tx) => {
        await tx.studyBlock.deleteMany({ where: futureBlocks(id) });
        await tx.course.update({
          where: { id },
          data: { archivedAt: accepted.archivedAt ?? clock.now() },
        });
        return { status: "ok" } as const;
      });
    },

    /**
     * Removes the Course and everything only in it; Sources stay, so a later reading may propose it again (ADR 0015).
     * Its Responsibilities are Ended first, in their own transaction because each Schedule is deleted after that commit;
     * a failure in between leaves them Ended on a Course that still exists, which the student asked to go anyway.
     */
    async delete(p: Principal, id: string) {
      const accepted = await withOwner(db, p, (tx) =>
        tx.course.findFirst({ where: { id, status: "accepted" } }),
      );
      if (!accepted) return { status: "gone" } as const;
      await responsibilities.endForCourse(p, id);
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.course.deleteMany({ where: { id } });
        return { status: count ? "ok" : "gone" } as const;
      });
    },

    /**
     * Pairs of the student's Courses that look like one, for Review to suggest merging: same Semester, neither rejected
     * nor merged, and not kept apart by the student. Each names the Course to merge and the one to merge it into: the
     * accepted one over a proposal, else the older.
     */
    async similar(p: Principal) {
      return withOwner(db, p, async (tx) => {
        const rows = await tx.course.findMany({
          where: { status: { in: ["proposed", "accepted"] } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            title: true,
            code: true,
            semester: true,
            status: true,
          },
        });
        const apart = new Set(
          (await tx.distinctCoursePair.findMany()).map(
            (pair) => `${pair.courseId} ${pair.otherId}`,
          ),
        );
        return rows.flatMap((into, i) =>
          rows
            .slice(i + 1)
            .filter(
              (course) =>
                course.semester === into.semester &&
                !apart.has([into.id, course.id].sort().join(" ")) &&
                similarCourses(into, course),
            )
            .map((course) =>
              course.status === "accepted" && into.status === "proposed"
                ? { courseId: into.id, intoId: course.id }
                : { courseId: course.id, intoId: into.id },
            ),
        );
      });
    },

    /** "Nein, verschieden": the student says two Courses differ, so Review never suggests merging them again. */
    async keepApart(p: Principal, id: string, otherId: string) {
      const [courseId, other] = [id, otherId].sort() as [string, string];
      return withOwner(db, p, async (tx, studentId) => {
        const found = await tx.course.count({
          where: { id: { in: [courseId, other] } },
        });
        if (courseId === other || found !== 2)
          return { status: "gone" } as const;
        await tx.distinctCoursePair.upsert({
          where: { courseId_otherId: { courseId, otherId: other } },
          create: { studentId, courseId, otherId: other },
          update: {},
        });
        return { status: "ok" } as const;
      });
    },

    /** Its Obligations return to the Plan; removed Study Blocks stay gone and Paused Responsibilities stay Paused. */
    async unarchive(p: Principal, id: string) {
      return withOwner(db, p, async (tx) => {
        const { count } = await tx.course.updateMany({
          where: { id, status: "accepted" },
          data: { archivedAt: null },
        });
        return { status: count ? "ok" : "gone" } as const;
      });
    },
  };
}
