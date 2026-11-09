import { randomBytes } from "node:crypto";
import { createPool, createPrismaClient } from "@nunio/db";
import { z } from "zod";
import { hashInvitationToken } from "./invitation.js";

const input = z
  .object({
    email: z.email().transform((email) => email.toLowerCase()),
    operator: z.string().trim().min(1),
    databaseURL: z.string().min(1),
    appOrigin: z.url().refine((value) => {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        url.origin === value.replace(/\/$/, "")
      );
    }),
  })
  .safeParse({
    email: process.argv[2]?.trim(),
    operator: process.env.OPERATOR_ID,
    databaseURL: process.env.INVITATION_DATABASE_URL,
    appOrigin: process.env.APP_ORIGIN,
  });

if (!input.success || process.argv.length !== 3) {
  console.error(
    "Usage: invite.ts <email>; requires OPERATOR_ID, INVITATION_DATABASE_URL and APP_ORIGIN (HTTP(S) origin)",
  );
  process.exit(1);
}

const { email, operator, databaseURL, appOrigin } = input.data;
const prisma = createPrismaClient(createPool(databaseURL));
try {
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const invitation = await prisma.invitation.create({
    data: {
      email,
      issuedBy: operator,
      createdAt,
      tokenHash: hashInvitationToken(token),
      expiresAt: new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    },
    select: {
      id: true,
      email: true,
      issuedBy: true,
      createdAt: true,
      expiresAt: true,
    },
  });
  const url = new URL("/sign-in", appOrigin);
  url.searchParams.set("invitation", token);
  console.log(JSON.stringify({ ...invitation, url: url.href }));
} catch {
  // Driver errors can contain connection details; keep credentials out of operator output.
  console.error(
    "Could not issue invitation; check database access and applied migrations",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
