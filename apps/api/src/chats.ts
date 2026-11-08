import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import { isDefiniteFailure, SourceModelRejected } from "@nunio/ai";
import { DefiniteFailure, principal } from "@nunio/delegation";
import type { CitationRef } from "@nunio/knowledge";
import type { AppBindings } from "./app.js";

const Provenance = z.discriminatedUnion("kind", [z.object({ kind: z.literal("correction") }), z.object({ kind: z.literal("entry") }),
  z.object({ kind: z.literal("source"), sourceId: z.string(), title: z.string(), location: z.object({ page: z.number().int() }) })]);
const Citation = z.object({ tag: z.string(), provenance: z.union([Provenance, z.literal("gone")])
  .describe("Resolved when shown; \"gone\" once its Source is deleted.") });
const Message = z.object({ id: z.string(), role: z.enum(["student", "assistant"]), text: z.string(), citations: z.array(Citation) })
  .openapi("ChatMessage");
const Selection = z.object({ courseIds: z.array(z.string().uuid()).max(50), sourceIds: z.array(z.string().uuid()).max(200) }).strict()
  .describe("The Courses and Sources the Chat may read; empty means none.");
const ErrorBody = z.object({ error: z.string() });
const json = (schema: z.ZodType, description: string) => ({ description, content: { "application/json": { schema } } });
const errors = { 401: json(ErrorBody, "Sign in required."), 404: json(ErrorBody, "The Chat is gone.") };

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
  routes.openapi(createRoute({ method: "get", path: "/api/me/chats/{id}/messages", request: {
    params: z.object({ id: z.string().uuid() }),
  }, responses: { 200: json(z.array(Message), "Every message, oldest first."), ...errors } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const p = principal.fromSession(actor);
    const messages = await c.get("chats").messages(p, c.req.valid("param").id);
    if (!messages) return c.json({ error: "gone" }, 404);
    const provenance = await c.get("reader").cite(p, messages.flatMap(message => message.citations.map(citation => citation.cite)));
    return c.json(messages.map(message => ({ ...message, citations: message.citations.map(citation =>
      ({ tag: citation.tag, provenance: provenance.get(citation.cite) ?? "gone" as const })) })), 200);
  });
  routes.openapi(createRoute({ method: "post", path: "/api/me/chats/{id}/messages", request: {
    params: z.object({ id: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: z.object({ text: z.string().trim().min(1).max(4000) }).strict() } } },
  }, responses: { 200: json(Message, "The answer, citing the selected material."),
    403: json(ErrorBody, "Usage is refused, such as an exhausted Allowance."), ...errors } }), async c => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" }, 401);
    const p = principal.fromSession(actor);
    const { id } = c.req.valid("param"), { text: question } = c.req.valid("json");
    const reader = c.get("reader"), answerer = c.get("answerer");
    const retrieval = await reader.retrieve(p, { chatId: id }, { kind: "passages", text: question });
    if (retrieval.status === "refused") {
      return retrieval.reason === "not_owner" ? c.json({ error: "gone" }, 404) : c.json({ error: retrieval.reason }, 403);
    }
    const { data, citations } = retrieval.render();
    const input = { question, data, tags: citations.map(citation => citation.tag) };
    const answered = await c.get("delegation").meter(p, { microUsd: answerer.estimateMicroUsd(input) }, async signal => {
      try { return await answerer.answer(input, { signal }); }
      catch (error) {
        if (error instanceof SourceModelRejected || isDefiniteFailure(error)) throw new DefiniteFailure("Provider rejected the question");
        throw error;
      }
    });
    if (answered.status === "refused") return c.json({ error: answered.reason }, 403);
    const cited = answered.value.cited.flatMap(tag => citations.filter(citation => citation.tag === tag));
    const recorded = await c.get("chats").record(p, id, { question, answer: answered.value.text, citations: cited });
    if (!recorded) return c.json({ error: "gone" }, 404);
    return c.json({ id: recorded.id, role: "assistant" as const, text: answered.value.text,
      citations: await resolve(c.get("reader"), p, cited) }, 200);
  });
}

/** Shown citations are resolved on every read, so a deleted Source appears as "gone". */
async function resolve(reader: AppBindings["Variables"]["reader"], p: ReturnType<typeof principal.fromSession>,
  citations: { tag: string; cite: CitationRef }[]) {
  const provenance = await reader.cite(p, citations.map(citation => citation.cite));
  return citations.map(citation => ({ tag: citation.tag, provenance: provenance.get(citation.cite) ?? "gone" as const }));
}
