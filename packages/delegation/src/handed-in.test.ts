import { describe, expect, it } from "vitest";
import { isHandedIn } from "./handed-in.js";

describe("isHandedIn", () => {
  it("is true for an Obligation Reported as Submitted", () => {
    expect(
      isHandedIn({ reportedSubmittedAt: new Date("2026-11-10T09:00:00Z") }),
    ).toBe(true);
  });

  it("is false for an Obligation not Reported as Submitted", () => {
    expect(isHandedIn({ reportedSubmittedAt: null })).toBe(false);
  });
});
