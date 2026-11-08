import { randomUUID } from "node:crypto";
import { activatePilot, hasPilotEntitlement } from "@nunio/billing";
import type { PrismaClient } from "@nunio/db";
import { principal, withOwner } from "@nunio/delegation";
import { APIError, betterAuth, getCurrentAdapter } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import type { ScalewayEmailOptions } from "./email.js";
import { sendPasswordResetEmail, sendVerificationEmail } from "./email.js";
import { hashInvitationToken } from "./invitation.js";

export interface AuthOptions {
  prisma: PrismaClient;
  /** The API origin that serves `/api/auth/*`. */
  baseURL: string;
  trustedOrigins: string[];
  secret: string;
  email: ScalewayEmailOptions;
  /** Parent domain shared by app and API origins (ADR-0005), e.g. `nunio.app`. */
  cookieDomain?: string;
}

export interface Actor {
  readonly studentId: string;
}

const invitationRequired = "A valid invitation is required";
/** Better Auth's rule for `/sign-in`, applied to password checks it does not rate-limit itself. */
const passwordAttempts = { windowMs: 10_000, max: 3 };

export function createAuth({
  prisma,
  baseURL,
  trustedOrigins,
  secret,
  email,
  cookieDomain,
}: AuthOptions) {
  async function activateInvitedPilot(user: { id: string; email: string }) {
    const invitation = await prisma.invitation.findFirst({
      where: { email: user.email, acceptedAt: { not: null } },
    });
    if (invitation)
      await activatePilot(
        prisma,
        principal.fromSession({ studentId: user.id }),
      );
  }

  /** Counts a password attempt in Better Auth's shared `rate_limit` table; false once the limit is reached. */
  async function admitPasswordAttempt(key: string): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - passwordAttempts.windowMs;
    // One statement: the upsert's row lock serialises concurrent attempts across API instances.
    const admitted = await prisma.$executeRaw`
      INSERT INTO "rate_limit" ("id", "key", "count", "lastRequest") VALUES (${randomUUID()}, ${key}, 1, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "rate_limit"."lastRequest" <= ${windowStart} THEN 1 ELSE "rate_limit"."count" + 1 END,
        "lastRequest" = ${now}
      WHERE "rate_limit"."lastRequest" <= ${windowStart} OR "rate_limit"."count" < ${passwordAttempts.max}`;
    return admitted === 1;
  }

  const auth = betterAuth({
    baseURL,
    trustedOrigins,
    secret,
    database: prismaAdapter(prisma, {
      provider: "postgresql",
      transaction: true,
    }),
    rateLimit: { storage: "database" },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: ({ user, url }) =>
        sendPasswordResetEmail(email, user.email, url),
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendVerificationEmail: ({ user, url }) =>
        sendVerificationEmail(email, user.email, url),
      afterEmailVerification: activateInvitedPilot,
    },
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path !== "/sign-up/email") return;
        const token = context.headers?.get("x-invitation-token");
        const address = context.body?.email;
        const invitation =
          token &&
          typeof address === "string" &&
          (await prisma.invitation.findFirst({
            where: {
              tokenHash: hashInvitationToken(token),
              email: address.toLowerCase(),
              expiresAt: { gt: new Date() },
              acceptedAt: null,
            },
          }));
        if (!invitation)
          throw new APIError("FORBIDDEN", { message: invitationRequired });
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const { pendingDeletion, activated } = await withOwner(
              prisma,
              principal.fromSession({ studentId: session.userId }),
              async (tx, studentId) => ({
                pendingDeletion: await tx.deletionRequest.findUnique({
                  where: { studentId },
                  select: { studentId: true },
                }),
                activated: await hasPilotEntitlement(tx, studentId),
              }),
            );
            if (pendingDeletion)
              throw new APIError("FORBIDDEN", {
                message: "Account deletion is pending",
              });
            if (activated) return;
            // Retry activation when verification was committed before its earlier activation failed.
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { id: true, email: true, emailVerified: true },
            });
            if (user?.emailVerified) await activateInvitedPilot(user);
          },
        },
      },
      user: {
        create: {
          before: async (user, context) => {
            const token = context?.headers?.get("x-invitation-token");
            if (!token || !context) {
              throw new APIError("FORBIDDEN", { message: invitationRequired });
            }
            // Use the signup transaction: claiming an invitation and creating its account commit together.
            const adapter = await getCurrentAdapter(context.context.adapter);
            const claimed = await adapter.updateMany({
              model: "invitation",
              where: [
                { field: "tokenHash", value: hashInvitationToken(token) },
                { field: "email", value: user.email.toLowerCase() },
                { field: "expiresAt", operator: "gt", value: new Date() },
                { field: "acceptedAt", value: null },
              ],
              update: { acceptedAt: new Date() },
            });
            if (claimed !== 1) {
              throw new APIError("FORBIDDEN", { message: invitationRequired });
            }
          },
        },
      },
    },
    plugins: [
      {
        id: "pilot-invitations",
        schema: {
          invitation: {
            fields: {
              tokenHash: { type: "string", unique: true },
              email: { type: "string" },
              issuedBy: { type: "string" },
              createdAt: { type: "date" },
              expiresAt: { type: "date" },
              acceptedAt: { type: "date", required: false },
            },
          },
        },
      },
    ],
    // Authorization decisions must read the session row, never a cached cookie.
    session: { cookieCache: { enabled: false } },
    advanced: {
      // Better Auth skips both checks when NODE_ENV=test or TEST is set; never let the environment decide.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ...(cookieDomain && {
        crossSubDomainCookies: { enabled: true, domain: cookieDomain },
      }),
    },
  });
  return Object.assign(auth, {
    async authenticate(request: Request): Promise<Actor | null> {
      // Reads must not refresh cookies that the application route would then need to forward.
      const session = await auth.api.getSession({
        headers: request.headers,
        query: { disableRefresh: true },
      });
      if (!session?.user.emailVerified) return null;
      return { studentId: session.user.id };
    },
    /** Records the current student's deletion request and ends all their sessions in one transaction. */
    async requestDeletion(
      request: Request,
      password: string,
    ): Promise<
      "pending" | "unauthorized" | "invalid_password" | "too_many_requests"
    > {
      const actor = await this.authenticate(request);
      if (!actor) return "unauthorized";
      // Server-side auth.api calls bypass Better Auth's rate limiter, so a session could guess passwords here.
      if (!(await admitPasswordAttempt(`deletion-request:${actor.studentId}`)))
        return "too_many_requests";
      try {
        await auth.api.verifyPassword({
          headers: request.headers,
          body: { password },
        });
      } catch (error) {
        if (error instanceof APIError && error.status === "BAD_REQUEST")
          return "invalid_password";
        throw error;
      }
      await withOwner(
        prisma,
        principal.fromSession(actor),
        async (tx, studentId) => {
          await tx.deletionRequest.upsert({
            where: { studentId },
            create: { studentId },
            update: {},
          });
          await tx.session.deleteMany({ where: { userId: studentId } });
        },
      );
      return "pending";
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
