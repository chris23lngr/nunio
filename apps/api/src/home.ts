import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "./app.js";
import { errors, json, student } from "./outcomes.js";

const Attention = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shortfall"), workId: z.string(), title: z.string(), course: z.string().nullable(), due: z.date(),
    shortMinutes: z.number().int(), tradeoffs: z.array(z.record(z.string(), z.unknown())) }),
  z.object({ kind: z.literal("disagreement"), item: z.object({ kind: z.enum(["obligation", "fact"]), id: z.string() }), title: z.string(), course: z.string() }),
  z.object({ kind: z.literal("locked_conflict"), blockId: z.string() }),
  z.object({ kind: z.literal("unplanned"), workId: z.string(), title: z.string(), reason: z.enum(["no_estimate", "no_deadline", "past_due"]) }),
]);
const HomeView = z.object({
  attention: z.array(Attention).describe("What needs the student's decision: Shortfalls with tradeoffs first, never resolved silently."),
  ongoing: z.array(z.object({ kind: z.literal("source"), id: z.string(), title: z.string(), activity: z.enum(["processing", "reading"]) })),
  artifacts: z.array(z.never()).describe("Ready Artifacts; produced from Phase 11."),
  agentWork: z.array(z.never()).describe("Runs in progress; arriving with Phase 9."),
}).openapi("Home");

export function registerHomeRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(createRoute({ method: "get", path: "/api/me/home", responses: { 200: json(HomeView, "The student's actionable day."), 401: errors[401] } }),
    async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const [plan, review, sources] = await Promise.all([c.get("plan").view(p), c.get("facts").review(p), c.get("sources").list(p)]);
      const work = new Map([
        ...plan.obligations.map(o => [o.id, { title: o.title, course: o.course }] as const),
        ...plan.tasks.map(t => [t.id, { title: t.title, course: plan.obligations.find(o => o.id === t.obligationId)?.course ?? null }] as const),
      ]);
      const titleOf = (id: string) => work.get(id) ?? { title: "Untitled", course: null };
      const attention = [
        ...plan.proposal.shortfalls.map(s => ({ kind: "shortfall" as const, ...titleOf(s.workId), ...s })),
        ...review.courses.flatMap(course => [
          ...course.obligations.filter(o => o.disagreement).map(o => ({ kind: "disagreement" as const, item: { kind: "obligation" as const, id: o.id }, title: o.title, course: course.title })),
          ...course.facts.filter(f => f.disagreement).map(f => ({ kind: "disagreement" as const, item: { kind: "fact" as const, id: f.id }, title: f.value, course: course.title })),
        ]),
        ...plan.proposal.lockedConflicts.map(blockId => ({ kind: "locked_conflict" as const, blockId })),
        ...plan.proposal.unplanned.map(u => ({ kind: "unplanned" as const, workId: u.workId, title: titleOf(u.workId).title, reason: u.reason })),
      ];
      const ongoing = sources.flatMap(source => {
        const activity = source.status === "queued" || source.status === "processing" ? "processing" as const
          : source.status === "ready" && source.extraction === "running" ? "reading" as const : null;
        return activity ? [{ kind: "source" as const, id: source.id, title: source.title, activity }] : [];
      });
      return c.json({ attention, ongoing, artifacts: [], agentWork: [] }, 200);
    });
}
