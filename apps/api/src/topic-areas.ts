import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { principal } from "@nunio/delegation";
import type { AppBindings } from "./app.js";

const ErrorBody = z.object({ error: z.string() });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  401: json(ErrorBody, "Sign in required."),
  404: json(ErrorBody, "Course, Topic or Topic Area is gone."),
};
const Done = json(z.object({ status: z.literal("ok") }), "Recorded.");
const TopicRef = z.object({ id: z.string(), name: z.string() });
const TopicAreaList = z
  .object({
    areas: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        inferred: z
          .boolean()
          .describe("No member's quote or Source title names it."),
        topics: z.array(TopicRef),
      }),
    ),
    ungrouped: z
      .array(TopicRef)
      .describe("Topics in no Topic Area, shown last as Weitere Themen."),
  })
  .openapi("TopicAreas");

/** Topic Areas (ADR-0023): read on the course page, renamed, rejected, and Topics moved between them. */
export function registerTopicAreaRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/courses/{id}/topic-areas",
      description:
        "The Course's Topic Areas with their Topics, then the Topics in none, each in order.",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: json(TopicAreaList, "Topic Areas and ungrouped Topics."),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const listed = await c
        .get("topicAreas")
        .list(principal.fromSession(actor), c.req.valid("param").id);
      if (!listed) return c.json({ error: "gone" }, 404);
      return c.json(listed, 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "patch",
      path: "/api/me/topic-areas/{id}",
      description:
        "Rename a Topic Area; later grouping passes keep the student's name.",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({ name: z.string().trim().min(1).max(80) }),
            },
          },
        },
      },
      responses: {
        200: Done,
        ...errors,
        409: json(ErrorBody, "Another Topic Area of the Course has this name."),
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("topicAreas")
        .rename(
          principal.fromSession(actor),
          c.req.valid("param").id,
          c.req.valid("json").name,
        );
      if (result.status === "not_found") return c.json({ error: "gone" }, 404);
      if (result.status === "clash") return c.json({ error: "clash" }, 409);
      return c.json({ status: "ok" as const }, 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/topic-areas/{id}/reject",
      description:
        "Reject a Topic Area: it is never recreated, and its Topics stay ungrouped.",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: Done, ...errors },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("topicAreas")
        .reject(principal.fromSession(actor), c.req.valid("param").id);
      if (result.status === "not_found") return c.json({ error: "gone" }, 404);
      return c.json({ status: "ok" as const }, 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/topics/{id}/area",
      description:
        "Move a Topic last into another Topic Area of its Course, or into none; later grouping passes leave it there.",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({ areaId: z.string().uuid().nullable() }),
            },
          },
        },
      },
      responses: { 200: Done, ...errors },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("topicAreas")
        .move(
          principal.fromSession(actor),
          c.req.valid("param").id,
          c.req.valid("json").areaId,
        );
      if (result.status === "not_found") return c.json({ error: "gone" }, 404);
      return c.json({ status: "ok" as const }, 200);
    },
  );
}
