import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { GridEntry } from "./week-grid";
import { WeekGrid } from "./week-grid";

const day = (date: number, hour = 0) => new Date(2026, 10, date, hour);
const monday = day(9);
const tuesday = day(10);

const entry = (
  id: string,
  date: number,
  from: number,
  to: number,
): GridEntry => ({
  id,
  start: day(date, from),
  end: day(date, to),
  render: () => <span>{id}</span>,
});

test("each entry lands in the column of its day", () => {
  render(
    <WeekGrid
      days={[monday, tuesday]}
      fromHour={8}
      toHour={18}
      entries={[
        entry("Analysis I", 9, 10, 12),
        entry("Lineare Algebra", 10, 14, 16),
      ]}
    />,
  );

  const mondayColumn = screen.getByRole("group", {
    name: "Montag, 9. November",
  });
  const tuesdayColumn = screen.getByRole("group", {
    name: "Dienstag, 10. November",
  });
  expect(within(mondayColumn).getByText("Analysis I")).toBeTruthy();
  expect(within(mondayColumn).queryByText("Lineare Algebra")).toBeNull();
  expect(within(tuesdayColumn).getByText("Lineare Algebra")).toBeTruthy();
});

test("the time gutter labels every second hour", () => {
  render(<WeekGrid days={[monday]} fromHour={7} toHour={19} entries={[]} />);

  for (const label of ["08:00", "10:00", "12:00", "14:00", "16:00", "18:00"]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  expect(screen.queryByText("09:00")).toBeNull();
});

test("entries on days outside the grid are left out", () => {
  render(
    <WeekGrid
      days={[monday]}
      fromHour={8}
      toHour={18}
      entries={[
        entry("Analysis I", 9, 10, 12),
        entry("Lineare Algebra", 10, 14, 16),
      ]}
    />,
  );

  expect(screen.getByText("Analysis I")).toBeTruthy();
  expect(screen.queryByText("Lineare Algebra")).toBeNull();
});

test("entries render in the form their duration and lane share call for", () => {
  const formOf = (
    id: string,
    date: number,
    from: number,
    to: number,
  ): GridEntry => ({
    ...entry(id, date, from, to),
    render: ({ compact, narrow }) => (
      <span>{`${id}: ${compact ? "compact" : "full"}, ${narrow ? "narrow" : "wide"}`}</span>
    ),
  });

  render(
    <WeekGrid
      days={[monday]}
      fromHour={8}
      toHour={18}
      entries={[
        formOf("short", 9, 8, 9),
        formOf("a", 9, 11, 13),
        formOf("b", 9, 12, 14),
      ]}
    />,
  );

  expect(screen.getByText("short: compact, wide")).toBeTruthy();
  expect(screen.getByText("a: full, narrow")).toBeTruthy();
  expect(screen.getByText("b: full, narrow")).toBeTruthy();
});

test("an entry is placed from its time with a 4px inset", () => {
  render(
    <WeekGrid
      days={[monday]}
      fromHour={8}
      toHour={18}
      entries={[entry("Analysis I", 9, 10, 12)]}
    />,
  );

  const card = screen.getByText("Analysis I").parentElement as HTMLElement;
  expect(card.style.top).toBe("68px");
  expect(card.style.height).toBe("56px");
});

test("background nodes such as Protected Time render in their day", () => {
  render(
    <WeekGrid
      days={[monday, tuesday]}
      fromHour={8}
      toHour={18}
      entries={[]}
      background={[
        {
          id: "p",
          start: day(10, 12),
          end: day(10, 13),
          node: <span>Geschützte Zeit</span>,
        },
      ]}
    />,
  );

  const tuesdayColumn = screen.getByRole("group", {
    name: "Dienstag, 10. November",
  });
  const mondayColumn = screen.getByRole("group", {
    name: "Montag, 9. November",
  });
  expect(within(tuesdayColumn).getByText("Geschützte Zeit")).toBeTruthy();
  expect(within(mondayColumn).queryByText("Geschützte Zeit")).toBeNull();
});

test("the optional header sits above each day", () => {
  render(
    <WeekGrid
      days={[monday, tuesday]}
      fromHour={8}
      toHour={18}
      entries={[]}
      header={(d) => <span>{`Kopf ${d.getDate()}`}</span>}
    />,
  );

  expect(screen.getByText("Kopf 9")).toBeTruthy();
  expect(screen.getByText("Kopf 10")).toBeTruthy();
});
