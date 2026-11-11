import { expect, test } from "vitest";
import { nextWeek, previousWeek, weekDays, weekLabel } from "./plan-week";

test("a week within one month is labelled with its ISO week number and day range", () => {
  expect(weekLabel(new Date(2026, 10, 11))).toBe("KW46, 9.–15. Nov");
});

test("a week crossing a month names both months: 'KW49, 30. Nov – 6. Dez'", () => {
  expect(weekLabel(new Date(2026, 11, 3))).toBe("KW49, 30. Nov – 6. Dez");
});

test("a week crossing a year names both years, numbered by the ISO week: 'KW53, 28. Dez 2026 – 3. Jan 2027'", () => {
  expect(weekLabel(new Date(2027, 0, 1))).toBe(
    "KW53, 28. Dez 2026 – 3. Jan 2027",
  );
});

test("the week's days run Monday to Sunday, at the start of each day", () => {
  expect(weekDays(new Date(2026, 10, 11, 15, 30))).toEqual([
    new Date(2026, 10, 9),
    new Date(2026, 10, 10),
    new Date(2026, 10, 11),
    new Date(2026, 10, 12),
    new Date(2026, 10, 13),
    new Date(2026, 10, 14),
    new Date(2026, 10, 15),
  ]);
});

test("a Sunday belongs to the week that started the Monday before", () => {
  expect(weekDays(new Date(2026, 10, 15))[0]).toEqual(new Date(2026, 10, 9));
});

test("previous and next week move by seven days, across the year change", () => {
  expect(previousWeek(new Date(2027, 0, 1))).toEqual(new Date(2026, 11, 25));
  expect(nextWeek(new Date(2026, 11, 31))).toEqual(new Date(2027, 0, 7));
});
