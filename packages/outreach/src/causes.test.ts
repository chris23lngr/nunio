import { describe, expect, it } from "vitest";
import type { Cause } from "./causes.js";
import { causeOf, causesOf, keyOf } from "./causes.js";

type State = Parameters<typeof causesOf>[0];
const none: State = {
  shortfalls: [],
  review: { courses: [] },
  actions: [],
};

describe("causesOf", () => {
  it.each([
    {
      holds: "a Shortfall before a deadline",
      state: {
        ...none,
        shortfalls: [
          {
            workId: "w1",
            due: new Date("2026-11-10T11:00:00Z"),
            shortMinutes: 600,
            tradeoffs: [],
          },
        ],
      },
      cause: { kind: "shortfall", subject: { kind: "work", id: "w1" } },
    },
    {
      holds: "a Disagreement over an Obligation",
      state: {
        ...none,
        review: {
          courses: [
            {
              obligations: [{ id: "o1", disagreement: true }],
              facts: [],
            },
          ],
        },
      },
      cause: {
        kind: "disagreement",
        subject: { kind: "obligation", id: "o1" },
      },
    },
    {
      holds: "a Disagreement over a Fact",
      state: {
        ...none,
        review: {
          courses: [
            {
              obligations: [],
              facts: [{ id: "f1", disagreement: true }],
            },
          ],
        },
      },
      cause: { kind: "disagreement", subject: { kind: "fact", id: "f1" } },
    },
    {
      holds: "an Approval that expired",
      state: {
        ...none,
        actions: [{ id: "a1", status: "refused", refusal: "approval_expired" }],
      },
      cause: {
        kind: "approval_expired",
        subject: { kind: "action", id: "a1" },
      },
    },
    {
      holds: "an Unconfirmed Action",
      state: {
        ...none,
        actions: [{ id: "a2", status: "unconfirmed", refusal: null }],
      },
      cause: { kind: "unconfirmed", subject: { kind: "action", id: "a2" } },
    },
  ] satisfies { holds: string; state: State; cause: Cause }[])(
    "finds $holds",
    ({ state, cause }) => {
      expect(causesOf(state)).toEqual([cause]);
    },
  );

  it("finds nothing in agreeing Facts, resolved Actions, or other refusals", () => {
    expect(
      causesOf({
        ...none,
        review: {
          courses: [
            {
              obligations: [{ id: "o1", disagreement: false }],
              facts: [{ id: "f1", disagreement: false }],
            },
          ],
        },
        actions: [
          { id: "a1", status: "done", refusal: null },
          { id: "a2", status: "refused", refusal: "paused" },
        ],
      }),
    ).toEqual([]);
  });
});

describe("cause keys", () => {
  it.each([
    [
      "shortfall:w1",
      { kind: "shortfall", subject: { kind: "work", id: "w1" } },
    ],
    [
      "disagreement:obligation:o1",
      { kind: "disagreement", subject: { kind: "obligation", id: "o1" } },
    ],
    [
      "disagreement:fact:f1",
      { kind: "disagreement", subject: { kind: "fact", id: "f1" } },
    ],
    // As Phase 9 Runs already stored them.
    [
      "approval_expired:a1",
      { kind: "approval_expired", subject: { kind: "action", id: "a1" } },
    ],
    [
      "unconfirmed:a2",
      { kind: "unconfirmed", subject: { kind: "action", id: "a2" } },
    ],
  ] satisfies [string, Cause][])("stores and reads back %s", (key, cause) => {
    expect(keyOf(cause)).toBe(key);
    expect(causeOf(key)).toEqual(cause);
  });

  it.each([
    "",
    "shortfall",
    "disagreement:fact:",
    "disagreement:course:c1",
    "lapse:x",
  ])("refuses %j, which is no cause key", (key) => {
    expect(() => causeOf(key)).toThrow();
  });
});
