import { createHash } from "node:crypto";

/** Invitations store only this hash; the token itself exists only in the invitation link. */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
