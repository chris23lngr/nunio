import type { AgentCapability } from "./capabilities.js";
import { approvalModes, capabilities } from "./capabilities.js";
import type { Args, IntegrationSubject, Kind, Subject } from "./kinds.js";

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
  /** A preset's `restrictions` refused it; recorded only before the Agents cutover (#192). */
  | "restricted"
  | "past"
  | "fixed_event"
  | "study_block"
  | "out_of_scope"
  | "no_capability"
  | "run_cap"
  | "open_approvals_cap"
  /** A new call of a Run that has already ended, as when it was told to stop. */
  | "run_ended"
  /** An Integration Action's Connection Needs reconnection. */
  | "needs_reconnection"
  /** An Integration tool nunio doesn't offer now (unclassified, removed, blocked or not a write), or a Chat-only one in a Run. */
  | "tool_unavailable";

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

/** An Agent: Capabilities with their modes, unscoped Grants, and its Courses as scope (ADR-0001). */
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
 * Run and in one model step, Approvals asked, Artifact Runs started, Notices sent and Briefings written. Past one, a
 * call is refused with `run_cap`.
 */
export const runCaps = {
  calls: 20,
  stepCalls: 5,
  approvals: 5,
  artifactRuns: 1,
  notices: 1,
  briefings: 1,
} as const;
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
  agent: CapableAgent | null;
  /** Read for a Chat's Actions; an Agent's go by `planCheck`. */
  intoProtectedTime: boolean;
  /** For an Agent's Study Block Action, the Plan's rules on it; null otherwise. */
  planCheck: PlanVerdict | null;
  /**
   * For an Agent's new Task, when it would be due: its Obligation's deadline, or the end of its Preparation's or
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
  /** For a new call of an Agent's Run, what it used so far; null otherwise, such as for an Action already asked. */
  runUse: RunUse | null;
  /** Whether a Run asked for it, rather than a Chat; read for Integration Actions, which a Chat-only tool limits. */
  inRun?: boolean;
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

/**
 * The pure decision core: whether an Action may happen now, and on which authority. A Chat's Action, which has no Agent
 * and so no Grant, always needs the student's Approval.
 */
export function decideAction<K extends Kind>(s: Snapshot<K>): Decision {
  const { intent, subject, agent } = s;
  if (intent.kind === "integration.call")
    return decideIntegration(s as Snapshot<"integration.call">);
  if (!subject) return refuse("not_owner");
  if (agent?.state === "ended") return refuse("ended");
  if (agent?.state === "paused") return refuse("paused");
  if (agent)
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
  const approved = answered(s);
  if (approved?.outcome === "refuse") return approved;
  // Never a block placed or moved to a start that has passed, as when its Approval is performed late.
  if (
    (intent.kind === "studyBlock.create" ||
      intent.kind === "studyBlock.move") &&
    (intent.args as Args<"studyBlock.create">).start <= s.now
  )
    return refuse("past");
  return approved ?? { outcome: "await_approval" };
}

/**
 * An Integration Action (#280): never for a Paused or Ended Agent or a Run that ended, only on a Connected Connection,
 * only for a write tool nunio offers now under the pin the call was made under (#262), never a Chat-only one in a
 * Run; then on a matching Approval, or it asks. A tool reclassified since still honours a matching Approval; one
 * re-reviewed under a new pin no longer matches it, since the fingerprint holds the current pin. Grants, caps,
 * per-Agent tool on/off and taint come with their own tickets.
 */
function decideIntegration(s: Snapshot<"integration.call">): Decision {
  const { agent } = s;
  if (agent?.state === "ended") return refuse("ended");
  if (agent?.state === "paused") return refuse("paused");
  if (s.runUse?.ended) return refuse("run_ended");
  const subject = s.subject as IntegrationSubject | null;
  if (!subject) return refuse("not_owner");
  if (subject.connection.state !== "connected")
    return refuse("needs_reconnection");
  const { tool } = subject;
  if (!tool || (tool.class !== "write" && tool.class !== "write_always_asked"))
    return refuse("tool_unavailable");
  if (tool.chatOnly && s.inRun) return refuse("tool_unavailable");
  // A new call made against a definition nunio no longer has reviewed; an asked one goes by its fingerprint.
  if (!s.approval && s.intent.args.pinHash !== tool.definitionHash)
    return refuse("tool_unavailable");
  return answered(s) ?? { outcome: "await_approval" };
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
  const { intent } = s;
  // Integration Actions are decided apart, in `decideIntegration`.
  const subject = s.subject as Exclude<Subject, IntegrationSubject>;
  if (!subject.courseId || !agent.courseIds.includes(subject.courseId))
    return refuse("out_of_scope");
  const own = "createdBy" in subject && subject.createdBy === agent.id;
  // The most permissive of the Capabilities that cover it. A mode the Capability does not allow, such as a stale row
  // putting Lernblöcke verschieben on a Grant-holding mode, authorises nothing.
  const mode = agent.capabilities
    .flatMap(({ id, mode }) => {
      const capability: {
        kind?: Kind;
        ownBlocks?: true;
        modes: readonly string[];
      } = capabilities[id];
      return mode &&
        capability.kind === intent.kind &&
        (own || !capability.ownBlocks) &&
        capability.modes.includes(mode)
        ? [mode]
        : [];
    })
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
