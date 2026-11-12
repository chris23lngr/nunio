import { randomUUID } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { AskStep } from "@nunio/chat";
import { principal } from "@nunio/delegation";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { AppBindings } from "./app.js";

const Provenance = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("correction") }),
  z.object({ kind: z.literal("entry") }),
  z.object({
    kind: z.literal("source"),
    sourceId: z.string(),
    title: z.string(),
    location: z.object({ page: z.number().int() }),
  }),
]);
const Citation = z.object({
  tag: z.string(),
  provenance: z
    .union([Provenance, z.literal("gone")])
    .describe('Resolved when shown; "gone" once its Source is deleted.'),
});
const Part = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("reasoning"), text: z.string() }),
    z.object({ type: z.literal("text"), text: z.string() }),
    z.object({
      type: z.literal("tool-searchMaterial"),
      toolCallId: z.string(),
      input: z.object({ query: z.string() }),
      output: z.object({
        found: z.number().int(),
        sources: z.array(z.string()),
      }),
    }),
  ])
  .openapi("ChatMessagePart");
const Message = z
  .object({
    id: z.string(),
    role: z.enum(["student", "assistant"]),
    createdAt: z.string().datetime(),
    text: z
      .string()
      .nullable()
      .describe(
        "Null once a Source the answer drew on is deleted: its wording is removed with that Source.",
      ),
    reasoning: z
      .string()
      .optional()
      .describe(
        "Model reasoning, absent for older messages or once a dependent Source is deleted.",
      ),
    parts: z
      .array(Part)
      .describe(
        "The message's reasoning, searches and text in the order shown; empty once withdrawn.",
      ),
    citations: z.array(Citation),
    model: z
      .object({ key: z.string(), name: z.string() })
      .nullable()
      .describe(
        "The Model Catalog entry that wrote an answer; null for questions and older answers.",
      ),
  })
  .openapi("ChatMessage");
const ChatModelList = z
  .object({
    models: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        provider: z.string(),
        description: z.string(),
        dataHandling: z.object({
          provider: z.literal("OpenRouter"),
          upstream: z.array(z.string()),
          routing: z.literal("international"),
          zeroRetention: z.literal(true),
        }),
        cost: z.object({
          relativeToDefault: z
            .number()
            .describe(
              "Price relative to the default Model, from synced prices.",
            ),
          tier: z.enum(["low", "medium", "high"]),
        }),
      }),
    ),
    default: z.string().nullable(),
    selected: z
      .string()
      .nullable()
      .describe(
        "The student's remembered choice while offered, else the default.",
      ),
  })
  .openapi("ChatModelList");
const modelChoice = z
  .string()
  .max(100)
  .optional()
  .describe(
    "A Model Catalog key from GET /api/me/models; without one, the remembered choice or the default answers.",
  );
const Selection = z
  .object({
    courseIds: z.array(z.string().uuid()).max(50),
    sourceIds: z.array(z.string().uuid()).max(200),
  })
  .strict()
  .describe("The Courses and Sources the Chat may read; empty means none.");
const ErrorBody = z.object({ error: z.string() });
const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  401: json(ErrorBody, "Sign in required."),
  404: json(ErrorBody, "The Chat is gone."),
};
const chatParams = z.object({ id: z.string().uuid() });

