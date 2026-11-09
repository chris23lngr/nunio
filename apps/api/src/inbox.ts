import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { NotOpenError, UnknownInterventionError } from "@nunio/outreach";
import type { AppBindings } from "./app.js";
import { ActionShown, describeAction } from "./approvals.js";
import { body, Done, errors, json, outcomes, student } from "./outcomes.js";

const Intervention = z
  .object({
    id: z.string(),
    kind: z.enum([
      "shortfall",
      "disagreement",
      "approval_expired",
      "unconfirmed",
    ]),
    title: z
      .string()
      .describe("What it is about: the work, Fact or Action, as it is now."),
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
    raisedAt: z.date(),
    state: z.enum(["open", "acknowledged", "dismissed", "lapsed"]),
    closedAt: z.date().nullable(),
  })
  .openapi("Intervention");

const gone = "Something that is gone";

export function registerInboxRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(
    createRoute({
      method: "get",
      path: "/api/me/inbox",
      responses: {
        200: json(
          z.object({ interventions: z.array(Intervention) }),
          "The student's Interventions, open ones first.",
        ),
        401: errors[401],
      },
    }),
    async (c) => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const { interventions } = await c.get("outreach").inbox(p);
      if (!interventions.length) return c.json({ interventions: [] }, 200);
      const ids = interventions.flatMap((i) =>
        i.subject.kind === "action" ? [i.subject.id] : [],
      );
      const [plan, review, actions] = await Promise.all([
        c.get("plan").view(p),
        interventions.some((i) => i.kind === "disagreement")
          ? c.get("facts").review(p)
          : null,
        ids.length ? c.get("delegation").history(p, { ids }) : [],
      ]);
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
          interventions: interventions.map(({ subject, ...i }) => {
            const a = actions.find((x) => x.id === subject.id);
            const action =
              subject.kind === "action" && a
                ? describeAction(plan, a.kind, a.args)
                : null;
            const about =
              subject.kind === "work"
                ? work.get(subject.id)
                : subject.kind === "action"
                  ? action?.work
                  : flagged.get(subject.id);
            return {
              ...i,
              title: about?.title ?? gone,
              course: about?.course ?? null,
              action,
              shortMinutes:
                subject.kind === "work"
                  ? (plan.proposal.shortfalls.find(
                      (s) => s.workId === subject.id,
                    )?.shortMinutes ?? null)
                  : null,
            };
          }),
        },
        200,
      );
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
