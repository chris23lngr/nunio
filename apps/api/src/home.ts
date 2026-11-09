import { createRoute, z, type OpenAPIHono } from "@hono/zod-openapi";
import type { AppBindings } from "./app.js";
import { errors, json, student } from "./outcomes.js";
import { Tradeoff } from "./plan.js";

const Attention = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("shortfall"), workId: z.string(), title: z.string(), course: z.string().nullable(), due: z.date(),
    shortMinutes: z.number().int(), tradeoffs: z.array(Tradeoff),
    unreviewed: z.boolean().describe("The Obligation was extracted and not yet reviewed, so its deadline or Estimate may be wrong.") }),
  z.object({ kind: z.literal("disagreement"), item: z.object({ kind: z.enum(["obligation", "fact"]), id: z.string() }), title: z.string(), course: z.string() }),
  z.object({ kind: z.literal("overlap"), blockId: z.string(), title: z.string(), reason: z.enum(["locked", "no_room"]) }),
  z.object({ kind: z.literal("unplanned"), workId: z.string(), title: z.string(), reason: z.enum(["no_estimate", "no_deadline", "past_due"]) }),
]);
const HomeView = z.object({
  attention: z.array(Attention).describe("What needs the student's decision: Shortfalls with tradeoffs first, never resolved silently."),
  ongoing: z.array(z.object({ kind: z.literal("source"), id: z.string(), title: z.string(), activity: z.enum(["processing", "reading"]) })),
  artifacts: z.array(z.unknown()).max(0).describe("Ready Artifacts; always empty until Artifacts exist (Phase 11)."),
  agentWork: z.array(z.unknown()).max(0).describe("Runs in progress; always empty until Runs exist (Phase 9)."),
}).openapi("Home");

export function registerHomeRoutes(routes: OpenAPIHono<AppBindings>) {
  routes.openapi(createRoute({ method: "get", path: "/api/me/home", responses: { 200: json(HomeView, "The student's actionable day."), 401: errors[401] } }),
    async c => {
      const p = await student(c);
      if (!p) return c.json({ error: "unauthorized" }, 401);
      const [plan, review, sources] = await Promise.all([c.get("plan").view(p), c.get("facts").review(p), c.get("sources").list(p)]);
      const work = new Map([
        ...plan.obligations.map(o => [o.id, { title: o.title, course: o.course, unreviewed: o.state === "unreviewed" }] as const),
        ...plan.tasks.map(t => {
          const obligation = plan.obligations.find(o => o.id === t.obligationId);
          return [t.id, { title: t.title, course: obligation?.course ?? null, unreviewed: obligation?.state === "unreviewed" }] as const;
        }),
      ]);
      const titleOf = (id: string) => work.get(id) ?? { title: "Untitled", course: null, unreviewed: false };
      const attention = [
        ...plan.proposal.shortfalls.map(s => ({ kind: "shortfall" as const, ...titleOf(s.workId), ...s })),
        ...review.courses.flatMap(course => [
          ...course.obligations.filter(o => o.disagreement).map(o => ({ kind: "disagreement" as const, item: { kind: "obligation" as const, id: o.id }, title: o.title, course: course.title })),
          ...course.facts.filter(f => f.disagreement).map(f => ({ kind: "disagreement" as const, item: { kind: "fact" as const, id: f.id }, title: f.value, course: course.title })),
        ]),
        ...plan.proposal.overlaps.map(o => ({ kind: "overlap" as const, blockId: o.blockId, reason: o.reason,
          title: titleOf(plan.studyBlocks.find(b => b.id === o.blockId)?.work.id ?? "").title })),
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
