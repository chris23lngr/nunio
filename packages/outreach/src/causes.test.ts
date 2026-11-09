import { describe, expect, it } from "vitest";
import type { Cause } from "./causes.js";
import { causesOf } from "./causes.js";

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
      cause: { kind: "shortfall", key: "shortfall:w1", actionId: null },
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
        key: "disagreement:obligation:o1",
        actionId: null,
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
      cause: {
        kind: "disagreement",
        key: "disagreement:fact:f1",
        actionId: null,
      },
    },
    {
      holds: "an Approval that expired",
      state: {
        ...none,
        actions: [{ id: "a1", status: "refused", refusal: "approval_expired" }],
      },
      cause: {
        kind: "approval_expired",
        key: "approval_expired:a1",
        actionId: "a1",
      },
    },
    {
      holds: "an Unconfirmed Action",
      state: {
        ...none,
        actions: [{ id: "a2", status: "unconfirmed", refusal: null }],
      },
      cause: { kind: "unconfirmed", key: "unconfirmed:a2", actionId: "a2" },
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
