import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CalendarEntry } from "./calendar-entry";

const start = new Date(2026, 10, 9, 10, 0);
const end = new Date(2026, 10, 9, 12, 0);
const analysis = { title: "Analysis II", color: "blue" as const };

test("a Fixed Event is a button named by its title and time that selects it", async () => {
  const onSelect = vi.fn();
  render(
    <CalendarEntry
      kind="fixed"
      title="Vorlesung Analysis II"
      start={start}
      end={end}
      course={analysis}
      compact={false}
      narrow={false}
      onSelect={onSelect}
    />,
  );

  const entry = screen.getByRole("button", {
    name: "Vorlesung Analysis II, 10:00–12:00",
  });
  expect(entry.textContent).toContain("10:00 Uhr");
  await userEvent.setup().click(entry);
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test("a proposed Study Block shows its time and course as one meta line", () => {
  render(
    <CalendarEntry
      kind="proposal"
      title="Übungsblatt 4"
      start={new Date(2026, 10, 9, 9, 0)}
      end={new Date(2026, 10, 9, 11, 0)}
      course={{ title: "Statistics II", color: "teal" }}
      compact={false}
      narrow={false}
    />,
  );

  const entry = screen.getByRole("button", {
    name: "Übungsblatt 4, 09:00–11:00, Vorschlag",
  });
  expect(entry.textContent).toContain("09:00 Uhr · Statistics II");
});

test("a personal Fixed Event without a course shows its title and time", () => {
  render(
    <CalendarEntry
      kind="fixed"
      title="Schicht Café"
      start={new Date(2026, 10, 9, 17, 0)}
      end={new Date(2026, 10, 9, 21, 0)}
      course={null}
      compact={false}
      narrow={false}
    />,
  );

  const entry = screen.getByRole("button", {
    name: "Schicht Café, 17:00–21:00",
  });
  expect(entry.textContent).toContain("Schicht Café");
  expect(entry.textContent).toContain("17:00 Uhr");
});

test.each([
  ["compact", { compact: true, narrow: false }],
  ["narrow", { compact: false, narrow: true }],
])("a %s entry hides its time but keeps it in its name", (_, form) => {
  render(
    <CalendarEntry
      kind="study"
      title="Analysis II wiederholen"
      start={start}
      end={end}
      course={analysis}
      {...form}
    />,
  );

  const entry = screen.getByRole("button", {
    name: "Analysis II wiederholen, 10:00–12:00",
  });
  expect(entry.textContent).toContain("Analysis II wiederholen");
  expect(entry.textContent).not.toContain("Uhr");
});

test("a Study Block's name says that the student placed and locked it", () => {
  render(
    <CalendarEntry
      kind="study"
      title="Analysis II wiederholen"
      start={start}
      end={end}
      course={analysis}
      placedByStudent
      locked
      compact={false}
      narrow={false}
    />,
  );

  expect(
    screen.getByRole("button", {
      name: "Analysis II wiederholen, 10:00–12:00, von dir gesetzt, gesperrt",
    }),
  ).toBeTruthy();
});

test("a proposed Study Block's name says it is a suggestion", () => {
  render(
    <CalendarEntry
      kind="proposal"
      title="Übungsblatt 4"
      start={new Date(2026, 10, 9, 9, 0)}
      end={new Date(2026, 10, 9, 11, 0)}
      course={null}
      compact={false}
      narrow={false}
    />,
  );

  expect(
    screen.getByRole("button", {
      name: "Übungsblatt 4, 09:00–11:00, Vorschlag",
    }),
  ).toBeTruthy();
});

test("a Study Block without those flags names no markers", () => {
  render(
    <CalendarEntry
      kind="study"
      title="Analysis II wiederholen"
      start={start}
      end={end}
      course={analysis}
      compact={false}
      narrow={false}
    />,
  );

  expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
    "Analysis II wiederholen, 10:00–12:00",
  );
});
