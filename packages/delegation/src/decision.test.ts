import { describe, expect, it } from "vitest";
import type { Restrictions, Snapshot } from "./decision.js";
import { decideAction } from "./decision.js";

const now = new Date("2026-11-10T08:00:00Z");
const block = {
  courseId: "course-1",
  obligationId: "obligation-1",
  placedBy: "nunio" as const,
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
