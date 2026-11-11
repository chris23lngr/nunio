import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { CourseDot } from "./course-dot";

const dot = (id: string) =>
  render(<CourseDot id={id} />).container.querySelector(
    "[data-slot=course-dot]",
  );

test("a Course keeps its color wherever its dot is shown", () => {
  expect(dot("course-1")?.className).toBe(dot("course-1")?.className);
  expect(dot("course-1")?.className).not.toBe(dot("course-2")?.className);
});

test("the dot is decoration for screen readers", () => {
  expect(dot("course-1")?.getAttribute("aria-hidden")).toBe("true");
});
