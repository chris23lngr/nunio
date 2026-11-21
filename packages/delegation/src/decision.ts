import type { AgentCapability } from "./capabilities.js";
import { approvalModes, capabilities } from "./capabilities.js";
import type { Args, GrantScope, Kind, Subject } from "./kinds.js";
import { definitions } from "./kinds.js";

/** Advanced configuration on an Agent. Restrictions can only tighten what Grants allow. */
export interface Restrictions {
  /** Kinds the Agent may take at all; absent means every kind. */
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
  /** Withdrawn unanswered when its Agent was Paused or Ended; never decided by the gate. */
  | "approval_withdrawn"
  | "approval_mismatch"
  | "locked"
  | "started"
  | "protected_time"
  | "restricted"
  | "past"
  | "fixed_event"
  | "study_block"
  | "out_of_scope"
  | "no_capability"
  | "run_cap"
  | "open_approvals_cap"
  /** A new call of a Run that has already ended, as when it was told to stop. */
  | "run_ended";

/** What the Plan's rules (`plan.check`) refuse a Study Block for: an Agent is refused these in every mode. */
export type PlanRefusal = Extract<
  Refusal,
  | "locked"
  | "started"
  | "past"
  | "protected_time"
  | "fixed_event"
  | "study_block"
>;
/** A Preference a Study Block would break: Automatisch asks for it, Immer erlaubt notes it. */
export type BrokenPreference =
  | "outside_study_window"
  | "daily_limit"
  | "work_limit";
/** What the Plan's rules say of a Study Block Action. */
export interface PlanVerdict {
  refusals: PlanRefusal[];
  brokenPreferences: BrokenPreference[];
}

/** A pilot preset's Agent: Grants scoped to its Course or exam, which Restrictions can only tighten. */
export interface PresetAgent {
  state: "active" | "paused" | "ended";
  grants: { id: string; kind: Kind; scope: GrantScope }[];
  restrictions: Restrictions;
}
/** A free-text Agent: Capabilities with their modes, unscoped Grants, and its Courses as scope (ADR-0001). */
export interface CapableAgent {
  id: string;
  state: "active" | "paused" | "ended";
  capabilities: AgentCapability[];
  /** One for each kind a Capability on `always` or `automatic` takes. */
  grants: { id: string; kind: Kind }[];
  /** Its current scope: those of its Courses that are not Archived. */
  courseIds: string[];
}

/**
 * What a free-text Agent's Run may do at most (ADR-0026): Action calls, counting granted, asked and refused ones, in the
 * Run and in one model step, and Approvals asked. Past one, a call is refused with `run_cap`.
 */
export const runCaps = { calls: 20, stepCalls: 5, approvals: 5 } as const;
/** At most this many of an Agent's Approvals are open at once, across its Runs (ADR-0026); past it, `open_approvals_cap`. */
export const maxOpenApprovals = 5;

/** What a free-text Agent's Run and its Agent already used, counted before a new call of the Run. */
export interface RunUse {
  /** The Run's Action calls so far. */
  calls: number;
  /** Those in the same model step. */
  stepCalls: number;
  /** The Approvals the Run asked. */
  approvals: number;
  /** The Agent's open, unexpired Approvals, from any of its Runs. */
  openApprovals: number;
  /** The Run has ended, such as one told to stop whose abandoned calls go on: it takes no new Action. */
  ended: boolean;
}

/** Everything the gate re-read for one Action at dispatch, in the transaction that decides it. */
export interface Snapshot<K extends Kind = Kind> {
  intent: { kind: K; args: Args<K> };
  /** The work or block the Action is for, as the student's own rows show it; null when it is not theirs. */
  subject: Subject<K> | null;
  /** The fingerprint of the Action as it stands now. */
  fingerprint: string;
  now: Date;
  /** The Run's Agent; null in a Chat, which has none and so no Grants. */
  agent: PresetAgent | CapableAgent | null;
  /** Read for a Chat's and a preset Agent's Actions; a free-text Agent's go by `planCheck`. */
  intoProtectedTime: boolean;
  /** For a free-text Agent's Study Block Action, the Plan's rules on it; null otherwise. */
  planCheck: PlanVerdict | null;
  /**
   * For a free-text Agent's new Task, when it would be due: its Obligation's deadline, or the end of its Preparation's or
   * Follow-up's window; null otherwise, as for a Task in a Course, which has no deadline.
   */
  taskDue: Date | null;
  /** The request for the student's Approval of this Action, once one was made. */
  approval: {
    id: string;
    decision: "approved" | "denied" | null;
    fingerprint: string;
    expiresAt: Date;
  } | null;
  /** For a new call of a free-text Agent's Run, what it used so far; null otherwise, such as for an Action already asked. */
  runUse: RunUse | null;
}

export type Decision =
  | {
      outcome: "dispatch";
      authority: { grantId: string } | { approvalId: string };
      /** Preferences it breaks on Immer erlaubt, noted on the Action. */
      brokenPreferences?: BrokenPreference[];
    }
  | { outcome: "await_approval" }
  | { outcome: "refuse"; reason: Refusal };

const refuse = (reason: Refusal): Decision => ({ outcome: "refuse", reason });

/** The pure decision core: whether an Action may happen now, and on which authority. */
export function decideAction<K extends Kind>(s: Snapshot<K>): Decision {
  const { intent, subject, agent, approval } = s;
  if (!subject) return refuse("not_owner");
  if (agent?.state === "ended") return refuse("ended");
  if (agent?.state === "paused") return refuse("paused");
  if (agent && "capabilities" in agent)
    return decideForAgent(s as Snapshot<K> & { subject: Subject<K> }, agent);
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
  const restrictions = (agent as PresetAgent | null)?.restrictions ?? {};
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
    : (agent as PresetAgent | null)?.grants.find(
        (g) =>
          g.kind === intent.kind &&
          definition.grantCovers(g.scope, intent.args, subject),
      );
  return grant
    ? { outcome: "dispatch", authority: { grantId: grant.id } }
    : { outcome: "await_approval" };
}

const dayMs = 24 * 60 * 60_000;

/** The approved Action, if the student approved exactly this one in time; else why not, or null while unanswered. */
function answered(s: Snapshot): Decision | null {
  const { approval } = s;
  if (approval?.decision === "denied") return refuse("approval_denied");
  if (approval && s.now >= approval.expiresAt)
    return refuse("approval_expired");
  if (approval?.decision === "approved")
    return approval.fingerprint === s.fingerprint
      ? { outcome: "dispatch", authority: { approvalId: approval.id } }
      : refuse("approval_mismatch");
  return null;
}

/**
 * A free-text Agent's Action (ADR-0001): within its Run's caps (ADR-0026), then by its Courses, Capabilities and modes;
 * what would be asked is refused once the Run asked its share of Approvals or the Agent has too many open.
 */
function decideForAgent<K extends Kind>(
  s: Snapshot<K> & { subject: Subject<K> },
  agent: CapableAgent,
): Decision {
  const use = s.runUse;
  if (use?.ended) return refuse("run_ended");
  // Every call counts, whatever becomes of it, so a Run cannot probe the gate in a loop.
  if (use && (use.calls >= runCaps.calls || use.stepCalls >= runCaps.stepCalls))
    return refuse("run_cap");
  const decision = decideByMode(s, agent);
  if (decision.outcome !== "await_approval" || !use) return decision;
  if (use.approvals >= runCaps.approvals) return refuse("run_cap");
  if (use.openApprovals >= maxOpenApprovals)
    return refuse("open_approvals_cap");
  return decision;
}

/**
 * Within its Courses, under a Capability it holds, never into what the Plan's rules refuse, then by the Capability's
 * mode. A block it did not create is covered only by a Capability for any block.
 */
function decideByMode<K extends Kind>(
  s: Snapshot<K> & { subject: Subject<K> },
  agent: CapableAgent,
): Decision {
  const { intent, subject } = s;
  if (!subject.courseId || !agent.courseIds.includes(subject.courseId))
    return refuse("out_of_scope");
  const own = "createdBy" in subject && subject.createdBy === agent.id;
  // The most permissive of the Capabilities that cover it. A mode the Capability does not allow, such as a stale row
  // putting Lernblöcke verschieben on a Grant-holding mode, authorises nothing.
  const mode = agent.capabilities
    .filter(({ id, mode }) => {
      const capability: {
        kind: Kind;
        ownBlocks?: true;
        modes: readonly string[];
      } = capabilities[id];
      return (
        capability.kind === intent.kind &&
        (own || !capability.ownBlocks) &&
        capability.modes.includes(mode)
      );
    })
    .map((c) => c.mode)
    .sort((a, b) => approvalModes.indexOf(a) - approvalModes.indexOf(b))[0];
  if (!mode) return refuse("no_capability");
  const refusal =
    s.planCheck?.refusals[0] ??
    // Moving a block that has started rewrites the student's past, as removing it would (ADR-0021).
    (intent.kind === "studyBlock.move" &&
    "start" in subject &&
    subject.start <= s.now
      ? "started"
      : undefined) ??
    // A Preparation for a Course Event that has begun, or a Follow-up whose window has closed, is for the past.
    (intent.kind === "task.create" &&
    (intent.args as Args<"task.create">).fixedEventId &&
    s.taskDue &&
    s.taskDue <= s.now
      ? "past"
      : undefined);
  if (refusal) return refuse(refusal);

  const approved = answered(s);
  if (approved) return approved;
  if (s.approval || mode === "ask") return { outcome: "await_approval" };
  const grant = agent.grants.find((g) => g.kind === intent.kind);
  if (!grant) return { outcome: "await_approval" };
  const broken = s.planCheck?.brokenPreferences ?? [];
  if (mode === "automatic") {
    // A block placed, moved or removed within the next 24 hours: where it is now, and where it would go. A new Task
    // due within them changes the next 24 hours too.
    const horizon = s.now.getTime() + dayMs;
    const soon =
      [intent.args, subject].some(
        (at) => "start" in at && at.start.getTime() < horizon,
      ) ||
      (s.taskDue !== null && s.taskDue.getTime() < horizon);
    if (broken.length || soon) return { outcome: "await_approval" };
  }
  return {
    outcome: "dispatch",
    authority: { grantId: grant.id },
    ...(broken.length ? { brokenPreferences: broken } : {}),
  };
}