export function registerChatRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/models",
      responses: {
        200: json(
          ChatModelList,
          "The Models the student may choose for Chat answers.",
        ),
        401: json(ErrorBody, "Sign in required."),
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      return c.json(
        await c.get("chatModels").list(principal.fromSession(actor)),
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/chats/{id}/messages/stream",
      request: {
        params: chatParams,
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z
                .object({
                  id: z.string().uuid(),
                  text: z.string().trim().min(1).max(4000),
                  model: modelChoice,
                })
                .strict(),
            },
          },
        },
      },
      responses: {
        200: {
          description:
            "AI SDK UI message SSE: a start chunk carrying the answer's ID, then each model step's reasoning, tool and provisional text chunks, followed by data-committed containing the persisted question and answer, or data-refused/error. EOF alone does not confirm persistence.",
          content: { "text/event-stream": { schema: z.string() } },
        },
        ...errors,
        409: json(ErrorBody, "The question ID is already used."),
        422: json(
          ErrorBody,
          "model_unavailable: the chosen Model is not offered.",
        ),
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const p = principal.fromSession(actor);
      const id = c.req.valid("param").id;
      const body = c.req.valid("json");
      const started = performance.now();
      const timing: Partial<
        Record<AskStep | "detail" | "firstReasoning" | "firstText", number>
      > = {};
      const mark = (step: "detail" | "firstReasoning" | "firstText") => {
        timing[step] ??= Math.round(performance.now() - started);
      };
      const [chat, reused] = await Promise.all([
        c.get("chats").detail(p, id),
        c.get("chats").hasMessage(p, body.id),
      ]);
      mark("detail");
      if (!chat) return c.json({ error: "gone" }, 404);
      if (reused) return c.json({ error: "conflict" }, 409);
      const answerer = await c.get("chatModels").answererFor(p, body.model);
      if (!answerer) return c.json({ error: "model_unavailable" }, 422);
      const stream = createUIMessageStream({
        onError: () =>
          "Die Antwort wurde unterbrochen. Bitte versuche es erneut.",
        execute: async ({ writer }) => {
          const answerId = randomUUID();
          writer.write({ type: "start", messageId: answerId });
          let outcome = "interrupted";
          try {
            const result = await c
              .get("chats")
              .ask(p, id, body.text, answerer, {
                signal: c.req.raw.signal,
                ids: { question: body.id, answer: answerId },
                onStep: (step, ms) => {
                  timing[step] = Math.round(ms);
                },
                write: (chunk) => {
                  if (chunk.type === "reasoning-delta") mark("firstReasoning");
                  if (chunk.type === "text-delta") mark("firstText");
                  writer.write(chunk);
                },
              });
            if (result.status !== "ok") {
              writer.write({
                type: "data-refused",
                data: {
                  error:
                    result.status === "refused" ? result.reason : result.status,
                },
                transient: true,
              });
              outcome = "refused";
              return;
            }
            writer.write({
              type: "data-committed",
              data: { ...result.message, question: result.question },
              transient: true,
            });
            writer.write({ type: "finish" });
            outcome = "committed";
          } finally {
            console.log(
              JSON.stringify({
                msg: "chat answer timing",
                outcome,
                ...timing,
                total: Math.round(performance.now() - started),
              }),
            );
          }
        },
      });
      return createUIMessageStreamResponse({
        stream,
        keepAliveMs: 15_000,
        headers: { "cache-control": "no-store", "x-accel-buffering": "no" },
      });
    },
  );

  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/chats/{id}",
      request: { params: chatParams },
      responses: {
        200: json(
          z.object({
            id: z.string(),
            courses: z.array(
              z.object({
                id: z.string(),
                title: z.string(),
                code: z.string().nullable(),
              }),
            ),
            messages: z.array(Message),
          }),
          "The Chat and its fixed selection.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const chat = await c
        .get("chats")
        .detail(principal.fromSession(actor), c.req.valid("param").id);
      return chat ? c.json(chat, 200) : c.json({ error: "gone" }, 404);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/chats",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: Selection } },
        },
      },
      responses: {
        201: json(z.object({ id: z.string() }), "Created."),
        404: json(
          ErrorBody,
          "A selected Course or Source is gone or not the student's.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const created = await c
        .get("chats")
        .create(principal.fromSession(actor), c.req.valid("json"));
      if (created.status === "gone") return c.json({ error: "gone" }, 404);
      return c.json({ id: created.id }, 201);
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/chats/{id}/messages",
      request: { params: chatParams },
      responses: {
        200: json(z.array(Message), "Every message, oldest first."),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const messages = await c
        .get("chats")
        .messages(principal.fromSession(actor), c.req.valid("param").id);
      if (!messages) return c.json({ error: "gone" }, 404);
      return c.json(messages, 200);
    },
  );
}
