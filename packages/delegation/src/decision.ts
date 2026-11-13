import type { Args, GrantScope, Kind, Subject } from "./kinds.js";
import { definitions } from "./kinds.js";

/** Advanced Agent configuration on a Responsibility. Restrictions can only tighten what Grants allow. */
export interface Restrictions {
  /** Kinds the Responsibility may take at all; absent means every kind. */
  allowedKinds?: Kind[];
  /** Kinds that always ask for Approval, even under a Grant. */
  alwaysAsk?: Kind[];
}

export type Refusal =
  | "not_owner"
  | "paused"
  | "ended"
  | "approval_denied"
  | "approval_expired"
  | "approval_mismatch"
  | "locked"
  | "started"
  | "protected_time"
  | "restricted";

/** Everything the gate re-read for one Action at dispatch, in the transaction that decides it. */
export interface Snapshot<K extends Kind = Kind> {
  intent: { kind: K; args: Args<K> };
  /** The work or block the Action is for, as the student's own rows show it; null when it is not theirs. */
  subject: Subject<K> | null;
  /** The fingerprint of the Action as it stands now. */
  fingerprint: string;
  now: Date;
  /** The Run's Responsibility; null in a Chat, which has none and so no Grants. */
  responsibility: {
    state: "active" | "paused" | "ended";
    grants: { id: string; kind: Kind; scope: GrantScope }[];
    restrictions: Restrictions;
  } | null;
  intoProtectedTime: boolean;
  /** The request for the student's Approval of this Action, once one was made. */
  approval: {
    id: string;
    decision: "approved" | "denied" | null;
    fingerprint: string;
    expiresAt: Date;
  } | null;
}

export type Decision =
  | {
      outcome: "dispatch";
      authority: { grantId: string } | { approvalId: string };
    }
  | { outcome: "await_approval" }
  | { outcome: "refuse"; reason: Refusal };

const refuse = (reason: Refusal): Decision => ({ outcome: "refuse", reason });

/** The pure decision core: whether an Action may happen now, and on which authority. */
export function decideAction<K extends Kind>(s: Snapshot<K>): Decision {
  const { intent, subject, responsibility, approval } = s;
  if (!subject) return refuse("not_owner");
  if (responsibility?.state === "ended") return refuse("ended");
  if (responsibility?.state === "paused") return refuse("paused");
  // Neither a Lock nor Protected Time yields to asking.
  if ("locked" in subject && subject.locked) return refuse("locked");
  // A block that has started is the student's past, even with an Approval given earlier (ADR-0021).
  if (
    intent.kind === "studyBlock.remove" &&
    "start" in subject &&
    subject.start <= s.now
  )
    return refuse("started");
  if (s.intoProtectedTime) return refuse("protected_time");
  const restrictions = responsibility?.restrictions ?? {};
  if (
    restrictions.allowedKinds &&
    !restrictions.allowedKinds.includes(intent.kind)
  )
    return refuse("restricted");

  if (approval?.decision === "denied") return refuse("approval_denied");
  if (approval && s.now >= approval.expiresAt)
    return refuse("approval_expired");
  if (approval?.decision === "approved") {
    return approval.fingerprint === s.fingerprint
      ? { outcome: "dispatch", authority: { approvalId: approval.id } }
      : refuse("approval_mismatch");
  }

  const definition = definitions[intent.kind] as unknown as {
    grantCovers(scope: GrantScope, args: Args<K>, subject: Subject<K>): boolean;
  };
  const grant = restrictions.alwaysAsk?.includes(intent.kind)
    ? undefined
    : responsibility?.grants.find(
        (g) =>
          g.kind === intent.kind &&
          definition.grantCovers(g.scope, intent.args, subject),
      );
  return grant
    ? { outcome: "dispatch", authority: { grantId: grant.id } }
    : { outcome: "await_approval" };
}
