import { randomUUID } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { AskStep, ChatCursor, ChatMessage } from "@nunio/chat";
import type { ActionRecord, Principal } from "@nunio/delegation";
import {
  principal,
  StaleApprovalError,
  UnknownActionError,
} from "@nunio/delegation";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import type { Context } from "hono";
import type { AppBindings } from "./app.js";
import { ActionShown, describeAction, performApproved } from "./approvals.js";

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
/** Where a proposed block would be, in the student's time zone as the model gave it. */
const times = { start: z.string(), end: z.string() };
/** A proposed Study Block or Task, with the Action the student is asked to approve. */
const proposalPart = <Type extends string, Input extends z.ZodType>(
  type: Type,
  input: Input,
) =>
  z.object({
    type: z.literal(type),
    toolCallId: z.string(),
    input,
    approvalId: z.string(),
    notes: z
      .array(z.enum(["outside_study_window", "daily_limit", "work_limit"]))
      .describe("Preferences the block would break, shown before approving."),
    action: z
      .object({
        id: z.string(),
        fingerprint: z.string().nullable(),
        expiresAt: z.date().nullable(),
        status: z.enum([
          "awaiting_approval",
          "expired",
          "dispatching",
          "done",
          "failed",
          "refused",
          "unconfirmed",
        ]),
        decision: z.enum(["approved", "denied"]).nullable(),
        shown: ActionShown,
      })
      .nullable()
      .describe(
        "The Action the student is asked to approve; null if it could not be asked.",
      ),
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
    z.object({
      type: z.literal("tool-agenda"),
      toolCallId: z.string(),
      input: z.object({ from: z.string(), to: z.string() }),
      output: z.object({
        from: z.string(),
        to: z.string(),
        obligations: z.number().int(),
        studyBlocks: z.number().int(),
        fixedEvents: z.number().int(),
      }),
    }),
    z.object({
      type: z.literal("tool-courseFacts"),
      toolCallId: z.string(),
      input: z.object({ course: z.string() }),
      output: z.object({ course: z.string(), facts: z.number().int() }),
    }),
    ...(["tool-startPracticeSet", "tool-startFlashcards"] as const).map(
      (type) =>
        z.object({
          type: z.literal(type),
          toolCallId: z.string(),
          input: z.object({ topics: z.array(z.string()) }),
          output: z.object({
            kind: z.enum(["practice_set", "flashcards"]),
            topics: z.number().int(),
            artifactId: z.string(),
          }),
          artifact: z
            .object({ status: z.enum(["making", "ready", "failed"]) })
            .nullable()
            .describe(
              "Where the Artifact stands; null if it could not be started.",
            ),
        }),
    ),
    proposalPart(
      "tool-proposeStudyBlock",
      z.object({ work: z.string(), ...times }),
    ),
    proposalPart(
      "tool-proposeStudyBlockMove",
      z.object({ block: z.string(), ...times }),
    ),
    proposalPart(
      "tool-proposeStudyBlockRemove",
      z.object({ block: z.string() }),
    ),
    proposalPart(
      "tool-proposeTask",
      z.object({
        title: z.string(),
        course: z.string().optional(),
        event: z.string().optional(),
        role: z.enum(["preparation", "follow_up"]).optional(),
        minutes: z.number().int().optional(),
      }),
    ),
    proposalPart("tool-proposeTaskReopen", z.object({ task: z.string() })),
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

/** A `list` cursor in the URL: the last Chat's Last Activity and ID. */
const encodeCursor = ({ lastActivityAt, id }: ChatCursor) =>
  Buffer.from(`${lastActivityAt.toISOString()}|${id}`).toString("base64url");
const Cursor = z.string().transform((cursor, ctx): ChatCursor => {
  const [at = "", id = ""] = Buffer.from(cursor, "base64url")
    .toString()
    .split("|");
  const lastActivityAt = new Date(at);
  if (Number.isNaN(lastActivityAt.getTime()) || !id) {
    ctx.addIssue({ code: "custom", message: "Not a cursor." });
    return z.NEVER;
  }
  return { lastActivityAt, id };
});
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50),
  cursor: Cursor.optional(),
});

/**
 * Each proposal as the Action the gate asked it as: the exact Action, its fingerprint, and where it stands now. The key
 * linking them stays on the server.
 */
