import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { CourseDot } from "./course-dot";

const dot = (color: Parameters<typeof CourseDot>[0]["color"]) =>
  render(<CourseDot color={color} />).container.querySelector<HTMLElement>(
    "[data-slot=course-dot]",
  );

test("the dot shows the Course's color", () => {
  expect(dot("rose")?.style.backgroundColor).toBe("oklch(0.645 0.246 16.439)");
  expect(dot("teal")?.style.backgroundColor).toBe("oklch(0.704 0.14 182.503)");
});

test("the dot is decoration for screen readers", () => {
  expect(dot("rose")?.getAttribute("aria-hidden")).toBe("true");
});
