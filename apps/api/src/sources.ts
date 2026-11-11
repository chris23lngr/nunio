import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { ExtractionStatus, SourceFailure, SourceStatus } from "@nunio/db";
import { principal } from "@nunio/delegation";
import { maxSourceBytes } from "@nunio/knowledge";
import type { AppBindings } from "./app.js";

const Source = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(SourceStatus),
    failure: z.enum(SourceFailure).nullable().openapi({
      description: "Why processing stopped, when the student can act on it.",
    }),
    extraction: z.enum(ExtractionStatus),
    courseId: z.string().nullable().openapi({
      description:
        "The Course the student bound it to; everything read from it goes there. Null: nunio recognizes its Courses.",
    }),
  })
  .openapi("Source");
const CourseChoice = z
  .union([
    z.object({ id: z.string().uuid() }).strict(),
    z
      .object({
        title: z.string().min(1).max(500),
        code: z.string().max(50).nullable(),
      })
      .strict(),
  ])
  .nullable()
  .openapi("CourseChoice", {
    description:
      'An accepted, unarchived Course; a new one, created accepted in the current Semester; or null, "automatisch erkennen".',
  });
const ErrorBody = z.object({ error: z.string() });
const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  401: json(ErrorBody, "Sign in required."),
  403: json(ErrorBody, "Pilot access is not active or deletion is pending."),
  404: json(ErrorBody, "Source is gone."),
};
const params = z.object({ id: z.string().uuid() });
const courseErrors = {
  400: json(ErrorBody, "The new Course has no title."),
  404: json(ErrorBody, "Source or Course is gone."),
};
/** Maps a refused Course choice to its response. */
const courseRefusal = (status: "invalid" | "gone" | "course_archived") =>
  status === "invalid"
    ? ({ body: { error: "invalid" }, code: 400 } as const)
    : status === "gone"
      ? ({ body: { error: "gone" }, code: 404 } as const)
      : ({ body: { error: "course_archived" }, code: 409 } as const);
export function registerSourceRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/sources/{id}/download",
      request: { params },
      responses: {
        200: json(
          z.object({
            title: z.string(),
            url: z.string(),
            headers: z.record(z.string(), z.string()),
          }),
          "Owner-authorized PDF download. Send its headers using fetch.",
        ),
        401: errors[401],
        404: errors[404],
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("sources")
        .download(principal.fromSession(actor), c.req.valid("param").id);
      if (result.status === "gone") return c.json({ error: "gone" }, 404);
      return c.json(
        { title: result.title, url: result.url, headers: result.headers },
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/sources",
      responses: {
        200: json(z.array(Source), "The student's live Sources."),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const sources = c.get("sources");
      return c.json(await sources.list(principal.fromSession(actor)), 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/sources",
      request: {
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({
                title: z.string().min(1).max(255),
                bytes: z.number().int().positive().max(maxSourceBytes),
                type: z.literal("application/pdf"),
                course: CourseChoice.optional().openapi({
                  description:
                    "Applies to this file; for several files with a new Course, send it with the first and its returned courseId with the rest.",
                }),
              }),
            },
          },
        },
      },
      responses: {
        201: json(
          z.object({
            source: Source,
            upload: z.object({
              url: z.string(),
              headers: z.record(z.string(), z.string()),
              expiresAt: z.string(),
            }),
          }),
          "Upload directly to quarantine using PUT and these headers.",
        ),
        ...errors,
        ...courseErrors,
        409: json(ErrorBody, "The chosen Course is Archived."),
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const sources = c.get("sources");
      const result = await sources.upload(
        principal.fromSession(actor),
        c.req.valid("json"),
      );
      if (result.status === "refused")
        return c.json({ error: result.reason }, 403);
      if (result.status !== "ok") {
        const { body, code } = courseRefusal(result.status);
        return c.json(body, code);
      }
      return c.json(
        {
          source: result.source,
          upload: {
            ...result.upload,
            expiresAt: result.upload.expiresAt.toISOString(),
          },
        },
        201,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/sources/{id}/extract",
      description: "Read again: extract a ready Source anew.",
      request: { params },
      responses: {
        202: json(
          z.object({ status: z.literal("queued") }),
          "Extraction queued and metered again; repeating while it waits is idempotent.",
        ),
        409: json(ErrorBody, "Extraction is running."),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const id = c.req.valid("param").id;
      const result = await c
        .get("facts")
        .requestExtraction(principal.fromSession(actor), id);
      if (result.status === "gone") return c.json({ error: "gone" }, 404);
      if (result.status === "running") return c.json({ error: "running" }, 409);
      await c
        .get("sourceWorkflows")
        .start("extractSource", actor.studentId, id);
      return c.json({ status: "queued" as const }, 202);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/sources/{id}/course",
      description:
        "Kurs ändern: bind a ready Source to another Course, a new one, or none, and read it again.",
      request: {
        params,
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({ course: CourseChoice }).strict(),
            },
          },
        },
      },
      responses: {
        202: json(
          z.object({ status: z.literal("queued") }),
          "Extraction queued and metered again; its extractions are replaced once it is done.",
        ),
        409: json(
          ErrorBody,
          "Extraction is running, or the chosen Course is Archived (error course_archived).",
        ),
        ...errors,
        ...courseErrors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const id = c.req.valid("param").id;
      const result = await c
        .get("facts")
        .changeCourse(
          principal.fromSession(actor),
          id,
          c.req.valid("json").course,
        );
      if (result.status === "running") return c.json({ error: "running" }, 409);
      if (result.status !== "ok") {
        const { body, code } = courseRefusal(result.status);
        return c.json(body, code);
      }
      await c
        .get("sourceWorkflows")
        .start("extractSource", actor.studentId, id);
      return c.json({ status: "queued" as const }, 202);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/sources/{id}/complete",
      request: { params },
      responses: {
        202: json(
          z.object({ status: z.literal("queued") }),
          "Ingestion queued; repeating is idempotent.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const sources = c.get("sources"),
        workflows = c.get("sourceWorkflows");
      const id = c.req.valid("param").id;
      const result = await sources.complete(principal.fromSession(actor), id);
      if (result.status === "gone") return c.json({ error: "gone" }, 404);
      if (result.status === "refused")
        return c.json({ error: result.reason }, 403);
      await workflows.start("ingestSource", actor.studentId, id);
      return c.json({ status: "queued" as const }, 202);
    },
  );
  routes.openapi(
    createRoute({
      method: "delete",
      path: "/api/me/sources/{id}",
      request: { params },
      responses: {
        202: json(
          z.object({ status: z.literal("deleted") }),
          "Key and derived rows removed. Object cleanup queued.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const sources = c.get("sources"),
        workflows = c.get("sourceWorkflows");
      const id = c.req.valid("param").id;
      const result = await sources.removeWithCleanup(
        principal.fromSession(actor),
        id,
        (cleanupAfter) =>
          workflows.start(
            "deleteSource",
            actor.studentId,
            id,
            cleanupAfter.toISOString(),
          ),
      );
      if (result.status === "gone") return c.json({ error: "gone" }, 404);
      return c.json({ status: "deleted" as const }, 202);
    },
  );
}
