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

/** A Run's move of a block nunio placed, inside its Responsibility's Grant: dispatched without asking. */
const base: Snapshot = {
  intent: { kind: "studyBlock.move", args },
  subject: block,
  fingerprint: "fp-1",
  now,
  responsibility: active,
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
      "refuses for a Paused Responsibility, even with a Grant",
      { responsibility: { ...active, state: "paused" } },
      refuse("paused"),
    ],
    [
      "refuses for a Paused Responsibility, even with an Approval",
      { responsibility: { ...active, state: "paused" }, approval: approved },
      refuse("paused"),
    ],
    [
      "refuses for an Ended Responsibility",
      { responsibility: { ...active, state: "ended" } },
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
      { responsibility: { ...active, grants: [] } },
      ask,
    ],
    [
      "asks when the Grant is for another kind",
      {
        responsibility: {
          ...active,
          grants: [{ ...grant, kind: "studyBlock.create" }],
        },
      },
      ask,
    ],
    [
      "asks when the Grant's scope does not cover the work",
      {
        responsibility: {
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
    [
      "always asks in a Chat, which has no Responsibility",
      { responsibility: null },
      ask,
    ],
    [
      "keeps waiting for an unanswered Approval",
      { responsibility: null, approval: requested },
      ask,
    ],
    [
      "acts on an Approval of the exact Action",
      { responsibility: null, approval: approved },
      { outcome: "dispatch", authority: { approvalId: "approval-1" } },
    ],
    [
      "refuses a denied Approval, even with a Grant",
      { approval: { ...requested, decision: "denied" } },
      refuse("approval_denied"),
    ],
    [
      "refuses an Approval of a different Action",
      { responsibility: null, approval: approved, fingerprint: "fp-2" },
      refuse("approval_mismatch"),
    ],
    [
      "refuses an unanswered Approval past its expiry",
      { responsibility: null, approval: { ...requested, expiresAt: now } },
      refuse("approval_expired"),
    ],
    [
      "acts on an Approval given before its expiry",
      { responsibility: null, approval: { ...approved, expiresAt: now } },
      { outcome: "dispatch", authority: { approvalId: "approval-1" } },
    ],
  ])("%s", (_, change, expected) => {
    expect(decideAction({ ...base, ...change })).toEqual(expected);
  });
});

describe("Restrictions", () => {
  const restricted = (restrictions: object): Partial<Snapshot> => ({
    responsibility: { ...active, restrictions },
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

  it("never widen authority: no combination dispatches what the unrestricted Responsibility would not", () => {
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
      { responsibility: { ...active, grants: [] } },
      { approval: requested },
      { approval: approved },
      { subject: { ...block, locked: true } },
    ];
    const rank = (d: { outcome: string }) =>
      ({ dispatch: 2, await_approval: 1, refuse: 0 })[d.outcome]!;
    for (const situation of situations) {
      const unrestricted = decideAction({ ...base, ...situation });
      for (const restrictions of restrictionSets) {
        const responsibility = {
          ...(situation.responsibility ?? active),
          restrictions,
        };
        expect(
          rank(decideAction({ ...base, ...situation, responsibility })),
        ).toBeLessThanOrEqual(rank(unrestricted));
      }
    }
  });
});
