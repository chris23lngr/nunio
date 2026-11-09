import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { AppBindings } from "./app.js";
import {
  body,
  Created,
  created,
  Done,
  done,
  errors,
  id,
  json,
  outcomes,
  student,
} from "./outcomes.js";

const Relations = z.object({
  courseIds: z.array(z.string().uuid()).max(50),
  obligationId: z.string().uuid().nullable(),
});
const Project = z
  .object({
    id: z.string(),
    name: z.string(),
    courseIds: z.array(z.string()),
    obligationId: z.string().nullable(),
  })
  .openapi("Project");

export function registerProjectRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/projects",
      responses: {
        200: json(z.array(Project), "The student's Projects."),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return c.json(await c.get("projects").list(p), 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/projects",
      request: body(Relations.extend({ name: z.string() }).strict()),
      responses: { 201: Created, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return created(c, await c.get("projects").create(p, c.req.valid("json")));
    },
  );
  routes.openapi(
    createRoute({
      method: "patch",
      path: "/api/me/projects/{id}",
      request: { params: id, ...body(z.object({ name: z.string() }).strict()) },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("projects")
          .rename(p, c.req.valid("param").id, c.req.valid("json").name),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "put",
      path: "/api/me/projects/{id}/relations",
      request: { params: id, ...body(Relations.strict()) },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c
          .get("projects")
          .relate(p, c.req.valid("param").id, c.req.valid("json")),
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "delete",
      path: "/api/me/projects/{id}",
      request: { params: id },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return done(
        c,
        await c.get("projects").remove(p, c.req.valid("param").id),
      );
    },
  );
}
