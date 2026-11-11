import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { DayHeader } from "./day-header";

const monday = new Date(2026, 10, 9);

test("labels the day with its German weekday and date", () => {
  render(
    <DayHeader
      date={monday}
      plannedMinutes={120}
      goalMinutes={240}
      today={false}
    />,
  );

  expect(screen.getByText("Montag, 09.11.")).toBeTruthy();
});

test("marks only today's header as the current date", () => {
  const { container, rerender } = render(
    <DayHeader date={monday} plannedMinutes={0} goalMinutes={240} today />,
  );

  expect(
    container.querySelector('[aria-current="date"]')?.textContent,
  ).toContain("Montag, 09.11.");

  rerender(
    <DayHeader
      date={monday}
      plannedMinutes={0}
      goalMinutes={240}
      today={false}
    />,
  );

  expect(container.querySelector("[aria-current]")).toBeNull();
});

test("shows planned against goal hours as a progress bar", () => {
  render(
    <DayHeader
      date={monday}
      plannedMinutes={120}
      goalMinutes={240}
      today={false}
    />,
  );

  const bar = screen.getByRole("progressbar", {
    name: "2 von 4 Stunden geplant",
  });
  expect(bar.getAttribute("aria-valuenow")).toBe("120");
  expect(bar.getAttribute("aria-valuemax")).toBe("240");
});

test("states planned and goal hours, with a decimal only when needed", () => {
  const { rerender } = render(
    <DayHeader
      date={monday}
      plannedMinutes={120}
      goalMinutes={240}
      today={false}
    />,
  );

  expect(screen.getByText("2 / 4 h")).toBeTruthy();

  rerender(
    <DayHeader
      date={monday}
      plannedMinutes={90}
      goalMinutes={240}
      today={false}
    />,
  );

  expect(screen.getByText("1,5 / 4 h")).toBeTruthy();
});

test("keeps the bar full but states real hours above the goal", () => {
  render(
    <DayHeader
      date={monday}
      plannedMinutes={300}
      goalMinutes={240}
      today={false}
    />,
  );

  const bar = screen.getByRole("progressbar", {
    name: "5 von 4 Stunden geplant",
  });
  expect(bar.getAttribute("aria-valuenow")).toBe("240");
  expect(screen.getByText("5 / 4 h")).toBeTruthy();
});
