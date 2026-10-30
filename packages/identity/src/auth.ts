import type { PrismaClient } from "@nunio/db";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

export interface AuthOptions {
  prisma: PrismaClient;
  /** The API origin that serves `/api/auth/*`. */
  baseURL: string;
  trustedOrigins: string[];
  secret: string;
}

export function createAuth({ prisma, baseURL, trustedOrigins, secret }: AuthOptions) {
  return betterAuth({
    baseURL,
    trustedOrigins,
    secret,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: { enabled: true },
    // Authorization decisions must read the session row, never a cached cookie.
    session: { cookieCache: { enabled: false } },
  });
}

export type Auth = ReturnType<typeof createAuth>;
