import { expect, test } from "vitest";
import { chatAge } from "./chat-age";

/** `day` November 2026 (or another `month`, 0-based) at `hour`:`minute`, in whatever zone the tests run. */
const at = (day: number, hour: number, minute = 0, month = 10, year = 2026) =>
  new Date(year, month, day, hour, minute);
const now = at(14, 12);
const ago = (date: Date) => chatAge(date, now, "short");

test("a Chat from days ago shows how many days, short in the menu", () => {
  expect(ago(at(11, 9))).toBe("3 Tage");
});

test("from a week on it counts weeks, until a whole month has passed", () => {
  expect(ago(at(7, 12))).toBe("1 Woche");
  expect(ago(at(15, 12, 0, 9))).toBe("4 Wochen");
});

test("from a whole month on it counts months, then years", () => {
  expect(ago(at(10, 12, 0, 8))).toBe("2 Monate");
  expect(ago(at(1, 12, 0, 10, 2025))).toBe("1 Jahr");
});

test("earlier today it counts hours, then minutes, then shows it as just now", () => {
  expect(ago(at(14, 8))).toBe("4 Stunden");
  expect(ago(at(14, 11, 55))).toBe("5 Minuten");
  expect(chatAge(new Date(now.getTime() - 30_000), now, "short")).toBe("Jetzt");
});

test("yesterday counts as a day, even less than a day ago", () => {
  expect(chatAge(at(13, 23), at(14, 8), "short")).toBe("1 Tag");
  expect(chatAge(at(8, 23), at(14, 8), "short")).toBe("6 Tage");
});

test("the full list says how long ago, in the same units", () => {
  const long = (date: Date) => chatAge(date, now, "long");
  expect(long(at(11, 9))).toBe("Vor 3 Tagen");
  expect(long(at(7, 12))).toBe("Vor 1 Woche");
  expect(long(at(10, 12, 0, 8))).toBe("Vor 2 Monaten");
  expect(long(at(14, 8))).toBe("Vor 4 Stunden");
  expect(long(new Date(now.getTime() - 30_000))).toBe("Gerade eben");
});
