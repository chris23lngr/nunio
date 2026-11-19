import { describe, expect, it } from "vitest";
import type {
  AgentCapability,
  ApprovalMode,
  CapabilityId,
} from "./capabilities.js";
import type {
  BrokenPreference,
  PlanRefusal,
  Restrictions,
  Snapshot,
} from "./decision.js";
import { decideAction } from "./decision.js";

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
const grant = {
  id: "grant-1",
  kind: "studyBlock.move" as const,
  scope: { courseId: "course-1" },
};
const active = { state: "active" as const, grants: [grant], restrictions: {} };

/** A Run's move of a block nunio placed, inside its Agent's Grant: dispatched without asking. */
const base: Snapshot = {
  intent: { kind: "studyBlock.move", args },
  subject: block,
  fingerprint: "fp-1",
  now,
  agent: active,
  intoProtectedTime: false,
  planCheck: null,
  approval: null,
};
const dispatchByGrant = {
  outcome: "dispatch",
  authority: { grantId: "grant-1" },
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
  agent: null,
  approval: approved,
};
const requested = {
  id: "approval-1",
  decision: null,
  fingerprint: "fp-1",
  expiresAt: new Date("2026-11-17T08:00:00Z"),
};

describe("decideAction", () => {
  it.each<[string, Partial<Snapshot>, object]>([
    ["acts on a Grant that covers the Action", {}, dispatchByGrant],
    [
      "refuses work the student does not own",
      { subject: null },
      refuse("not_owner"),
    ],
    [
      "refuses for a Paused Agent, even with a Grant",
      { agent: { ...active, state: "paused" } },
      refuse("paused"),
    ],
    [
      "refuses for a Paused Agent, even with an Approval",
      { agent: { ...active, state: "paused" }, approval: approved },
      refuse("paused"),
    ],
    [
      "refuses for an Ended Agent",
      { agent: { ...active, state: "ended" } },
      refuse("ended"),
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
    [
      "asks when no Grant covers the Action",
      { agent: { ...active, grants: [] } },
      ask,
    ],
    [
      "asks when the Grant is for another kind",
      {
        agent: {
          ...active,
          grants: [{ ...grant, kind: "studyBlock.create" }],
        },
      },
      ask,
    ],
    [
      "asks when the Grant's scope does not cover the work",
      {
        agent: {
          ...active,
          grants: [{ ...grant, scope: { courseId: "course-2" } }],
        },
      },
      ask,
    ],
    [
      "asks before moving a block the student placed",
      { subject: { ...block, placedBy: "student" } },
      ask,
    ],
    ["always asks in a Chat, which has no Agent", { agent: null }, ask],
    [
      "keeps waiting for an unanswered Approval",
      { agent: null, approval: requested },
      ask,
    ],
    [
      "acts on an Approval of the exact Action",
      { agent: null, approval: approved },
      { outcome: "dispatch", authority: { approvalId: "approval-1" } },
    ],
    [
      "refuses a denied Approval, even with a Grant",
      { approval: { ...requested, decision: "denied" } },
      refuse("approval_denied"),
    ],
    [
      "refuses an Approval of a different Action",
      { agent: null, approval: approved, fingerprint: "fp-2" },
      refuse("approval_mismatch"),
    ],
    [
      "refuses an unanswered Approval past its expiry",
      { agent: null, approval: { ...requested, expiresAt: now } },
      refuse("approval_expired"),
    ],
    [
      "refuses an approved Action at its expiry",
      { agent: null, approval: { ...approved, expiresAt: now } },
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

describe("Restrictions", () => {
  const restricted = (restrictions: object): Partial<Snapshot> => ({
    agent: { ...active, restrictions },
  });

  it.each<[string, Partial<Snapshot>, object]>([
    [
      "refuse a kind they do not allow",
      restricted({ allowedKinds: ["studyBlock.create"] }),
      refuse("restricted"),
    ],
    [
      "refuse a disallowed kind even with an Approval",
      { ...restricted({ allowedKinds: [] }), approval: approved },
      refuse("restricted"),
    ],
    [
      "turn a Grant into asking for an always-ask kind",
      restricted({ alwaysAsk: ["studyBlock.move"] }),
      ask,
    ],
    [
      "leave a kind they allow to its Grant",
      restricted({ allowedKinds: ["studyBlock.move"] }),
      dispatchByGrant,
    ],
  ])("%s", (_, change, expected) => {
    expect(decideAction({ ...base, ...change })).toEqual(expected);
  });

  it("never widen authority: no combination dispatches what the unrestricted Agent would not", () => {
    const restrictionSets: Restrictions[] = [
      {},
      { allowedKinds: [] },
      { allowedKinds: ["studyBlock.move"] },
      { alwaysAsk: ["studyBlock.move"] },
      {
        allowedKinds: ["studyBlock.create", "studyBlock.move"],
        alwaysAsk: ["studyBlock.create"],
      },
    ];
    const situations: Partial<Snapshot>[] = [
      {},
      { subject: { ...block, placedBy: "student" } },
      { agent: { ...active, grants: [] } },
      { approval: requested },
      { approval: approved },
      { subject: { ...block, locked: true } },
    ];
    const rank = (d: { outcome: string }) =>
      ({ dispatch: 2, await_approval: 1, refuse: 0 })[d.outcome]!;
    for (const situation of situations) {
      const unrestricted = decideAction({ ...base, ...situation });
      for (const restrictions of restrictionSets) {
        const agent = {
          ...(situation.agent ?? active),
          restrictions,
        };
        expect(
          rank(decideAction({ ...base, ...situation, agent })),
        ).toBeLessThanOrEqual(rank(unrestricted));
      }
    }
  });
});

describe("a free-text Agent's Actions (ADR-0001)", () => {
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
  const modes = {
    createStudyBlocks: "automatic",
    moveOwnStudyBlocks: "automatic",
    moveStudyBlocks: "ask",
    removeOwnStudyBlocks: "automatic",
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
