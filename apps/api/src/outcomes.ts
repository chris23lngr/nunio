import { z } from "@hono/zod-openapi";
import { principal } from "@nunio/delegation";
import type { Context } from "hono";
import type { AppBindings } from "./app.js";

export const ErrorBody = z.object({ error: z.string() });
export const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
export const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
export const Done = json(z.object({ status: z.literal("ok") }), "Recorded.");
export const Created = json(z.object({ id: z.string() }), "Created.");
export const errors = {
  401: json(ErrorBody, "Sign in required."),
  404: json(ErrorBody, "It is gone or not the student's."),
};
/** Every way a change to the student's own data can fail, shared by the routes that make one. */
export const outcomes = {
  400: json(ErrorBody, "Not valid."),
  409: json(
    ErrorBody,
    "It no longer matches what was read, such as a stale proposed move.",
  ),
  ...errors,
};
/** For the routes that refuse to act on an Archived Course. */
export const archivedOutcomes = {
  ...outcomes,
  409: json(
    ErrorBody,
    "It no longer matches what was read, or its Course is Archived (error course_archived): nunio does not act for it.",
  ),
};
export const id = z.object({ id: z.string().uuid() });
export type Result = {
  status: "ok" | "gone" | "invalid" | "stale" | "course_archived";
  id?: string;
};

/** Maps a failed change to its response the same way for every route. */
export function failed(
  c: Context<AppBindings>,
  status: "gone" | "invalid" | "stale" | "course_archived",
) {
  if (status === "invalid") return c.json({ error: "invalid" }, 400);
  if (status === "gone") return c.json({ error: "gone" }, 404);
  if (status === "course_archived")
    return c.json({ error: "course_archived" }, 409);
  return c.json({ error: "stale" }, 409);
}
export const done = (c: Context<AppBindings>, result: Result) =>
  result.status === "ok"
    ? c.json({ status: "ok" as const }, 200)
    : failed(c, result.status);
export const created = (c: Context<AppBindings>, result: Result) =>
  result.status === "ok"
    ? c.json({ id: result.id! }, 201)
    : failed(c, result.status);
/** The signed-in student, setting no-store on the response. */
export async function student(c: Context<AppBindings>) {
  c.header("cache-control", "no-store");
  const actor = await c.get("auth").authenticate(c.req.raw);
  return actor && principal.fromSession(actor);
}
