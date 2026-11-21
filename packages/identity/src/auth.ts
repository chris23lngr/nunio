import { randomUUID } from "node:crypto";
import { activatePilot, hasPilotEntitlement } from "@nunio/billing";
import type { PrismaClient } from "@nunio/db";
import { principal, withOwner } from "@nunio/delegation";
import { APIError, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import type { ScalewayEmailOptions } from "./email.js";
import { sendSignInCode } from "./email.js";
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

const invitationRequired = () =>
  new APIError("FORBIDDEN", {
    code: "INVITATION_REQUIRED",
    message: "A valid invitation is required",
  });
const hour = 60 * 60 * 1000;
/** Per address, on top of Better Auth's limits per IP (ADR-0027). */
const codeLimits = {
  resend: { windowMs: 60_000, max: 1 },
  sends: { windowMs: hour, max: 5 },
  wrongGuesses: { windowMs: hour, max: 10 },
};
/** Sensitive actions need a session created this recently (ADR-0027). */
const recentSignInMs = 10 * 60 * 1000;
const isRecent = (session: { createdAt: Date }) =>
  Date.now() - session.createdAt.getTime() <= recentSignInMs;
const signInAgain = () =>
  new APIError("FORBIDDEN", {
    code: "SESSION_NOT_FRESH",
    message: "Sign in again to continue.",
  });
const tooManyRequests = () =>
  new APIError("TOO_MANY_REQUESTS", {
    message: "Too many requests. Please try again later.",
  });

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

  /** An address receives a sign-in code only for its account or a valid, unaccepted Invitation (ADR-0027). */
  async function mayReceiveCode(address: string): Promise<boolean> {
    const [user, invitation] = await Promise.all([
      prisma.user.findUnique({
        where: { email: address },
        select: { id: true },
      }),
      prisma.invitation.findFirst({
        where: {
          email: address,
          expiresAt: { gt: new Date() },
          acceptedAt: null,
        },
        select: { id: true },
      }),
    ]);
    return Boolean(user || invitation);
  }

  /** Counts an attempt in Better Auth's shared `rate_limit` table; false once the limit is reached. */
  async function admit(
    key: string,
    rule: { windowMs: number; max: number },
  ): Promise<boolean> {
    const now = Date.now();
    const windowStart = now - rule.windowMs;
    // One statement: the upsert's row lock serialises concurrent attempts across API instances.
    const admitted = await prisma.$executeRaw`
      INSERT INTO "rate_limit" ("id", "key", "count", "lastRequest") VALUES (${randomUUID()}, ${key}, 1, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "rate_limit"."lastRequest" <= ${windowStart} THEN 1 ELSE "rate_limit"."count" + 1 END,
        "lastRequest" = ${now}
      WHERE "rate_limit"."lastRequest" <= ${windowStart} OR "rate_limit"."count" < ${rule.max}`;
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
    // Passwords are gone (ADR-0027); these routes stay mounted after emailAndPassword is off.
    emailAndPassword: { enabled: false },
    disabledPaths: [
      "/sign-up/email",
      "/sign-in/email",
      "/verify-password",
      "/change-password",
      "/request-password-reset",
      "/reset-password",
      "/send-verification-email",
      "/email-otp/request-password-reset",
      "/email-otp/reset-password",
      "/forget-password/email-otp",
      "/email-otp/verify-email",
      "/email-otp/check-verification-otp",
      "/email-otp/request-email-change",
      "/email-otp/change-email",
    ],
    hooks: {
      before: createAuthMiddleware(async (context) => {
        if (context.path === "/revoke-sessions") {
          const current = await getSessionFromCtx(context);
          if (current && !isRecent(current.session)) throw signInAgain();
          return;
        }
        const address =
          typeof context.body?.email === "string"
            ? context.body.email.toLowerCase()
            : "";
        if (context.path === "/email-otp/send-verification-otp") {
          if (
            !(await admit(`code-resend:${address}`, codeLimits.resend)) ||
            !(await admit(`code-sends:${address}`, codeLimits.sends))
          )
            throw tooManyRequests();
          return;
        }
        if (context.path === "/sign-in/email-otp") {
          if (
            !(await admit(`code-guesses:${address}`, codeLimits.wrongGuesses))
          )
            throw tooManyRequests();
          return;
        }
      }),
      after: createAuthMiddleware(async (context) => {
        // Only wrong guesses count: a successful sign-in clears the address's count.
        if (context.path === "/sign-in/email-otp" && context.context.newSession)
          await prisma.rateLimit.deleteMany({
            where: {
              key: `code-guesses:${context.context.newSession.user.email}`,
            },
          });
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
                code: "DELETION_PENDING",
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
            const invitation =
              token &&
              (await prisma.invitation.findFirst({
                where: {
                  tokenHash: hashInvitationToken(token),
                  email: user.email.toLowerCase(),
                  expiresAt: { gt: new Date() },
                  acceptedAt: null,
                },
                select: { id: true },
              }));
            if (!invitation) throw invitationRequired();
          },
          // Claim only once the account exists: email-code sign-in creates it outside a transaction.
          after: async (user, context) => {
            const token = context?.headers?.get("x-invitation-token") ?? "";
            const claimed = await prisma.invitation.updateMany({
              where: {
                tokenHash: hashInvitationToken(token),
                email: user.email.toLowerCase(),
                acceptedAt: null,
              },
              data: { acceptedAt: new Date() },
            });
            if (claimed.count !== 1) {
              await prisma.user.delete({ where: { id: user.id } });
              throw invitationRequired();
            }
          },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 3,
        storeOTP: "hashed",
        async sendVerificationOTP({ email: to, otp, type }) {
          if (type === "sign-in" && (await mayReceiveCode(to)))
            await sendSignInCode(email, to, otp);
        },
      }),
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
    session: { expiresIn: 60 * 60 * 24 * 30, cookieCache: { enabled: false } },
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
    ): Promise<"pending" | "unauthorized" | "sign_in_again"> {
      const actor = await this.authenticate(request);
      if (!actor) return "unauthorized";
      const current = await auth.api.getSession({
        headers: request.headers,
        query: { disableRefresh: true },
      });
      if (!current || !isRecent(current.session)) return "sign_in_again";
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
