import { describe, expect, it } from "vitest";
import type {
  AgentCapability,
  ApprovalMode,
  CapabilityId,
} from "./capabilities.js";
import type { BrokenPreference, PlanRefusal, Snapshot } from "./decision.js";
import { decideAction } from "./decision.js";
import type { IntegrationSubject } from "./kinds.js";

const now = new Date("2026-11-10T08:00:00Z");
const block = {
  courseId: "course-1",
  obligationId: "obligation-1",
  placedBy: "nunio" as const,
  createdBy: null,
  locked: false,
  start: new Date("2026-11-10T09:00:00Z"),
  end: new Date("2026-11-10T10:00:00Z"),
};
const args = {
  studyBlockId: "block-1",
  start: new Date("2026-11-11T09:00:00Z"),
  end: new Date("2026-11-11T10:00:00Z"),
};
/** A Chat's move of a block, which has no Agent and so no Grant. */
const base: Snapshot = {
  intent: { kind: "studyBlock.move", args },
  subject: block,
  fingerprint: "fp-1",
  now,
  agent: null,
  intoProtectedTime: false,
  planCheck: null,
  taskDue: null,
  approval: null,
  runUse: null,
};
const ask = { outcome: "await_approval" };
const refuse = (reason: string) => ({ outcome: "refuse", reason });
const approved = {
  id: "approval-1",
  decision: "approved" as const,
  fingerprint: "fp-1",
  expiresAt: new Date("2026-11-17T08:00:00Z"),
};
/** A Chat's removal of the block, approved by the student. */
const removal: Partial<Snapshot> = {
  intent: {
    kind: "studyBlock.remove",
    args: {
      studyBlockId: "block-1",
      workId: "obligation-1",
      start: block.start,
      end: block.end,
    },
  },
  approval: approved,
};
const requested = {
  id: "approval-1",
  decision: null,
  fingerprint: "fp-1",
  expiresAt: new Date("2026-11-17T08:00:00Z"),
};

describe("decideAction in a Chat", () => {
  it.each<[string, Partial<Snapshot>, object]>([
    ["always asks, as a Chat has no Agent", {}, ask],
    [
      "refuses work the student does not own",
      { subject: null },
      refuse("not_owner"),
    ],
    [
      "refuses a Locked block, even when asked",
      { subject: { ...block, locked: true }, approval: approved },
      refuse("locked"),
    ],
    [
      "refuses Protected Time, even when asked",
      { intoProtectedTime: true, approval: approved },
      refuse("protected_time"),
    ],
    ["keeps waiting for an unanswered Approval", { approval: requested }, ask],
    [
      "acts on an Approval of the exact Action",
      { approval: approved },
      { outcome: "dispatch", authority: { approvalId: "approval-1" } },
    ],
    [
      "refuses a denied Approval",
      { approval: { ...requested, decision: "denied" } },
      refuse("approval_denied"),
    ],
    [
      "refuses an Approval of a different Action",
      { approval: approved, fingerprint: "fp-2" },
      refuse("approval_mismatch"),
    ],
    [
      "refuses an unanswered Approval past its expiry",
      { approval: { ...requested, expiresAt: now } },
      refuse("approval_expired"),
    ],
    [
      "refuses an approved Action at its expiry",
      { approval: { ...approved, expiresAt: now } },
      refuse("approval_expired"),
    ],
    [
      "removes a block not yet started once the student approved it",
      { ...removal, subject: block },
      { outcome: "dispatch", authority: { approvalId: "approval-1" } },
    ],
    [
      "refuses removing a block that has started, even when asked (ADR-0021)",
      { ...removal, subject: { ...block, start: now } },
      refuse("started"),
    ],
  ])("%s", (_, change, expected) => {
    expect(decideAction({ ...base, ...change })).toEqual(expected);
  });
});

