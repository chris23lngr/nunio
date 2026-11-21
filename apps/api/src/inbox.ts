import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import {
  interventionKinds,
  NotOpenError,
  UnknownInterventionError,
  UnknownNoticeError,
} from "@nunio/outreach";
import { scopeNames } from "./agents.js";
import type { AppBindings } from "./app.js";
import { ActionShown, describeAction } from "./approvals.js";
import { body, Done, errors, json, outcomes, student } from "./outcomes.js";

const Settings = z
  .object({
    briefingAtMinute: z
      .number()
      .int()
      .min(0)
      .max(1439)
      .nullable()
      .describe(
        "Minutes after local midnight in the Plan's time zone; null turns Briefings off.",
      ),
    email: z
      .boolean()
      .describe(
        "Whether nunio emails the student; the Inbox has everything either way.",
      ),
    briefingEmail: z
      .boolean()
      .describe(
        "Whether Briefings are emailed too; a one-click unsubscribe turns this off.",
      ),
    quietHours: z
      .object({
        fromMinute: z.number().int().min(0).max(1439),
        toMinute: z.number().int().min(0).max(1439),
      })
      .nullable()
      .describe(
        "When nothing goes out outside the app, in the Plan's time zone; may wrap midnight. Null when off.",
      ),
    dailyLimit: z
      .number()
      .int()
      .min(0)
      .max(50)
      .describe(
        "Alerts about Interventions and Notices per local day in the Plan's time zone; one sent by email and push counts once, and Briefings do not count.",
      ),
  })
  .openapi("OutreachSettings");

const Intervention = z
  .object({
    id: z.string(),
    kind: z.enum(interventionKinds),
    title: z
      .string()
      .describe(
        "What it is about: the work, Fact or Action, or the Agent whose Run it is, as it is now.",
      ),
    course: z.string().nullable(),
    action: z
      .lazy(() => ActionShown)
      .nullable()
      .describe("The Action it is about, as it stands now."),
    shortMinutes: z
      .number()
      .int()
      .nullable()
      .describe("A Shortfall's current size; null once it is gone."),
    run: z
      .object({
        id: z.string(),
        agentId: z.string(),
        openApprovals: z
          .number()
          .int()
          .describe("Its Approvals still open; it lapses once none is."),
      })
      .nullable()
      .describe(
        "The Agent Run whose open Approvals it is about, to open in the Agent's Activity; null for other kinds or once the Agent is deleted.",
      ),
    raisedAt: z.date(),
    state: z.enum(["open", "acknowledged", "dismissed", "lapsed"]),
    closedAt: z.date().nullable(),
  })
  .openapi("Intervention");

const Notice = z
  .object({
    id: z.string(),
    agentId: z.string(),
    agentName: z
      .string()
      .describe(
        "Shown as \"Nachricht von <Agent>\": the Agent's words, never nunio's.",
      ),
    runId: z.string().describe("The Run that sent it."),
    text: z
      .string()
      .nullable()
      .describe(
        "Plain text of at most 500 characters, never rendered as a link or formatting; null once a Source the Run had read is deleted.",
      ),
    sentAt: z.date(),
    readAt: z
      .date()
      .nullable()
      .describe("When the student first opened it; null while unread."),
    announcement: z
      .enum(["pending", "announced", "inbox_only"])
      .describe(
        "Whether a content-free email or push about it may still go out (pending), went out (announced), or never will (inbox_only), as when it was read first, the daily limit was reached, or nothing is turned on.",
      ),
  })
  .openapi("Notice");

