import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { principal } from "@nunio/delegation";
import type { AppBindings } from "./app.js";

const Provenance = z.discriminatedUnion("kind", [z.object({ kind: z.literal("correction") }), z.object({ kind: z.literal("entry") }),
  z.object({ kind: z.literal("source"), sourceId: z.string(), title: z.string(), location: z.object({ page: z.number().int() }) })]);
const Citation = z.object({ tag: z.string(), provenance: z.union([Provenance, z.literal("gone")])
  .describe("Resolved when shown; \"gone\" once its Source is deleted.") });
const Message = z.object({ id: z.string(), role: z.enum(["student", "assistant"]),
  text: z.string().nullable().describe("Null once a Source the answer drew on is deleted: its wording is removed with that Source."),
  citations: z.array(Citation) }).openapi("ChatMessage");
const Selection = z.object({ courseIds: z.array(z.string().uuid()).max(50), sourceIds: z.array(z.string().uuid()).max(200) }).strict()
  .describe("The Courses and Sources the Chat may read; empty means none.");
const ErrorBody = z.object({ error: z.string() });
const json = (schema: z.ZodType, description: string) => ({ description, content: { "application/json": { schema } } });
const errors = { 401: json(ErrorBody, "Sign in required."), 404: json(ErrorBody, "The Chat is gone.") };
const chatParams = z.object({ id: z.string().uuid() });

export function registerChatRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(createRoute({ method: "post", path: "/api/me/chats", request: {
    body: { required: true, content: { "application/json": { schema: Selection } } },
  }, responses: { 201: json(z.object({ id: z.string() }), "Created."),
    404: json(ErrorBody, "A selected Course or Source is gone or not the student's."), 401: errors[401] } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const created = await c.get("chats").create(principal.fromSession(actor), c.req.valid("json"));
    if (created.status === "gone") return c.json({ error: "gone" }, 404);
    return c.json({ id: created.id }, 201);
  });
  routes.openapi(createRoute({ method: "get", path: "/api/me/chats/{id}/messages", request: { params: chatParams },
    responses: { 200: json(z.array(Message), "Every message, oldest first."), ...errors } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const messages = await c.get("chats").messages(principal.fromSession(actor), c.req.valid("param").id);
    if (!messages) return c.json({ error: "gone" }, 404);
    return c.json(messages, 200);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/chats/{id}/messages", request: {
    params: chatParams,
    body: { required: true, content: { "application/json": { schema: z.object({ text: z.string().trim().min(1).max(4000) }).strict() } } },
  }, responses: { 200: json(Message, "The answer, citing the selected material."),
    403: json(ErrorBody, "Usage is refused, such as an exhausted Allowance."), ...errors } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const result = await c.get("chats").ask(principal.fromSession(actor), c.req.valid("param").id, c.req.valid("json").text, c.get("answerer"));
    if (result.status === "gone") return c.json({ error: "gone" }, 404);
    if (result.status === "refused") return c.json({ error: result.reason }, 403);
    return c.json(result.message, 200);
  });
}
