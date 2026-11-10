import { expect, it } from "vitest";
import { semesterAt, semesterChoices } from "./semester.js";

it("switches Semesters at midnight Berlin time on 1 October and 1 April", () => {
  // 22:30 UTC on 30 September is already 1 October in Berlin (UTC+2).
  expect(semesterAt(new Date("2026-09-30T21:59:00Z"))).toBe("2026-ss");
  expect(semesterAt(new Date("2026-09-30T22:00:00Z"))).toBe("2026-ws");
  // 23:00 UTC on 31 March is 1 April in Berlin (UTC+2 after the clock change).
  expect(semesterAt(new Date("2027-03-31T21:59:00Z"))).toBe("2026-ws");
  expect(semesterAt(new Date("2027-03-31T22:00:00Z"))).toBe("2027-ss");
});

it("keeps a Wintersemester running across the turn of the year", () => {
  expect(semesterAt(new Date("2027-02-12T10:00:00Z"))).toBe("2026-ws");
});

it("offers four years back through the next Semester, newest first", () => {
  expect(semesterChoices(new Date("2026-11-10T10:00:00Z"))).toEqual([
    "2027-ss",
    "2026-ws",
    "2026-ss",
    "2025-ws",
    "2025-ss",
    "2024-ws",
    "2024-ss",
    "2023-ws",
    "2023-ss",
    "2022-ws",
  ]);
});
