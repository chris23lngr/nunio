import { expect, it } from "vitest";
import { scoreBoundCourse } from "./assignment.js";

const source = {
  extraction: "done",
  boundCourseId: "chosen",
  itemCourseIds: ["chosen", "chosen"],
};

it("passes two bound decks only when both contribute items to the chosen Course without proposals", () => {
  expect(scoreBoundCourse("chosen", [source, source], 0)).toBe(true);
  expect(scoreBoundCourse("chosen", [source, source], 1)).toBe(false);
  expect(
    scoreBoundCourse(
      "chosen",
      [source, { ...source, itemCourseIds: ["other"] }],
      0,
    ),
  ).toBe(false);
  expect(
    scoreBoundCourse("chosen", [source, { ...source, boundCourseId: null }], 0),
  ).toBe(false);
  expect(
    scoreBoundCourse("chosen", [source, { ...source, itemCourseIds: [] }], 0),
  ).toBe(false);
  expect(
    scoreBoundCourse(
      "chosen",
      [source, { ...source, extraction: "failed" }],
      0,
    ),
  ).toBe(false);
});
