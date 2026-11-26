import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Answerer, Estimator, SeriesAssigner } from "@nunio/ai";
import type { Artifacts } from "@nunio/artifacts";
import { pilotStatus } from "@nunio/billing";
import type { Activity, Builder, Chats } from "@nunio/chat";
import type { PrismaClient } from "@nunio/db";
import type { Agents, Delegation } from "@nunio/delegation";
import { principal } from "@nunio/delegation";
import type { Auth } from "@nunio/identity";
import type { Catalog, Connections } from "@nunio/integrations";
import type {
  Courses,
  Facts,
  Projects,
  Sources,
  TopicAreas,
} from "@nunio/knowledge";
import type { Outreach } from "@nunio/outreach";
import type { Plan } from "@nunio/planning";
import type { Understanding } from "@nunio/understanding";
import { registerAgentRoutes } from "./agents.js";
import { registerApprovalRoutes } from "./approvals.js";
import type { ArtifactWorkflows } from "./artifact-workflows.js";
import type { ChatModels } from "./chat-models.js";
import { registerChatRoutes } from "./chats.js";
import { registerCourseRoutes } from "./courses.js";
import { registerHomeRoutes } from "./home.js";
import {
  registerInboxRoutes,
  registerOutreachSettingsRoutes,
  registerPushRoutes,
} from "./inbox.js";
import {
  registerIntegrationRoutes,
  registerOAuthRoutes,
} from "./integrations.js";
import { registerPlanRoutes } from "./plan.js";
import { registerProjectRoutes } from "./projects.js";
import { registerReviewRoutes } from "./review.js";
import type { RunWorkflows } from "./run-workflows.js";
import type { SourceWorkflows } from "./source-workflows.js";
import { registerSourceRoutes } from "./sources.js";
import { registerStudyRoutes } from "./study.js";
import { registerTopicAreaRoutes } from "./topic-areas.js";

export interface AppBindings {
  Variables: {
    auth: Auth;
    prisma: PrismaClient;
    delegation: Delegation;
    sources: Sources;
    facts: Facts;
    topicAreas: TopicAreas;
    sourceWorkflows: SourceWorkflows;
    chats: Chats;
    chatModels: ChatModels;
    builder: Builder;
    builderModel: Answerer;
    plan: Plan;
    estimator: Estimator;
    seriesAssigner: SeriesAssigner;
    projects: Projects;
    courses: Courses;
    agents: Agents;
    activity: Activity;
    runWorkflows: RunWorkflows;
    outreach: Outreach;
    artifacts: Artifacts;
    artifactWorkflows: ArtifactWorkflows;
    understanding: Understanding;
    integrationCatalog: Catalog;
    connections: Connections;
    /** The web app's origin, where the OAuth callback sends the student back. */
    appOrigin: string;
  };
}

const HealthSchema = z.object({ status: z.literal("ok") }).openapi("Health");

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: { "application/json": { schema: HealthSchema } },
      description: "The API is running.",
    },
  },
});

/** The documented routes; `openapi.json` is generated from these. */
export const routes = new OpenAPIHono<AppBindings>();

routes.openapi(healthRoute, (c) => c.json({ status: "ok" as const }, 200));

const PilotEntitlementSchema = z
  .object({ status: z.enum(["none", "active", "revoked"]) })
  .openapi("PilotEntitlement");
const UnauthorizedSchema = z
  .object({ error: z.literal("unauthorized") })
  .openapi("Unauthorized");

routes.openapi(
  createRoute({
    method: "get",
    path: "/api/me/entitlement",
    responses: {
      200: {
        content: { "application/json": { schema: PilotEntitlementSchema } },
        description:
          "The current student's pilot status. Active pilot access has no fixed expiry.",
      },
      401: {
        content: { "application/json": { schema: UnauthorizedSchema } },
        description: "A current, verified session is required.",
      },
    },
  }),
  async (c) => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" as const }, 401);
    return c.json(
      {
        status: await pilotStatus(
          c.get("prisma"),
          principal.fromSession(actor),
        ),
      },
      200,
    );
  },
);

const AllowanceSchema = z
  .object({
    limitMicroUsd: z.number().int(),
    usedMicroUsd: z.number().int(),
    heldMicroUsd: z.number().int(),
  })
  .openapi("Allowance");

routes.openapi(
  createRoute({
    method: "get",
    path: "/api/me/allowance",
    responses: {
      200: {
        content: { "application/json": { schema: AllowanceSchema } },
        description:
          "The current student's Allowance in micro-USD: its limit, settled usage, and usage still held " +
          "for calls in flight or of unknown outcome. Readable while the AI kill switch is on.",
      },
      401: {
        content: { "application/json": { schema: UnauthorizedSchema } },
        description: "A current, verified session is required.",
      },
    },
  }),
  async (c) => {
    c.header("cache-control", "no-store");
    const actor = await c.get("auth").authenticate(c.req.raw);
    if (!actor) return c.json({ error: "unauthorized" as const }, 401);
    return c.json(
      await c.get("delegation").allowance(principal.fromSession(actor)),
      200,
    );
  },
);

const DeletionPendingSchema = z
  .object({ status: z.literal("pending") })
  .openapi("DeletionPending");
const SignInAgainSchema = z
  .object({ error: z.literal("sign_in_again") })
  .openapi("SignInAgain");

routes.openapi(
  createRoute({
    method: "post",
    path: "/api/me/deletion-request",
    responses: {
      202: {
        content: { "application/json": { schema: DeletionPendingSchema } },
        description:
          "Deletion is queued for manual completion; every session of the student has ended.",
      },
      401: {
        content: { "application/json": { schema: UnauthorizedSchema } },
        description: "A current, verified session is required.",
      },
      403: {
        content: { "application/json": { schema: SignInAgainSchema } },
        description:
          "The session was created more than ten minutes ago; the student must sign in again. Nothing was recorded and sessions remain.",
      },
    },
  }),
  async (c) => {
    const result = await c.get("auth").requestDeletion(c.req.raw);
    if (result === "unauthorized")
      return c.json({ error: "unauthorized" as const }, 401);
    if (result === "sign_in_again")
      return c.json({ error: "sign_in_again" as const }, 403);
    return c.json({ status: "pending" as const }, 202);
  },
);

export const openApiConfig = {
  openapi: "3.1.0",
  info: { title: "nunio API", version: "0.0.0" },
};

registerSourceRoutes(routes);
registerReviewRoutes(routes);
registerChatRoutes(routes);
registerPlanRoutes(routes);
registerProjectRoutes(routes);
registerCourseRoutes(routes);
registerHomeRoutes(routes);
registerApprovalRoutes(routes);
registerAgentRoutes(routes);
registerInboxRoutes(routes);
registerOutreachSettingsRoutes(routes);
registerPushRoutes(routes);
registerStudyRoutes(routes);
registerTopicAreaRoutes(routes);
registerIntegrationRoutes(routes);
registerOAuthRoutes(routes);