const Briefing = z
  .object({
    id: z.string(),
    madeAt: z.date(),
    agentId: z
      .string()
      .nullable()
      .describe(
        "The Agent that wrote the Briefing; null for a past Briefing nunio wrote itself.",
      ),
    agentName: z
      .string()
      .nullable()
      .describe(
        "Shown as \"Briefing von <Agent>\": the Agent's words, never nunio's; null for a past Briefing nunio wrote itself.",
      ),
    runId: z
      .string()
      .nullable()
      .describe(
        "The Run that wrote it; null for a past Briefing nunio wrote itself.",
      ),
    text: z
      .string()
      .nullable()
      .describe(
        "Plain text of at most 1,500 characters, never rendered as a link or formatting; null on past nunio Briefings or once a Source the Run had read is deleted.",
      ),
    announcement: z
      .enum(["pending", "announced", "inbox_only"])
      .describe(
        "Whether a content-free email or push about it may still go out (pending), went out (announced), or never will (inbox_only).",
      ),
    interventions: z
      .array(z.string())
      .describe("The Interventions it bundled, by their id in this Inbox."),
    approvals: z.array(
      z.object({
        actionId: z.string(),
        action: z.lazy(() => ActionShown).nullable(),
        fingerprint: z
          .string()
          .nullable()
          .describe(
            "Sent back unchanged to approve the Action while waiting; null once closed or gone.",
          ),
        expiresAt: z
          .date()
          .nullable()
          .describe("When the Approval request expires; null once gone."),
        agent: z
          .object({ id: z.string(), preset: z.string(), name: z.string() })
          .nullable()
          .describe(
            "The Agent that asked for Approval, or null for Chat or once deleted.",
          ),
        state: z
          .enum(["waiting", "approved", "denied", "expired", "withdrawn"])
          .describe(
            "The Approval as it stands now; expired once it can no longer be given, withdrawn when its Agent was paused or ended.",
          ),
      }),
    ),
    agents: z.array(
      z.object({
        id: z.string(),
        preset: z
          .enum(["keep_course_organized", "prepare_for_exam"])
          .nullable()
          .describe("Null for a free-text Agent."),
        name: z
          .string()
          .describe(
            "Empty for a preset Agent, which is named after its scope.",
          ),
        course: z.string().nullable(),
        exam: z.string().nullable(),
      }),
    ),
    notices: z
      .array(z.string())
      .describe("The Notices it bundled, by their id in this Inbox."),
    artifacts: z
      .array(
        z.object({
          id: z.string(),
          kind: z
            .enum(["practice_set", "flashcards", "draft", "critique"])
            .nullable(),
          title: z.string().nullable(),
          course: z.string().nullable(),
          count: z.number().int().nullable(),
          state: z
            .enum(["ready", "opened", "making", "failed", "withdrawn", "gone"])
            .describe(
              "The Artifact as it stands now; withdrawn once a Source it drew from is deleted, gone once the Artifact itself is deleted.",
            ),
        }),
      )
      .describe(
        "The Artifacts it bundled, each with its state as it stands now.",
      ),
  })
  .openapi("Briefing");

const goneTitle = "Something that is gone";

