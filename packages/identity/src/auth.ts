import type { PrismaClient } from "@nunio/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

export interface AuthOptions {
  prisma: PrismaClient;
  /** The API origin that serves `/api/auth/*`. */
  baseURL: string;
  trustedOrigins: string[];
  secret: string;
  /** Parent domain shared by app and API origins (ADR-0005), e.g. `nunio.app`. */
  cookieDomain?: string;
}

export function createAuth({ prisma, baseURL, trustedOrigins, secret, cookieDomain }: AuthOptions) {
  return betterAuth({
    baseURL,
    trustedOrigins,
    secret,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: { enabled: true },
    // Authorization decisions must read the session row, never a cached cookie.
    session: { cookieCache: { enabled: false } },
    advanced: {
      // Better Auth skips both checks when NODE_ENV=test or TEST is set; never let the environment decide.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      ...(cookieDomain && { crossSubDomainCookies: { enabled: true, domain: cookieDomain } }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
