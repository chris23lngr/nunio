import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ProtectedTimeBlock } from "./protected-time-block";

test("Protected Time is a note labelled Geschützte Zeit by default", () => {
  render(<ProtectedTimeBlock />);

  expect(screen.getByRole("note").textContent).toBe("Geschützte Zeit");
});

test("Protected Time shows its own label when given one", () => {
  render(<ProtectedTimeBlock label="Training" />);

  expect(screen.getByRole("note").textContent).toBe("Training");
});