describe("an Agent's Actions (ADR-0001)", () => {
  const work = { courseId: "course-1", obligationId: "obligation-1" };
  /** Far enough ahead that nothing changes within the next 24 hours. */
  const later = {
    start: new Date("2026-11-12T09:00:00Z"),
    end: new Date("2026-11-12T10:00:00Z"),
  };
  const soon = {
    start: new Date("2026-11-11T07:00:00Z"),
    end: new Date("2026-11-11T08:00:00Z"),
  };
  const create = (span = later): Partial<Snapshot> => ({
    intent: {
      kind: "studyBlock.create",
      args: { workId: "obligation-1", ...span },
    },
    subject: work,
  });
  const own = { ...block, ...later, createdBy: "agent-1" };
  const move = (
    subject: object = own,
    span = {
      start: new Date("2026-11-13T09:00:00Z"),
      end: new Date("2026-11-13T10:00:00Z"),
    },
  ): Partial<Snapshot> => ({
    intent: {
      kind: "studyBlock.move",
      args: { studyBlockId: "block-1", ...span },
    },
    subject: { ...own, ...subject },
  });
  const remove = (subject: object = own): Partial<Snapshot> => {
    const target = { ...own, ...subject };
    return {
      intent: {
        kind: "studyBlock.remove",
        args: {
          studyBlockId: "block-1",
          workId: "obligation-1",
          start: target.start,
          end: target.end,
        },
      },
      subject: target,
    };
  };
  /** A Task in one of its Courses, toward none of its Obligations, due when the snapshot says. */
  const task = (due: Date | null = null): Partial<Snapshot> => ({
    intent: {
      kind: "task.create",
      args: {
        title: "Thema X wiederholen",
        courseId: "course-1",
        fixedEventId: null,
        role: null,
        estimateMinutes: null,
      },
    },
    subject: { courseId: "course-1", obligationId: null },
    taskDue: due,
  });
  /** A Course Event's Preparation, due when the event starts. */
  const preparation = (due: Date): Partial<Snapshot> => {
    const made = task(due);
    return {
      ...made,
      intent: {
        kind: "task.create",
        args: {
          ...(made.intent!.args as object),
          fixedEventId: "event-1",
          role: "preparation",
        },
      } as Snapshot["intent"],
    };
  };
  const modes = {
    createStudyBlocks: "automatic",
    moveOwnStudyBlocks: "automatic",
    moveStudyBlocks: "ask",
    removeOwnStudyBlocks: "automatic",
    createTasks: "ask",
  } as const;
  type Held = Partial<Record<CapabilityId, ApprovalMode>>;
  const agent = (held: Held = modes) => ({
    id: "agent-1",
    state: "active" as const,
    capabilities: Object.entries(held).map(
      ([id, mode]) => ({ id, mode }) as AgentCapability,
    ),
    grants: [
      { id: "grant-create", kind: "studyBlock.create" as const },
      { id: "grant-move", kind: "studyBlock.move" as const },
      { id: "grant-remove", kind: "studyBlock.remove" as const },
      { id: "grant-task", kind: "task.create" as const },
    ],
    courseIds: ["course-1"],
  });
  const withModes = (held: Held) => ({
    agent: agent({ ...modes, ...held }),
  });
  const verdict = (
    refusals: PlanRefusal[] = [],
    brokenPreferences: BrokenPreference[] = [],
  ) => ({ planCheck: { refusals, brokenPreferences } });
  const byGrant = (grantId: string, extra: object = {}) => ({
    outcome: "dispatch",
    authority: { grantId },
    ...extra,
  });
  const byApproval = {
    outcome: "dispatch",
    authority: { approvalId: "approval-1" },
  };
  const uses = (counts: Partial<NonNullable<Snapshot["runUse"]>>) => ({
    runUse: {
      calls: 0,
      stepCalls: 0,
      approvals: 0,
      openApprovals: 0,
      ended: false,
      ...counts,
    },
  });
  const situation = (...parts: Partial<Snapshot>[]): Partial<Snapshot> =>
    Object.assign({ agent: agent(), ...verdict() }, ...parts);

  it.each<[string, Partial<Snapshot>, object]>([
    // Modes
    [
      "creates a block on Automatisch",
      situation(create()),
      byGrant("grant-create"),
    ],
    [
      "creates a block on Immer erlaubt",
      situation(create(), withModes({ createStudyBlocks: "always" })),
      byGrant("grant-create"),
    ],
    [
      "asks on Nachfragen",
      situation(create(), withModes({ createStudyBlocks: "ask" })),
      ask,
    ],
    [
      "asks on Automatisch when the block would break a Preference",
      situation(create(), verdict([], ["outside_study_window"])),
      ask,
    ],
    [
      "acts on Immer erlaubt despite a broken Preference, and notes it",
      situation(
        create(),
        withModes({ createStudyBlocks: "always" }),
        verdict([], ["daily_limit", "work_limit"]),
      ),
      byGrant("grant-create", {
        brokenPreferences: ["daily_limit", "work_limit"],
      }),
    ],
    [
      "asks on Automatisch for a block that starts within the next 24 hours",
      situation(create(soon)),
      ask,
    ],
    [
      "acts on Automatisch for a block that starts exactly 24 hours ahead",
      situation(
        create({
          start: new Date("2026-11-11T08:00:00Z"),
          end: new Date("2026-11-11T09:00:00Z"),
        }),
      ),
      byGrant("grant-create"),
    ],
    [
      "acts on Immer erlaubt for a block within the next 24 hours",
      situation(create(soon), withModes({ createStudyBlocks: "always" })),
      byGrant("grant-create"),
    ],
    [
      "refuses a kind the Agent has no Capability for",
      situation(create(), { agent: agent({ moveOwnStudyBlocks: "always" }) }),
      refuse("no_capability"),
    ],
    [
      "asks when its mode holds a Grant the Agent does not have yet",
      situation(create(), {
        agent: { ...agent(), grants: [] },
      }),
      ask,
    ],
    // Tasks (#154)
    ["asks to create a Task on Nachfragen", situation(task()), ask],
    [
      "creates a Task on Automatisch",
      situation(task(), withModes({ createTasks: "automatic" })),
      byGrant("grant-task"),
    ],
    [
      "asks on Automatisch for a Task due within the next 24 hours",
      situation(
        task(new Date("2026-11-11T07:59:00Z")),
        withModes({ createTasks: "automatic" }),
      ),
      ask,
    ],
    [
      "creates a Task due exactly 24 hours ahead on Automatisch",
      situation(
        task(new Date("2026-11-11T08:00:00Z")),
        withModes({ createTasks: "automatic" }),
      ),
      byGrant("grant-task"),
    ],
    [
      "creates a Task due within the next 24 hours on Immer erlaubt",
      situation(
        task(new Date("2026-11-10T20:00:00Z")),
        withModes({ createTasks: "always" }),
      ),
      byGrant("grant-task"),
    ],
    [
      "refuses a Task without Aufgaben erstellen",
      situation(task(), { agent: agent({ createStudyBlocks: "always" }) }),
      refuse("no_capability"),
    ],
    [
      "refuses a Task outside the Agent's Courses",
      situation(task(), {
        subject: { courseId: "course-2", obligationId: null },
      }),
      refuse("out_of_scope"),
    ],
    [
      "refuses a Preparation for a Course Event that has started, even on Immer erlaubt",
      situation(preparation(now), withModes({ createTasks: "always" })),
      refuse("past"),
    ],
    [
      "refuses a Course Event's Task whose window has ended, even when approved",
      situation(preparation(new Date("2026-11-10T07:00:00Z")), {
        approval: approved,
      }),
      refuse("past"),
    ],
    [
      "creates a Preparation whose Course Event is still to come on Immer erlaubt",
      situation(
        preparation(new Date("2026-11-10T09:00:00Z")),
        withModes({ createTasks: "always" }),
      ),
      byGrant("grant-task"),
    ],
    [
      "refuses a Task in no Course",
      situation(task(), withModes({ createTasks: "always" }), {
        subject: { courseId: null, obligationId: null },
      }),
      refuse("out_of_scope"),
    ],
    // Own and others' blocks
    [
      "moves its own block on Automatisch",
      situation(move()),
      byGrant("grant-move"),
    ],
    [
      "asks on Automatisch to move its own block away from the next 24 hours",
      situation(move({ ...soon })),
      ask,
    ],
    [
      "asks on Automatisch to move its own block into the next 24 hours",
      situation(move(own, soon)),
      ask,
    ],
    [
      "asks to move a block the student placed, even on Immer erlaubt",
      situation(
        move({ createdBy: null, placedBy: "student" }),
        withModes({ moveOwnStudyBlocks: "always" }),
      ),
      ask,
    ],
    [
      "asks to move a block nunio placed outside this Agent",
      situation(
        move({ createdBy: null }),
        withModes({ moveOwnStudyBlocks: "always" }),
      ),
      ask,
    ],
    [
      "asks to move another Agent's block",
      situation(
        move({ createdBy: "agent-2" }),
        withModes({ moveOwnStudyBlocks: "always" }),
      ),
      ask,
    ],
    [
      "refuses to move others' blocks without Lernblöcke verschieben",
      situation(move({ createdBy: null }), {
        agent: agent({ moveOwnStudyBlocks: "always" }),
      }),
      refuse("no_capability"),
    ],
    [
      "ignores Lernblöcke verschieben stored on a mode it does not allow",
      situation(move({ createdBy: null }), {
        agent: agent({
          moveOwnStudyBlocks: "always",
          moveStudyBlocks: "always",
        }),
      }),
      refuse("no_capability"),
    ],
    [
      "asks to move its own block with only Lernblöcke verschieben",
      situation(move(), { agent: agent({ moveStudyBlocks: "ask" }) }),
      ask,
    ],
    [
      "removes its own block on Automatisch",
      situation(remove()),
      byGrant("grant-remove"),
    ],
    [
      "asks on Automatisch to remove its own block within the next 24 hours",
      situation(remove(soon)),
      ask,
    ],
    [
      "refuses to remove a block it did not create: no Capability does",
      situation(remove({ createdBy: null })),
      refuse("no_capability"),
    ],
    // Scope
    [
      "refuses work outside the Agent's Courses",
      situation(create(), { subject: { ...work, courseId: "course-2" } }),
      refuse("out_of_scope"),
    ],
    [
      "refuses work in no Course",
      situation(create(), { subject: { courseId: null, obligationId: null } }),
      refuse("out_of_scope"),
    ],
    [
      "refuses an Approval for a Course since removed or Archived",
      situation(create(), withModes({ createStudyBlocks: "ask" }), {
        agent: { ...agent(), courseIds: [] },
        approval: approved,
      }),
      refuse("out_of_scope"),
    ],
    [
      "refuses moving another Course's block, without asking",
      situation(move({ createdBy: null, courseId: "course-2" })),
      refuse("out_of_scope"),
    ],
    // Approvals
    [
      "acts on an Approval of the exact Action on Nachfragen",
      situation(create(), withModes({ createStudyBlocks: "ask" }), {
        approval: approved,
      }),
      byApproval,
    ],
    [
      "acts on an Approval to move another's block",
      situation(move({ createdBy: null }), { approval: approved }),
      byApproval,
    ],
    [
      "keeps waiting for an unanswered Approval",
      situation(create(soon), { approval: requested }),
      ask,
    ],
    [
      "refuses a denied Approval",
      situation(create(), { approval: { ...requested, decision: "denied" } }),
      refuse("approval_denied"),
    ],
    [
      "refuses an Approval of a different Action",
      situation(create(), { approval: approved, fingerprint: "fp-2" }),
      refuse("approval_mismatch"),
    ],
    [
      "refuses for a Paused Agent",
      situation(create(), { agent: { ...agent(), state: "paused" } }),
      refuse("paused"),
    ],
    [
      "refuses work the student does not own",
      situation(create(), { subject: null }),
      refuse("not_owner"),
    ],
    [
      "refuses moving its own block once it has started, even when approved",
      situation(move({ start: now }), { approval: approved }),
      refuse("started"),
    ],
    // Caps per Run (ADR-0026) and open Approvals per Agent, counted before this new call
    [
      "acts as its 20th call in the Run",
      situation(create(), uses({ calls: 19 })),
      byGrant("grant-create"),
    ],
    [
      "refuses a new call once its Run has ended, even one it holds a Grant for",
      situation(create(), uses({ ended: true })),
      refuse("run_ended"),
    ],
    [
      "refuses a 21st call in the Run, even one it holds a Grant for",
      situation(create(), uses({ calls: 20 })),
      refuse("run_cap"),
    ],
    [
      "refuses a sixth call in one step",
      situation(create(), uses({ stepCalls: 5 })),
      refuse("run_cap"),
    ],
    [
      "refuses past the call cap before anything else, even out of scope",
      situation(move({ courseId: "course-2" }), uses({ calls: 20 })),
      refuse("run_cap"),
    ],
    [
      "asks its fifth Approval in the Run",
      situation(create(soon), uses({ approvals: 4 })),
      ask,
    ],
    [
      "refuses asking a sixth Approval in the Run",
      situation(create(soon), uses({ approvals: 5 })),
      refuse("run_cap"),
    ],
    [
      "still acts on a Grant once the Run asked five Approvals",
      situation(create(), uses({ approvals: 5 })),
      byGrant("grant-create"),
    ],
    [
      "refuses asking while its Agent has five Approvals open",
      situation(create(soon), uses({ openApprovals: 5 })),
      refuse("open_approvals_cap"),
    ],
    [
      "still acts on a Grant while its Agent has five Approvals open",
      situation(create(), uses({ openApprovals: 5 })),
      byGrant("grant-create"),
    ],
    [
      "still refuses what the Plan's rules refuse rather than counting it as asked",
      situation(create(soon), verdict(["past"]), uses({ approvals: 5 })),
      refuse("past"),
    ],
  ])("%s", (_, change, expected) => {
    expect(decideAction({ ...base, ...change })).toEqual(expected);
  });

  /** What the Plan's rules refuse (`plan.check`), refused on every mode and despite an Approval. */
  describe.each<PlanRefusal>([
    "locked",
    "started",
    "past",
    "protected_time",
    "fixed_event",
    "study_block",
  ])("refuses %s", (reason) => {
    it.each([
      ["Immer erlaubt", withModes({ createStudyBlocks: "always" })],
      ["Automatisch", withModes({ createStudyBlocks: "automatic" })],
      ["Nachfragen", withModes({ createStudyBlocks: "ask" })],
      [
        "an Approval",
        { ...withModes({ createStudyBlocks: "ask" }), approval: approved },
      ],
    ])("on %s", (_, mode) => {
      expect(
        decideAction({
          ...base,
          ...situation(create(), verdict([reason]), mode as Partial<Snapshot>),
        }),
      ).toEqual(refuse(reason));
    });
  });
});

