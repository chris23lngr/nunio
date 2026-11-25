import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { Principal } from "@nunio/delegation";
import { isHandedIn, principal } from "@nunio/delegation";
import type { Context } from "hono";
import type { AppBindings } from "./app.js";
import { AiUse } from "./review.js";

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
const Kind = z.enum(["practice_set", "flashcards", "draft", "critique"]);
const ArtifactBase = z.object({
  id: z.string(),
  kind: Kind,
  status: z.enum(["making", "ready", "failed"]),
  failure: z.string().nullable(),
  topicIds: z.array(z.string()),
  obligationId: z.string().nullable(),
  createdAt: z.date(),
  openedAt: z.date().nullable(),
  withdrawn: z
    .boolean()
    .describe("A Source it was drawn from is deleted, so its content is gone."),
});
export const ArtifactSummary = ArtifactBase.extend({
  title: z
    .string()
    .nullable()
    .describe(
      "Its own title, else its Obligation's or its Topics' names; null when none is known.",
    ),
  courseId: z.string().nullable(),
  count: z
    .number()
    .int()
    .nullable()
    .describe(
      "Its items or cards; null for a text, and until made or once withdrawn.",
    ),
  version: z
    .number()
    .int()
    .nullable()
    .describe("Its latest version; null until made."),
  updatedAt: z.date().nullable().describe("When its latest version was made."),
  lastPractisedAt: z
    .date()
    .nullable()
    .describe("When the student last answered one of its Practice Items."),
  shaky: z
    .boolean()
    .describe("The student calls one of its Topics weak or shaky."),
}).openapi("ArtifactSummary");
const Content = z.union([
  z.object({
    title: z
      .string()
      .nullable()
      .describe("Null for a practice set made before titles."),
    items: z.array(
      z.object({
        id: z.string(),
        topicIds: z.array(z.string()),
        question: z.string(),
        answer: z.string(),
        citations: z.array(Citation),
      }),
    ),
  }),
  z.object({
    title: z
      .string()
      .nullable()
      .describe("Null for flashcards made before titles."),
    cards: z.array(
      z.object({
        id: z.string(),
        topicIds: z.array(z.string()),
        front: z.string(),
        back: z.string(),
        citations: z.array(Citation),
      }),
    ),
  }),
  z.object({ text: z.string(), citations: z.array(Citation) }),
]);
const ArtifactView = ArtifactBase.extend({
  version: z.number().int().nullable(),
  content: Content.nullable().describe("Null until made, and once withdrawn."),
}).openapi("Artifact");
const From = z.union([
  z.object({ chatId: z.string().uuid() }).strict(),
  z
    .object({
      selection: z
        .object({
          courseIds: z.array(z.string().uuid()).max(50),
          sourceIds: z.array(z.string().uuid()).max(200),
        })
        .strict(),
    })
    .strict(),
]);
const ArtifactRequest = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.enum(["practice_set", "flashcards"]),
        topicIds: z.array(z.string().uuid()).min(1).max(20),
        from: From,
      })
      .strict(),
    z
      .object({
        kind: z.literal("draft"),
        obligationId: z.string().uuid(),
        instructions: z.string().max(4000),
        conditionsConfirmed: z.literal(true).optional(),
        from: From,
      })
      .strict(),
    z
      .object({
        kind: z.literal("critique"),
        obligationId: z.string().uuid(),
        of: z.union([
          z.object({ ownWork: z.string().min(1).max(50_000) }).strict(),
          z
            .object({
              artifactId: z.string().uuid(),
              version: z.number().int().positive(),
            })
            .strict(),
        ]),
        conditionsConfirmed: z.literal(true).optional(),
        from: From,
      })
      .strict(),
  ])
  .openapi("ArtifactRequest");
const Attempt = z
  .object({
    id: z.string(),
    artifactId: z.string(),
    itemId: z.string(),
    topicIds: z.array(z.string()),
    text: z.string(),
    verdict: z
      .enum(["correct", "partial", "incorrect"])
      .nullable()
      .describe("Null while ungraded; an ungraded Attempt does not count."),
    feedback: z
      .object({ text: z.string(), citations: z.array(Citation) })
      .nullable()
      .describe(
        "Null while ungraded, and once a Source of its practice set is deleted.",
      ),
    ungradedReason: z
      .enum([
        "grader_failed",
        "allowance_exhausted",
        "ai_disabled",
        "not_entitled",
        "deletion_pending",
        "budget_exhausted",
        "paused",
        "ended",
      ])
      .nullable()
      .describe("Why grading failed; null once graded."),
    createdAt: z.date(),
  })
  .openapi("Attempt");