async function withActions(
  c: Context<AppBindings>,
  p: Principal,
  messages: ChatMessage[],
) {
  const keys = messages.flatMap((message) =>
    message.parts.flatMap((part) => ("approvalId" in part ? [part.key] : [])),
  );
  const records = keys.length
    ? await c.get("delegation").history(p, { keys })
    : [];
  const plan = records.length ? await c.get("plan").view(p) : null;
  const started = messages.some((message) =>
    message.parts.some(
      (part) =>
        part.type === "tool-startPracticeSet" ||
        part.type === "tool-startFlashcards",
    ),
  )
    ? await c.get("artifacts").list(p, {})
    : [];
  const now = new Date();
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (
        part.type === "tool-startPracticeSet" ||
        part.type === "tool-startFlashcards"
      ) {
        const made = started.find((a) => a.id === part.output.artifactId);
        return { ...part, artifact: made ? { status: made.status } : null };
      }
      if (!("approvalId" in part)) return part;
      const { key, ...shown } = part;
      const record = records.find((r) => r.key === key);
      return {
        ...shown,
        action:
          record && plan
            ? {
                id: record.id,
                fingerprint: record.approval?.fingerprint ?? null,
                expiresAt: record.approval?.expiresAt ?? null,
                status: shownStatus(record, now),
                decision: record.approval?.decision ?? null,
                shown: describeAction(plan, record.kind, record.args),
              }
            : null,
      };
    }),
  }));
}

/**
 * Where a proposal's Action stands, as its card says it. Approving after expiry leaves it refused for that reason, which
 * the student knows as expired; and only the student's own report makes it failed, so a failed attempt reads as refused.
 */
function shownStatus(record: ActionRecord, now: Date) {
  if (
    (record.status === "awaiting_approval" &&
      record.approval &&
      record.approval.expiresAt <= now) ||
    record.refusal === "approval_expired"
  )
    return "expired" as const;
  if (
    record.status === "failed" &&
    !record.events.some((event) => event.type === "resolved")
  )
    return "refused" as const;
  return record.status;
}

const stale =
  "The proposal expired or changed before the student decided, so nothing changed. Offer it again if it still fits.";

/** What the model is told of an approved proposal, by what the gate made of it. */
function outcomeOf(record: ActionRecord) {
  if (record.refusal === "approval_expired") return stale;
  if (record.status === "done")
    return record.kind === "studyBlock.remove"
      ? "The student approved the proposal, and the Study Block is removed from their Plan."
      : "The student approved the proposal, and the Study Block is now in their Plan as proposed.";
  if (record.status === "refused")
    return `The student approved it, but nunio could not perform it (${record.refusal ?? "refused"}). Tell the student, and offer another time if one fits.`;
  return "The student approved it, but nunio could not confirm that it took effect. Ask the student to check their Plan.";
}

/** The student's decision on one proposal's card; approving sends the fingerprint the card showed (ADR-0010). */
const Decision = z.discriminatedUnion("decision", [
  z
    .object({
      approvalId: z.string().max(200),
      decision: z.literal("approve"),
      fingerprint: z.string().max(200),
    })
    .strict(),
  z
    .object({ approvalId: z.string().max(200), decision: z.literal("deny") })
    .strict(),
]);
type Decision = z.infer<typeof Decision>;

/** Applies one decision from a card in the Chat, and says what the model is told of it. */
async function decideOne(
  c: Context<AppBindings>,
  p: Principal,
  actionId: string,
  d: Decision,
) {
  try {
    const decided = await c
      .get("delegation")
      .decide(
        p,
        d.decision === "approve"
          ? { kind: "approve", actionId, fingerprint: d.fingerprint }
          : { kind: "deny", actionId },
      );
    if (d.decision === "deny")
      return "The student declined the proposal, so nothing changed.";
    return outcomeOf(await performApproved(c, p, decided));
  } catch (error) {
    if (
      error instanceof StaleApprovalError ||
      error instanceof UnknownActionError
    )
      return stale;
    throw error;
  }
}

/**
 * Decides one answer's proposals from their cards in the Chat, each on its own, and streams the model's report on all
 * of them as a new answer. One decision going stale leaves the others standing.
 */
