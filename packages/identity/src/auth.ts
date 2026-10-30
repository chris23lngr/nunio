import { createHash } from "node:crypto";
import { activatePilot } from "@nunio/billing";
import type { PrismaClient } from "@nunio/db";
import { principal } from "@nunio/delegation";
import { APIError, betterAuth, getCurrentAdapter } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware } from "better-auth/api";
import { sendPasswordResetEmail, sendVerificationEmail, type ScalewayEmailOptions } from "./email.js";

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

export function createAuth({ prisma, baseURL, trustedOrigins, secret, email, cookieDomain }: AuthOptions) {
  async function activateInvitedPilot(user: { id: string; email: string }) {
    const invitation = await prisma.invitation.findFirst({
      where: { email: user.email, acceptedAt: { not: null } },
    });
    if (invitation) await activatePilot(prisma, principal.fromSession({ studentId: user.id }));
  }

  const auth = betterAuth({
    baseURL,
    trustedOrigins,
    secret,
    database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
    rateLimit: { storage: "database" },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: ({ user, url }) => sendPasswordResetEmail(email, user.email, url),
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendVerificationEmail: ({ user, url }) => sendVerificationEmail(email, user.email, url),
      afterEmailVerification: activateInvitedPilot,
    },
    hooks: {
      before: createAuthMiddleware(async context => {
        if (context.path !== "/sign-up/email") return;
        const token = context.headers?.get("x-invitation-token");
        const address = context.body?.email;
        const invitation = token && typeof address === "string" && await prisma.invitation.findFirst({
          where: {
            tokenHash: createHash("sha256").update(token).digest("hex"),
            email: address.toLowerCase(),
            expiresAt: { gt: new Date() },
            acceptedAt: null,
          },
        });
        if (!invitation) throw new APIError("FORBIDDEN", { message: "A valid invitation is required" });
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async session => {
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
              throw new APIError("FORBIDDEN", { message: "A valid invitation is required" });
            }
            // Use the signup transaction: claiming an invitation and creating its account commit together.
            const adapter = await getCurrentAdapter(context.context.adapter);
            const claimed = await adapter.updateMany({
              model: "invitation",
              where: [
                { field: "tokenHash", value: createHash("sha256").update(token).digest("hex") },
                { field: "email", value: user.email.toLowerCase() },
                { field: "expiresAt", operator: "gt", value: new Date() },
                { field: "acceptedAt", value: null },
              ],
              update: { acceptedAt: new Date() },
            });
            if (claimed !== 1) {
              throw new APIError("FORBIDDEN", { message: "A valid invitation is required" });
            }
          },
        },
      },
    },
    plugins: [{
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
    }],
    // Authorization decisions must read the session row, never a cached cookie.
    session: { cookieCache: { enabled: false } },
    advanced: {
      // Better Auth skips both checks when NODE_ENV=test or TEST is set; never let the environment decide.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ...(cookieDomain && { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }),
    },
  });
  return Object.assign(auth, {
    async authenticate(request: Request): Promise<Actor | null> {
      // Reads must not refresh cookies that the application route would then need to forward.
      const session = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
      if (!session?.user.emailVerified) return null;
      return { studentId: session.user.id };
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
