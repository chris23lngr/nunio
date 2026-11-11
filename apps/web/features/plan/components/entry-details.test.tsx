import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { expect, test, vi } from "vitest";
import { EntryDetails } from "./entry-details";

const props: ComponentProps<typeof EntryDetails> = {
  course: { title: "Statistics II", color: "blue" },
  title: "Klausurvorbereitung",
  placedBy: "nunio",
  start: new Date(2026, 10, 13, 9, 0),
  end: new Date(2026, 10, 13, 11, 0),
  obligation: { title: "Klausur Statistics II", due: new Date(2026, 10, 18) },
  today: new Date(2026, 10, 11),
  estimate: {
    plannedMinutes: 8 * 60,
    estimatedMinutes: 20 * 60,
    rationale: "Drei Altklausuren und zwei Übungsblätter.",
  },
  locked: false,
  onLockChange: vi.fn(),
  onMove: vi.fn(),
  onDelete: vi.fn(),
};

test("the header names the Course and the Study Block and who placed it", () => {
  const { rerender } = render(<EntryDetails {...props} />);

  expect(screen.getByText("Statistics II")).toBeTruthy();
  expect(screen.getByText("Klausurvorbereitung")).toBeTruthy();
  expect(screen.getByText("Lernblock, von nunio geplant")).toBeTruthy();

  rerender(<EntryDetails {...props} placedBy="student" />);
  expect(screen.getByText("Lernblock, von dir gesetzt")).toBeTruthy();
});

test("the details give the day, the time and how long the Study Block lasts", () => {
  render(<EntryDetails {...props} />);

  expect(screen.getByText("Freitag, 13.11.")).toBeTruthy();
  expect(screen.getByText("09:00 – 11:00 Uhr · 2 h")).toBeTruthy();
});

test("the Obligation it works toward shows when it is due, counted from today", () => {
  const { rerender } = render(<EntryDetails {...props} />);

  expect(screen.getByText("Klausur Statistics II")).toBeTruthy();
  expect(screen.getByText("Fällig Mittwoch, 18.11. · in 7 Tagen")).toBeTruthy();

  rerender(
    <EntryDetails
      {...props}
      obligation={{ title: "Blatt 3", due: new Date(2026, 10, 12, 12, 0) }}
    />,
  );
  expect(screen.getByText("Fällig Donnerstag, 12.11. · morgen")).toBeTruthy();

  rerender(
    <EntryDetails
      {...props}
      obligation={{ title: "Blatt 3", due: new Date(2026, 10, 11, 23, 59) }}
    />,
  );
  expect(screen.getByText("Fällig Mittwoch, 11.11. · heute")).toBeTruthy();
});

test("an Obligation already past its due date says how long ago it was due", () => {
  const { rerender } = render(
    <EntryDetails
      {...props}
      obligation={{ title: "Blatt 2", due: new Date(2026, 10, 10, 12, 0) }}
    />,
  );
  expect(screen.getByText("Fällig Dienstag, 10.11. · gestern")).toBeTruthy();

  rerender(
    <EntryDetails
      {...props}
      obligation={{ title: "Blatt 2", due: new Date(2026, 10, 8, 12, 0) }}
    />,
  );
  expect(screen.getByText("Fällig Sonntag, 08.11. · vor 3 Tagen")).toBeTruthy();
});

test("the Estimate shows how much of it is planned, as text, percent and bar", () => {
  render(<EntryDetails {...props} />);

  expect(screen.getByText("8 von 20 h eingeplant")).toBeTruthy();
  expect(screen.getByText("40 %")).toBeTruthy();
  const bar = screen.getByRole("progressbar");
  expect(bar.getAttribute("aria-valuenow")).toBe("480");
  expect(bar.getAttribute("aria-valuemax")).toBe("1200");
  expect(
    screen.getByText("Drei Altklausuren und zwei Übungsblätter."),
  ).toBeTruthy();
});

test("without a Course, Obligation, Estimate or rationale those parts are left out", () => {
  const { rerender } = render(
    <EntryDetails {...props} course={null} obligation={null} estimate={null} />,
  );

  expect(screen.getByText("Klausurvorbereitung")).toBeTruthy();
  expect(screen.queryByText("Statistics II")).toBeNull();
  expect(screen.queryByText(/Fällig/)).toBeNull();
  expect(screen.queryByText(/eingeplant/)).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();

  rerender(
    <EntryDetails
      {...props}
      estimate={{ plannedMinutes: 60, estimatedMinutes: 240, rationale: null }}
    />,
  );
  expect(screen.getByText("1 von 4 h eingeplant")).toBeTruthy();
  expect(screen.getByText("25 %")).toBeTruthy();
  expect(
    screen.queryByText("Drei Altklausuren und zwei Übungsblätter."),
  ).toBeNull();
});

test("Sperren locks the Study Block, and once locked Entsperren unlocks it", async () => {
  const user = userEvent.setup();
  const onLockChange = vi.fn();
  const { rerender } = render(
    <EntryDetails {...props} onLockChange={onLockChange} />,
  );

  expect(screen.queryByRole("button", { name: "Entsperren" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Sperren" }));
  expect(onLockChange).toHaveBeenLastCalledWith(true);

  rerender(<EntryDetails {...props} locked onLockChange={onLockChange} />);
  expect(screen.queryByRole("button", { name: "Sperren" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Entsperren" }));
  expect(onLockChange).toHaveBeenLastCalledWith(false);
});

test("Verschieben and Löschen hand the Study Block to the page", async () => {
  const user = userEvent.setup();
  const onMove = vi.fn();
  const onDelete = vi.fn();
  render(<EntryDetails {...props} onMove={onMove} onDelete={onDelete} />);

  await user.click(screen.getByRole("button", { name: "Verschieben" }));
  expect(onMove).toHaveBeenCalledTimes(1);
  expect(onDelete).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Löschen" }));
  expect(onDelete).toHaveBeenCalledTimes(1);
});