async function reportDecisions(
  c: Context<AppBindings>,
  p: Principal,
  chatId: string,
  body: { decisions: Decision[]; model?: string },
) {
  const delegation = c.get("delegation");
  const proposals = await Promise.all(
    body.decisions.map((d) => c.get("chats").proposal(p, chatId, d.approvalId)),
  );
  const keys = proposals.flatMap((proposal) =>
    proposal ? [proposal.key] : [],
  );
  if (keys.length < body.decisions.length)
    return c.json({ error: "gone" }, 404);
  if (new Set(proposals.map((proposal) => proposal!.answerId)).size > 1)
    return c.json({ error: "conflict" }, 409);
  const asked = await delegation.history(p, { keys });
  const actionIds = keys.map((key) => asked.find((a) => a.key === key)?.id);
  if (actionIds.some((id) => !id)) return c.json({ error: "gone" }, 404);
  const answerer = await c.get("chatModels").answererFor(p, body.model);
  if (!answerer) return c.json({ error: "model_unavailable" }, 422);
  const outcomes: { approvalId: string; outcome: string }[] = [];
  for (const [n, d] of body.decisions.entries())
    outcomes.push({
      approvalId: d.approvalId,
      outcome: await decideOne(c, p, actionIds[n]!, d),
    });
  await c.get("chats").decided(p, chatId);
  const stream = createUIMessageStream({
    onError: () => "Die Antwort wurde unterbrochen. Bitte versuche es erneut.",
    execute: async ({ writer }) => {
      const answerId = randomUUID();
      writer.write({ type: "start", messageId: answerId });
      const result = await c
        .get("chats")
        .report(p, chatId, outcomes, answerer, {
          signal: c.req.raw.signal,
          write: (chunk) => writer.write(chunk),
          id: answerId,
        });
      if (result.status !== "ok") {
        writer.write({
          type: "data-refused",
          data: {
            error: result.status === "refused" ? result.reason : result.status,
          },
          transient: true,
        });
        return;
      }
      writer.write({
        type: "data-committed",
        data: {
          ...(await withActions(c, p, [result.message]))[0]!,
          question: null,
        },
        transient: true,
      });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({
    stream,
    keepAliveMs: 15_000,
    headers: { "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

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
              schema: z.union([
                z
                  .object({
                    id: z.string().uuid(),
                    text: z.string().trim().min(1).max(4000),
                    model: modelChoice,
                  })
                  .strict(),
                z
                  .object({
                    decisions: z
                      .array(Decision)
                      .min(1)
                      .max(20)
                      .refine(
                        (decisions) =>
                          new Set(decisions.map((d) => d.approvalId)).size ===
                          decisions.length,
                        "Each proposal is decided once.",
                      )
                      .describe(
                        "The student's decisions on one answer's proposals, each applied on its own; the model then reports how they went in one new answer.",
                      ),
                    model: modelChoice,
                  })
                  .strict(),
              ]),
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
        409: json(
          ErrorBody,
          "The question ID is already used, or the decided proposals belong to different answers.",
        ),
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
      if ("decisions" in body) return reportDecisions(c, p, id, body);
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
              data: {
                ...(await withActions(c, p, [result.message]))[0]!,
                question: result.question,
              },
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
      path: "/api/me/chats",
      request: { query: listQuery },
      responses: {
        200: json(
          z.object({
            chats: z.array(
              z.object({
                id: z.string(),
                title: z.string().describe("The Chat's first question."),
                lastActivityAt: z.string(),
              }),
            ),
            nextCursor: z.string().nullable(),
          }),
          "The student's Chats with a question, by Last Activity.",
        ),
        400: json(ErrorBody, "Not a valid page."),
        401: errors[401],
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const { chats, nextCursor } = await c
        .get("chats")
        .list(principal.fromSession(actor), c.req.valid("query"));
      return c.json(
        {
          chats: chats.map((chat) => ({
            ...chat,
            lastActivityAt: chat.lastActivityAt.toISOString(),
          })),
          nextCursor: nextCursor && encodeCursor(nextCursor),
        },
        200,
      );
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
      if (!chat) return c.json({ error: "gone" }, 404);
      const p = principal.fromSession(actor);
      return c.json(
        { ...chat, messages: await withActions(c, p, chat.messages) },
        200,
      );
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
      return c.json(
        await withActions(c, principal.fromSession(actor), messages),
        200,
      );
    },
  );
}