const Level = z
  .object({
    topicId: z.string(),
    level: z
      .enum(["not_studied", "weak", "shaky", "solid"])
      .describe(
        "The student's latest Self-assessment; not_studied without one.",
      ),
    latestAttempt: z
      .object({
        verdict: z.enum(["correct", "partial", "incorrect"]),
        at: z.date(),
      })
      .nullable()
      .describe(
        "The latest graded Attempt, shown beside the Level; it never moves it.",
      ),
    lastEvidenceAt: z.date().nullable(),
  })
  .openapi("UnderstandingLevel");
const Evidence = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("attempt"), attempt: Attempt }),
    z.object({
      kind: z.literal("self_assessment"),
      level: Level.shape.level,
      at: z.date(),
    }),
  ])
  .openapi("Evidence");
/** The student's Artifacts as listed, each marked shaky when the student calls one of its Topics weak or shaky. */
export async function listArtifacts(
  c: Context<AppBindings>,
  p: Principal,
  q: { ready?: true; derivedFrom?: string },
) {
  const listed = await c.get("artifacts").list(p, q);
  const levels = await c
    .get("understanding")
    .levelsOfTopics(p, [...new Set(listed.flatMap((a) => a.topicIds))]);
  const shaky = new Set(
    levels
      .filter((l) => l.level === "weak" || l.level === "shaky")
      .map((l) => l.topicId),
  );
  return listed.map((a) => ({
    ...a,
    shaky: a.topicIds.some((id) => shaky.has(id)),
  }));
}
/** Assessed work nunio may draft or critique: exams and registrations are not handed in. */
const handedIn = ["assignment", "presentation", "thesis", "other"] as const;
const ErrorBody = z.object({ error: z.string() });
const json = (schema: z.ZodType, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const errors = {
  401: json(ErrorBody, "Sign in required."),
  404: json(ErrorBody, "Not the student's, or gone."),
};

export function registerStudyRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/artifacts",
      description:
        "Ask for an Artifact. Its Run is recorded and pinned, and its workflow started; poll the Artifact until it is ready or failed.",
      request: {
        body: {
          required: true,
          content: { "application/json": { schema: ArtifactRequest } },
        },
      },
      responses: {
        202: json(
          z.object({ artifactId: z.string(), runId: z.string() }),
          "Being made.",
        ),
        409: json(
          ErrorBody,
          "Refused: ai_use_unknown (ask the student), ai_use_forbidden, ai_use_conditions (show the rule and confirm), or not_handed_in.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("artifacts")
        .request(principal.fromSession(actor), c.req.valid("json"));
      if (result.status === "refused")
        return result.reason === "gone"
          ? c.json({ error: "gone" }, 404)
          : c.json({ error: result.reason }, 409);
      await c.get("artifactWorkflows").start(result.runId);
      return c.json(
        { artifactId: result.artifactId, runId: result.runId },
        202,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/artifacts",
      request: {
        query: z.object({
          ready: z
            .enum(["true"])
            .optional()
            .describe("Only finished Artifacts the student has not opened."),
          derivedFrom: z
            .string()
            .uuid()
            .optional()
            .describe("Only those deleting this Source would withdraw."),
        }),
      },
      responses: {
        200: json(z.array(ArtifactSummary), "Newest first."),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const { ready, derivedFrom } = c.req.valid("query");
      return c.json(
        await listArtifacts(c, principal.fromSession(actor), {
          ...(ready ? { ready: true as const } : {}),
          ...(derivedFrom ? { derivedFrom } : {}),
        }),
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/artifacts/{id}",
      description:
        "Shows an Artifact, its latest version unless one is named, and marks it opened.",
      request: {
        params: z.object({ id: z.string().uuid() }),
        query: z.object({
          version: z.coerce.number().int().positive().optional(),
        }),
      },
      responses: { 200: json(ArtifactView, "The Artifact."), ...errors },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const view = await c
        .get("artifacts")
        .open(
          principal.fromSession(actor),
          c.req.valid("param").id,
          c.req.valid("query").version,
        );
      if (view === "gone") return c.json({ error: "gone" }, 404);
      return c.json(view, 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/artifacts/{id}/versions",
      description:
        "The student's edit of a set of flashcards or a draft, as a new version. A card keeps its id, and so its Anki GUID; a card without one is new.",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z
                .object({
                  baseVersion: z.number().int().positive(),
                  content: z.union([
                    z
                      .object({
                        cards: z
                          .array(
                            z
                              .object({
                                id: z.string().max(20).optional(),
                                front: z.string().max(2000),
                                back: z.string().max(8000),
                              })
                              .strict(),
                          )
                          .max(500),
                      })
                      .strict(),
                    z.object({ text: z.string().max(100_000) }).strict(),
                  ]),
                })
                .strict(),
            },
          },
        },
      },
      responses: {
        201: json(z.object({ version: z.number().int() }), "Saved."),
        409: json(
          ErrorBody,
          "stale (edited meanwhile; reload), withdrawn (a Source is deleted), or not_editable.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("artifacts")
        .edit(
          principal.fromSession(actor),
          c.req.valid("param").id,
          c.req.valid("json"),
        );
      if (result.status === "ok")
        return c.json({ version: result.version }, 201);
      if (result.status === "gone") return c.json({ error: "gone" }, 404);
      return c.json({ error: result.status }, 409);
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/artifacts/{id}/anki.tsv",
      description:
        "The latest version of a set of flashcards as an Anki text file; re-importing an edited version updates the notes.",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: {
          description: "The Anki text file, as a download.",
          content: { "text/tab-separated-values": { schema: z.string() } },
        },
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const exported = await c
        .get("artifacts")
        .exportFlashcards(
          principal.fromSession(actor),
          c.req.valid("param").id,
        );
      if (exported === "gone") return c.json({ error: "gone" }, 404);
      return c.body(exported.tsv, 200, {
        "content-type": "text/tab-separated-values; charset=utf-8",
        "content-disposition": `attachment; filename="${exported.filename}"`,
      });
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/artifacts/{id}/attempts",
      description:
        "The latest Attempt on each Practice Item of a practice set that the student answered.",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: json(z.array(Attempt), "One per answered item."),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const latest = await c
        .get("understanding")
        .latestAttempts(principal.fromSession(actor), c.req.valid("param").id);
      if (latest === "gone") return c.json({ error: "gone" }, 404);
      return c.json(latest, 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/artifacts/{id}/attempts",
      description:
        "The student's answers to Practice Items of a practice set, recorded and then graded together. An item not in the set refuses them all; a failed grading keeps that Attempt, ungraded.",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z
                .object({
                  answers: z
                    .array(
                      z
                        .object({
                          itemId: z.string().max(20),
                          text: z.string().min(1).max(20_000),
                        })
                        .strict(),
                    )
                    .min(1)
                    .max(50),
                })
                .strict(),
            },
          },
        },
      },
      responses: {
        201: json(z.array(Attempt), "Recorded, one per answer."),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("understanding")
        .answer(
          principal.fromSession(actor),
          c.req.valid("param").id,
          c.req.valid("json").answers,
        );
      if (result.status === "refused") return c.json({ error: "gone" }, 404);
      return c.json(result.attempts, 201);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/topics/{id}/self-assessment",
      description:
        "The student's own statement about a Topic, which sets its Level.",
      request: {
        params: z.object({ id: z.string().uuid() }),
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({ level: Level.shape.level }).strict(),
            },
          },
        },
      },
      responses: {
        200: json(z.object({ status: z.literal("ok") }), "Recorded."),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const result = await c
        .get("understanding")
        .selfAssess(
          principal.fromSession(actor),
          c.req.valid("param").id,
          c.req.valid("json").level,
        );
      if (result.status === "gone") return c.json({ error: "gone" }, 404);
      return c.json({ status: "ok" as const }, 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/courses/{id}/levels",
      description:
        "The Understanding Level of each of the Course's Topics: the student's own, set by Self-assessment. It never fades.",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: json(z.array(Level), "One per Topic."), ...errors },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      return c.json(
        await c.get("understanding").levels(principal.fromSession(actor), {
          courseId: c.req.valid("param").id,
        }),
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/courses/{id}/artifact-options",
      description:
        "What the student can ask an Artifact on in a Course: its Topics with their Understanding Level, and the Obligations nunio may draft or critique for, soonest first, each with its AI-use Rule.",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: json(
          z
            .object({
              topics: z.array(
                z.object({
                  id: z.string(),
                  title: z.string(),
                  level: Level.shape.level,
                }),
              ),
              obligations: z.array(
                z.object({
                  id: z.string(),
                  title: z.string(),
                  kind: z.enum(handedIn),
                  due: z.object({
                    date: z.string().nullable(),
                    time: z.string().nullable(),
                    timeZone: z.string().nullable(),
                  }),
                  aiUse: AiUse,
                }),
              ),
            })
            .openapi("ArtifactOptions"),
          "The Course's options.",
        ),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const p = principal.fromSession(actor);
      const course = (await c.get("facts").review(p)).courses.find(
        (found) =>
          found.id === c.req.valid("param").id &&
          found.status !== "rejected" &&
          found.status !== "merged",
      );
      if (!course) return c.json({ error: "gone" }, 404);
      const topics = course.facts.filter(
        (fact) => fact.type === "topic" && fact.state !== "rejected",
      );
      const levels = await c.get("understanding").levelsOfTopics(
        p,
        topics.map((topic) => topic.id),
      );
      const obligations = course.obligations
        .filter(
          (o): o is typeof o & { kind: (typeof handedIn)[number] } =>
            o.state !== "rejected" &&
            !isHandedIn(o) &&
            (handedIn as readonly string[]).includes(o.kind),
        )
        // Undated ones last.
        .sort((a, b) =>
          (a.due.date ?? "9999").localeCompare(b.due.date ?? "9999"),
        );
      return c.json(
        {
          topics: topics.map((topic) => ({
            id: topic.id,
            title: topic.value,
            level:
              levels.find((l) => l.topicId === topic.id)?.level ??
              "not_studied",
          })),
          obligations: await Promise.all(
            obligations.map(async (o) => {
              const aiUse = await c.get("facts").aiUse(p, o.id);
              return {
                id: o.id,
                title: o.title,
                kind: o.kind,
                due: {
                  date: o.due.date,
                  time: o.due.time,
                  timeZone: o.due.timeZone,
                },
                aiUse:
                  aiUse === "gone"
                    ? { status: "unknown" as const, reason: "none" as const }
                    : aiUse,
              };
            }),
          ),
        },
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/topics/{id}/evidence",
      description: "A Topic's Evidence, newest first.",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 200: json(z.array(Evidence), "Newest first."), ...errors },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      return c.json(
        await c
          .get("understanding")
          .history(principal.fromSession(actor), c.req.valid("param").id),
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/obligations/{id}/handoff",
      description:
        "What the student needs to hand the Obligation in themselves: its Destination wording, its AI-use Rule (with any conditions, such as declaring AI use) and their drafts. Nothing is sent anywhere; the student then reports it as submitted.",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: json(
          z
            .object({
              obligation: z.object({
                id: z.string(),
                title: z.string(),
                due: z.object({
                  date: z.string().nullable(),
                  time: z.string().nullable(),
                  timeZone: z.string().nullable(),
                }),
                destination: z
                  .string()
                  .nullable()
                  .describe(
                    "As the Source states it, or the student's Correction; never verified.",
                  ),
                reportedSubmittedAt: z.date().nullable(),
              }),
              rule: AiUse,
              drafts: z.array(
                z.object({
                  id: z.string(),
                  version: z.number().int(),
                  createdAt: z.date(),
                }),
              ),
            })
            .openapi("Handoff"),
          "The Handoff.",
        ),
        409: json(ErrorBody, "not_handed_in: an exam or registration."),
        ...errors,
      },
    }),
    async (c) => {
      c.header("cache-control", "no-store");
      const actor = await c.get("auth").authenticate(c.req.raw);
      if (!actor) return c.json({ error: "unauthorized" }, 401);
      const handoff = await c
        .get("artifacts")
        .handoff(principal.fromSession(actor), c.req.valid("param").id);
      if (handoff === "gone") return c.json({ error: "gone" }, 404);
      if (handoff === "not_handed_in")
        return c.json({ error: "not_handed_in" }, 409);
      return c.json(handoff, 200);
    },
  );
}