describe("decideAction for an Integration Action", () => {
  const tool: NonNullable<IntegrationSubject["tool"]> = {
    class: "write",
    definitionHash: "pin-1",
    chatOnly: false,
  };
  const connected = { connection: { state: "connected" as const }, tool };
  /** A Chat's call of a write tool on a Connected Connection, which no Grant covers yet. */
  const call: Snapshot = {
    ...base,
    intent: {
      kind: "integration.call",
      args: {
        integrationKey: "testnotizen",
        connectionId: "connection-1",
        toolName: "notes.create_page",
        pinHash: "pin-1",
        arguments: { title: "Lineare Algebra" },
      },
    },
    subject: connected,
  };
  const inRun = (state: "active" | "paused" | "ended") => ({
    inRun: true,
    agent: {
      id: "agent-1",
      state,
      capabilities: [],
      grants: [],
      courseIds: [],
    },
  });
  const withTool = (changes: Partial<typeof tool> | null) => ({
    subject: { ...connected, tool: changes && { ...tool, ...changes } },
  });

  it.each<[string, Partial<Snapshot>, object]>([
    ["asks for a write", {}, ask],
    [
      "asks for a write that is always asked",
      withTool({ class: "write_always_asked" }),
      ask,
    ],
    ["asks in an Agent's Run", inRun("active"), ask],
    ["refuses for a Paused Agent", inRun("paused"), refuse("paused")],
    ["refuses for an Ended Agent", inRun("ended"), refuse("ended")],
    [
      "refuses a new call of a Run that ended",
      {
        ...inRun("active"),
        runUse: {
          calls: 0,
          stepCalls: 0,
          approvals: 0,
          openApprovals: 0,
          ended: true,
        },
      },
      refuse("run_ended"),
    ],
    [
      "refuses for a Paused Agent before a missing Connection",
      { ...inRun("paused"), subject: null },
      refuse("paused"),
    ],
    [
      "refuses a Connection that isn't the student's or is gone",
      { subject: null },
      refuse("not_owner"),
    ],
    [
      "refuses a Connection that Needs reconnection, even when approved",
      {
        subject: { ...connected, connection: { state: "needs_reconnection" } },
        approval: approved,
      },
      refuse("needs_reconnection"),
    ],
    [
      "refuses a tool nunio never classified or that was removed, even when approved",
      { ...withTool(null), approval: approved },
      refuse("tool_unavailable"),
    ],
    [
      "refuses a blocked tool, even when approved",
      { ...withTool({ class: "blocked" }), approval: approved },
      refuse("tool_unavailable"),
    ],
    [
      "refuses a read tool, which no Action calls, even when approved",
      { ...withTool({ class: "read" }), approval: approved },
      refuse("tool_unavailable"),
    ],
    [
      "refuses a Chat-only tool in a Run, even when approved",
      {
        ...inRun("active"),
        ...withTool({ chatOnly: true }),
        approval: approved,
      },
      refuse("tool_unavailable"),
    ],
    ["asks for a Chat-only tool in a Chat", withTool({ chatOnly: true }), ask],
    [
      "acts on an Approval of the exact call",
      { approval: approved },
      { outcome: "dispatch", authority: { approvalId: "approval-1" } },
    ],
    [
      "still acts on a matching Approval once the tool is always asked",
      { ...withTool({ class: "write_always_asked" }), approval: approved },
      { outcome: "dispatch", authority: { approvalId: "approval-1" } },
    ],
    [
      "refuses a new call made under a pin the tool no longer has",
      withTool({ definitionHash: "pin-2" }),
      refuse("tool_unavailable"),
    ],
    [
      "refuses an Approval given before the tool's pin changed",
      // The fingerprint holds the pin, so the one shown no longer matches.
      { fingerprint: "fp-2", approval: approved },
      refuse("approval_mismatch"),
    ],
    ["keeps waiting for an unanswered Approval", { approval: requested }, ask],
    [
      "refuses a denied Approval",
      { approval: { ...approved, decision: "denied" } },
      refuse("approval_denied"),
    ],
    [
      "refuses an expired Approval",
      { approval: { ...approved, expiresAt: now } },
      refuse("approval_expired"),
    ],
  ])("%s", (_, changes, expected) => {
    expect(decideAction({ ...call, ...changes })).toEqual(expected);
  });
});
