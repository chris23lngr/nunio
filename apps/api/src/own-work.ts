import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { OwnWorkStatus } from "@nunio/db";
import { principal } from "@nunio/delegation";
import { maxOwnWorkBytes } from "@nunio/knowledge";
import type { AppBindings } from "./app.js";

const OwnWorkFile = z
  .object({
    id: z.string(),
    name: z.string(),
    bytes: z.number().int(),
    status: z.enum(OwnWorkStatus).openapi({
      description:
        "ready once the worker promoted it; failed when there was no upload to keep, so the student uploads it again.",
    }),
    uploadedAt: z.string(),
  })
  .openapi("OwnWorkFile");
const ErrorBody = z.object({ error: z.string() });
const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  401: json(ErrorBody, "Sign in required."),
  403: json(
    ErrorBody,
    "Forbidden origin, or pilot access is not active or deletion is pending.",
  ),
  404: json(ErrorBody, "The Obligation or the file is gone."),
};
const obligation = z.object({ id: z.string().uuid() });
const file = obligation.extend({ fileId: z.string().uuid() });
const shown = (f: { uploadedAt: Date }) => ({
  ...f,
  uploadedAt: f.uploadedAt.toISOString(),
});

/** Own Work: the files the student uploads to hand in for an Obligation, never parsed (#306). */
export function registerOwnWorkRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/obligations/{id}/own-work",
      request: { params: obligation },
      responses: {
        200: json(z.array(OwnWorkFile), "Oldest first."),
        401: errors[401],
        404: errors[404],
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("ownWork")
        .list(principal.fromSession(actor), c.req.valid("param").id);
      if (result.status === "gone") return c.json({ error: "gone" }, 404);
      return c.json(result.files.map(shown), 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/obligations/{id}/own-work",
      description: '"Eigene Arbeit hochladen": starts one file\'s upload.',
      request: {
        params: obligation,
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z
                .object({
                  name: z.string().min(1).max(255),
                  bytes: z.number().int().positive().max(maxOwnWorkBytes),
                })
                .strict(),
            },
          },
        },
      },
      responses: {
        201: json(
          z.object({
            file: OwnWorkFile,
            upload: z.object({
              url: z.string(),
              headers: z.record(z.string(), z.string()),
              expiresAt: z.string(),
            }),
          }),
          "Upload directly to quarantine using PUT and these headers, then confirm.",
        ),
        400: json(ErrorBody, "No name, or not between 1 byte and 14 MB."),
        409: json(
          ErrorBody,
          "Nothing is handed in for an exam or registration.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("ownWork")
        .upload(
          principal.fromSession(actor),
          c.req.valid("param").id,
          c.req.valid("json"),
        );
      if (result.status === "invalid") return c.json({ error: "invalid" }, 400);
      if (result.status === "refused")
        return c.json({ error: result.reason }, 403);
      if (result.status === "gone") return c.json({ error: "gone" }, 404);
      if (result.status === "not_handed_in")
        return c.json({ error: "not_handed_in" }, 409);
      return c.json(
        {
          file: shown(result.file),
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
      path: "/api/me/obligations/{id}/own-work/{fileId}/confirm",
      description:
        "The upload finished: the worker promotes a snapshot of it, without parsing.",
      request: { params: file },
      responses: {
        202: json(
          z.object({ status: z.literal("queued") }),
          "Promotion queued; repeating is idempotent.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const { id, fileId } = c.req.valid("param");
      const result = await c
        .get("ownWork")
        .confirm(principal.fromSession(actor), id, fileId);
      if (result.status === "gone") return c.json({ error: "gone" }, 404);
      if (result.status === "refused")
        return c.json({ error: result.reason }, 403);
      await c
        .get("sourceWorkflows")
        .ownWork("promoteOwnWork", actor.studentId, fileId);
      return c.json({ status: "queued" as const }, 202);
    },
  );
  routes.openapi(
    createRoute({
      method: "delete",
      path: "/api/me/obligations/{id}/own-work/{fileId}",
      request: { params: file },
      responses: {
        202: json(
          z.object({ status: z.literal("deleted") }),
          "Key removed. Cleanup of every stored version queued.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const { id, fileId } = c.req.valid("param");
      const workflows = c.get("sourceWorkflows");
      const result = await c
        .get("ownWork")
        .removeWithCleanup(
          principal.fromSession(actor),
          id,
          fileId,
          (cleanupAfter) =>
            workflows.ownWork(
              "deleteOwnWork",
              actor.studentId,
              fileId,
              cleanupAfter.toISOString(),
            ),
        );
      if (result.status === "gone") return c.json({ error: "gone" }, 404);
      return c.json({ status: "deleted" as const }, 202);
    },
  );
}
