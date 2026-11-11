import { expect, test } from "vitest";
import { assignLanes, displayForm, entryGeometry } from "./entry-layout";

const at = (hour: number, minute = 0) => new Date(2026, 10, 9, hour, minute);
const entry = (id: string, from: number, to: number) => ({
  id,
  start: at(from),
  end: at(to),
});
const lanesOf = (entries: ReturnType<typeof entry>[]) =>
  assignLanes(entries).map(({ id, lane, lanes }) => ({ id, lane, lanes }));

test("a 10:00–12:00 entry on an 08:00 grid sits 64px down and is 64px tall", () => {
  expect(entryGeometry(8, at(10), at(12))).toEqual({ top: 64, height: 64 });
});

test("two entries at the same time share the column in two lanes", () => {
  expect(lanesOf([entry("a", 10, 12), entry("b", 10, 12)])).toEqual([
    { id: "a", lane: 0, lanes: 2 },
    { id: "b", lane: 1, lanes: 2 },
  ]);
});

test("partly overlapping entries split into two lanes but keep their own position", () => {
  const late = entry("late", 12, 14);
  const early = entry("early", 11, 13);

  expect(lanesOf([late, early])).toEqual([
    { id: "early", lane: 0, lanes: 2 },
    { id: "late", lane: 1, lanes: 2 },
  ]);
  expect(entryGeometry(8, early.start, early.end)).toEqual({
    top: 96,
    height: 64,
  });
  expect(entryGeometry(8, late.start, late.end)).toEqual({
    top: 128,
    height: 64,
  });
});

test("separate and touching entries each get the full column", () => {
  expect(
    lanesOf([entry("a", 10, 11), entry("b", 11, 12), entry("c", 14, 15)]),
  ).toEqual([
    { id: "a", lane: 0, lanes: 1 },
    { id: "b", lane: 0, lanes: 1 },
    { id: "c", lane: 0, lanes: 1 },
  ]);
});

test("entries shorter than two hours are compact, shared lanes are narrow", () => {
  expect(displayForm(at(10), at(11, 30), 1)).toEqual({
    compact: true,
    narrow: false,
  });
  expect(displayForm(at(10), at(12), 1)).toEqual({
    compact: false,
    narrow: false,
  });
  expect(displayForm(at(10), at(12), 2)).toEqual({
    compact: false,
    narrow: true,
  });
});
