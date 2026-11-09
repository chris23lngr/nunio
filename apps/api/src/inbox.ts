import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { NotOpenError, UnknownInterventionError } from "@nunio/outreach";
import type { AppBindings } from "./app.js";
import { ActionShown, describeAction } from "./approvals.js";
import { body, Done, errors, json, outcomes, student } from "./outcomes.js";

const Intervention = z
  .object({
    id: z.string(),
    kind: z.enum(["approval_expired", "unconfirmed"]),
    action: z
      .lazy(() => ActionShown)
      .nullable()
      .describe("The Action it is about, as it stands now."),
    raisedAt: z.date(),
    state: z.enum(["open", "acknowledged", "dismissed"]),
    closedAt: z.date().nullable(),
  })
  .openapi("Intervention");

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
      const ids = interventions.flatMap((i) =>
        i.actionId ? [i.actionId] : [],
      );
      const actions = ids.length
        ? new Map(
            (await c.get("delegation").history(p, { ids })).map((a) => [
              a.id,
              a,
            ]),
          )
        : new Map();
      const plan = actions.size ? await c.get("plan").view(p) : null;
      return c.json(
        {
          interventions: interventions.map(({ actionId, ...i }) => {
            const a = actionId ? actions.get(actionId) : undefined;
            return {
              ...i,
              action: a && plan ? describeAction(plan, a.kind, a.args) : null,
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