export function registerInboxRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/inbox",
      responses: {
        200: json(
          z.object({
            interventions: z.array(Intervention),
            notices: z
              .array(Notice)
              .describe("The Notices the student's Agents sent, newest first."),
            briefings: z
              .array(Briefing)
              .describe("Recent Briefings, newest first."),
          }),
          "The student's Interventions, open ones first, their Agents' Notices, and recent Briefings.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const { interventions, notices, briefings } = await c
        .get("outreach")
        .inbox(p);
      if (!interventions.length && !briefings.length)
        return c.json({ interventions: [], notices, briefings: [] }, 200);
      const ids = [
        ...new Set([
          ...interventions.flatMap((i) =>
            i.subject.kind === "action" ? [i.subject.id] : [],
          ),
          ...briefings.flatMap((b) => b.approvals),
        ]),
      ];
      const needsArtifacts = briefings.some((b) => b.artifacts.length);
      const [plan, review, actions, delegated, listedArtifacts] =
        await Promise.all([
          c.get("plan").view(p),
          interventions.some((i) => i.kind === "disagreement") ||
          briefings.some((b) => b.agents.length) ||
          needsArtifacts
            ? c.get("facts").review(p)
            : null,
          ids.length
            ? c.get("delegation").history(p, { ids, limit: ids.length })
            : [],
          briefings.some((b) => b.agents.length || b.approvals.length)
            ? c.get("agents").list(p)
            : [],
          needsArtifacts ? c.get("artifacts").list(p, {}) : [],
        ]);
      const shown = (actionId: string) => {
        const a = actions.find((x) => x.id === actionId);
        return a ? describeAction(plan, a.kind, a.args) : null;
      };
      const now = new Date();
      const approvalState = (actionId: string) => {
        const a = actions.find((x) => x.id === actionId);
        if (a?.approval?.decision) return a.approval.decision;
        if (a?.refusal === "approval_withdrawn") return "withdrawn" as const;
        return a?.status === "awaiting_approval" &&
          a.approval &&
          now < a.approval.expiresAt
          ? ("waiting" as const)
          : ("expired" as const);
      };
      const courseTitleById = new Map(
        (review?.courses ?? []).map((course) => [course.id, course.title]),
      );
      const artifactById = new Map(listedArtifacts.map((a) => [a.id, a]));
      const artifactView = (artifactId: string) => {
        const a = artifactById.get(artifactId);
        if (!a)
          return {
            id: artifactId,
            kind: null,
            title: null,
            course: null,
            count: null,
            state: "gone" as const,
          };
        const state = a.withdrawn
          ? ("withdrawn" as const)
          : a.status === "failed"
            ? ("failed" as const)
            : a.status === "making"
              ? ("making" as const)
              : a.openedAt !== null
                ? ("opened" as const)
                : ("ready" as const);
        return {
          id: a.id,
          kind: a.kind,
          title: a.title,
          course: a.courseId ? (courseTitleById.get(a.courseId) ?? null) : null,
          count: a.count,
          state,
        };
      };
      const work = new Map([
        ...plan.obligations.map(
          (o) => [o.id, { title: o.title, course: o.course }] as const,
        ),
        ...plan.tasks.map(
          (t) =>
            [
              t.id,
              {
                title: t.title,
                course:
                  plan.obligations.find((o) => o.id === t.obligationId)
                    ?.course ?? null,
              },
            ] as const,
        ),
      ]);
      const flagged = new Map(
        (review?.courses ?? []).flatMap((course) => [
          ...course.obligations.map(
            (o) => [o.id, { title: o.title, course: course.title }] as const,
          ),
          ...course.facts.map(
            (f) => [f.id, { title: f.value, course: course.title }] as const,
          ),
        ]),
      );
      return c.json(
        {
          interventions: interventions.map(({ subject, run, ...i }) => {
            const action = subject.kind === "action" ? shown(subject.id) : null;
            const about =
              subject.kind === "work"
                ? work.get(subject.id)
                : subject.kind === "action"
                  ? action?.work
                  : subject.kind === "run"
                    ? run && { title: run.agentName, course: null }
                    : flagged.get(subject.id);
            return {
              ...i,
              title: about?.title ?? goneTitle,
              course: about?.course ?? null,
              action,
              run: run && {
                id: subject.id,
                agentId: run.agentId,
                openApprovals: run.openApprovals,
              },
              shortMinutes:
                subject.kind === "work"
                  ? (plan.proposal.shortfalls.find(
                      (s) => s.workId === subject.id,
                    )?.shortMinutes ?? null)
                  : null,
            };
          }),
          briefings: briefings.map((b) => ({
            ...b,
            approvals: b.approvals.map((actionId) => {
              const a = actions.find((x) => x.id === actionId);
              const state = approvalState(actionId);
              const ag = a?.agentId
                ? delegated.find((x) => x.id === a.agentId)
                : undefined;
              return {
                actionId,
                action: shown(actionId),
                fingerprint:
                  state === "waiting"
                    ? (a?.approval?.fingerprint ?? null)
                    : null,
                expiresAt: a?.approval?.expiresAt ?? null,
                agent: a?.agentId
                  ? {
                      id: a.agentId,
                      preset: ag?.preset ?? "",
                      name: ag?.name ?? "",
                    }
                  : null,
                state,
              };
            }),
            agents: b.agents.flatMap((id) => {
              const r = delegated.find((x) => x.id === id);
              if (!r || !review) return [];
              const { course, exam } = scopeNames(review, r.scope);
              return [
                {
                  id,
                  preset: r.preset,
                  name: r.name,
                  course: course?.title ?? null,
                  exam: exam?.title ?? null,
                },
              ];
            }),
            artifacts: b.artifacts.map(artifactView),
          })),
          notices,
        },
        200,
      );
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/notices/{id}/read",
      description:
        "The student opened the Notice. It stays read, and an announcement of it not yet sent no longer goes out.",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: Done,
        400: outcomes[400],
        401: errors[401],
        404: errors[404],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      try {
        await c.get("outreach").readNotice(p, c.req.valid("param").id);
      } catch (error) {
        if (error instanceof UnknownNoticeError)
          return c.json({ error: "gone" }, 404);
        throw error;
      }
      return c.json({ status: "ok" as const }, 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/interventions/{id}",
      request: {
        params: z.object({ id: z.string().uuid() }),
        ...body(
          z.object({
            as: z
              .enum(["acknowledged", "dismissed"])
              .describe(
                "Acknowledged means noted; dismissed means it was not useful.",
              ),
          }),
        ),
      },
      responses: { 200: Done, ...outcomes },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      try {
        await c
          .get("outreach")
          .close(p, c.req.valid("param").id, c.req.valid("json").as);
      } catch (error) {
        if (error instanceof UnknownInterventionError)
          return c.json({ error: "gone" }, 404);
        if (error instanceof NotOpenError)
          return c.json({ error: "closed" }, 409);
        throw error;
      }
      return c.json({ status: "ok" as const }, 200);
    },
  );
}

