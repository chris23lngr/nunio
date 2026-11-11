import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { PlanLegend } from "./plan-legend";

test("the legend names every kind of mark on the plan, in order", () => {
  render(<PlanLegend />);

  const legend = screen.getByRole("list", { name: "Legende" });
  const labels = within(legend)
    .getAllByRole("listitem")
    .map((item) => item.textContent);
  expect(labels).toEqual([
    "Von dir gesetzt",
    "Vorschlag",
    "Gesperrt",
    "Fixtermin",
    "Lernblock",
    "Geschützte Zeit",
  ]);
});
