import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { ObligationKind } from "@nunio/db";
import { courseColors } from "@nunio/knowledge";
import type { Context } from "hono";
import type { AppBindings } from "./app.js";
import {
  body,
  Created,
  created,
  Done,
  done,
  ErrorBody,
  errors,
  id,
  json,
  outcomes,
  student,
} from "./outcomes.js";

const Semester = z
  .string()
  .regex(/^\d{4}-(ws|ss)$/)
  .describe(
    'Starting year and season: "ws" for a Wintersemester (October to March), "ss" for a Sommersemester.',
  );
const Color = z.enum(courseColors);
const Course = z
  .object({
    id: z.string(),
    code: z.string().nullable(),
    title: z.string(),
    status: z.enum(["proposed", "accepted"]),
    semester: Semester,
    color: Color,
    entered: z
      .boolean()
      .describe(
        "The student created it, so it can only be deleted, not rejected.",
      ),
    archived: z.boolean(),
    next: z
      .object({
        id: z.string(),
        kind: z.enum(ObligationKind),
        title: z.string(),
        due: z.object({
          date: z.string().nullable(),
          time: z.string().nullable(),
          timeZone: z.string().nullable(),
        }),
        unreviewed: z.boolean(),
      })
      .nullable()
      .describe(
        "The earliest Obligation still ahead, unreviewed ones included and marked.",
      ),
    lastActivityAt: z
      .date()
      .nullable()
      .describe(
        "The Course's Last Activity: when the student last asked about it in a Chat, practised or assessed one of its Topics, or uploaded a Source to it; null if never.",
      ),
  })
  .openapi("CourseSummary");
const Clash = ErrorBody.extend({
  course: z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["proposed", "accepted", "rejected"]),
    archived: z.boolean(),
  }),
});
const clashOutcomes = {
  ...outcomes,
  409: json(
    Clash,
    "Another Course has this code or title; the student accepts, restores or unarchives that one instead.",
  ),
};
type Clashing = {
  status: "clash";
  course: z.infer<typeof Clash>["course"];
};
const clash = (c: Context<AppBindings>, result: Clashing) =>
  c.json({ error: "clash", course: result.course }, 409);

export function registerCourseRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/courses",
      responses: {
        200: json(
          z.object({
            current: Semester,
            choices: z
              .array(Semester)
              .describe("The Semesters a Course can be given, newest first."),
            courses: z.array(Course),
          }),
          "The student's proposed and accepted Courses; rejected and merged ones are left out.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return c.json(await c.get("courses").list(p), 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/courses",
      description: "Create a Course by hand; it is the student's own.",
      request: body(
        z
          .object({
            title: z.string(),
            code: z.string().nullable(),
            semester: Semester,
          })
          .strict(),
      ),
      responses: { 201: Created, ...clashOutcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const result = await c.get("courses").create(p, c.req.valid("json"));
      return result.status === "clash" ? clash(c, result) : created(c, result);
    },
  );
  routes.openapi(
    createRoute({
      method: "patch",
      path: "/api/me/courses/{id}",
      request: {
        params: id,
        ...body(
          z
            .object({
              title: z.string(),
              code: z.string().nullable(),
              semester: Semester,
              color: Color,
            })
            .partial()
            .strict(),
        ),
      },
      responses: { 200: Done, ...clashOutcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("courses")
        .edit(p, c.req.valid("param").id, c.req.valid("json"));
      return result.status === "clash" ? clash(c, result) : done(c, result);
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/courses/{id}/impact",
      description: "What archiving or deleting the Course touches.",
      request: { params: id },
      responses: {
        200: json(
          z.object({
            obligations: z.number().int(),
            tasks: z.number().int(),
            studyBlocks: z
              .number()
              .int()
              .describe("All of them, which deleting removes."),
            futureStudyBlocks: z
              .number()
              .int()
              .describe("Those still ahead, which archiving removes."),
            responsibilities: z.number().int(),
          }),
          "Counts for the student to confirm.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const impact = await c.get("courses").impact(p, c.req.valid("param").id);
      return impact ? c.json(impact, 200) : c.json({ error: "gone" }, 404);
    },
  );
  for (const action of ["archive", "unarchive"] as const)
    routes.openapi(
      createRoute({
        method: "post",
        path: `/api/me/courses/{id}/${action}`,
        description:
          action === "archive"
            ? "nunio stops planning and acting for the Course: its future Study Blocks go and its Responsibilities are Paused."
            : "Its Obligations return to the Plan; Paused Responsibilities stay Paused.",
        request: { params: id },
        responses: { 200: Done, ...outcomes },
      }),
      async (c) => {
        const p = await student(c);
        if (!p) return c.json({ error: "unauthorized" }, 401);
        return done(
          c,
          await c.get("courses")[action](p, c.req.valid("param").id),
        );
      },
    );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/courses/merge-suggestions",
      description:
        "Pairs of Courses in one Semester that look like one, by code or title; no model is asked.",
      responses: {
        200: json(
          z.array(
            z.object({
              courseId: z.string().describe("The Course to merge."),
              intoId: z
                .string()
                .describe(
                  "The Course to merge it into: the accepted one, else the older.",
                ),
            }),
          ),
          "Merge suggestions the student has not declined.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return c.json(await c.get("courses").similar(p), 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/courses/{id}/keep-apart",
      description:
        "Nein, verschieden: never suggest merging these two Courses again.",
      request: {
        params: id,
        ...body(z.object({ other: z.string().uuid() }).strict()),
      },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("courses")
          .keepApart(p, c.req.valid("param").id, c.req.valid("json").other),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "delete",
      path: "/api/me/courses/{id}",
      description:
        "Removes the Course and everything only in it, ending its Responsibilities; its Sources stay.",
      request: { params: id },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(c, await c.get("courses").delete(p, c.req.valid("param").id));
    },
  );
}