export function registerOutreachSettingsRoutes(
  routes: OpenAPIHono<AppBindings>,
) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/outreach-settings",
      responses: {
        200: json(Settings, "How the student wants to hear from nunio."),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return c.json(await c.get("outreach").settings(p), 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "patch",
      path: "/api/me/outreach-settings",
      request: { ...body(Settings.partial()) },
      responses: {
        200: json(Settings, "The settings as they now are."),
        400: outcomes[400],
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return c.json(
        await c.get("outreach").updateSettings(p, c.req.valid("json")),
        200,
      );
    },
  );
}

const Subscription = z
  .object({
    endpoint: z.string().url().startsWith("https://"),
    expirationTime: z.number().nullable(),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  })
  .describe("The device's PushSubscription.toJSON(); its endpoint is a secret.")
  .openapi("PushSubscription");

export function registerPushRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/push-key",
      responses: {
        200: json(
          z.object({ publicKey: z.string() }),
          "The VAPID public key a device subscribes with.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      return c.json({ publicKey: c.get("outreach").pushKey }, 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "post",
      path: "/api/me/push-subscriptions",
      request: { ...body(Subscription) },
      responses: { 200: Done, 400: outcomes[400], 401: errors[401] },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      await c.get("outreach").subscribe(p, c.req.valid("json"));
      return c.json({ status: "ok" as const }, 200);
    },
  );
  routes.openapi(
    createRoute({
      method: "delete",
      path: "/api/me/push-subscriptions",
      request: { ...body(z.object({ endpoint: z.string() })) },
      responses: { 200: Done, 400: outcomes[400], 401: errors[401] },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      await c.get("outreach").unsubscribe(p, c.req.valid("json").endpoint);
      return c.json({ status: "ok" as const }, 200);
    },
  );
}
