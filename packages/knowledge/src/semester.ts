/** A Semester's key: its starting year and "ws" (Wintersemester, October to March) or "ss" (Sommersemester). */
export type Semester = `${number}-${"ws" | "ss"}`;

const berlin = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "numeric",
});

/** The Semester running at an instant; Semesters switch at midnight Berlin time. */
export function semesterAt(instant: Date): Semester {
  const parts = berlin.formatToParts(instant);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  if (month >= 10) return `${year}-ws`;
  if (month <= 3) return `${year - 1}-ws`;
  return `${year}-ss`;
}

const step = (semester: Semester, by: number): Semester => {
  const [year, season] = semester.split("-") as [string, "ws" | "ss"];
  // Count in half-years: a year's Sommersemester comes before its Wintersemester.
  const index = Number(year) * 2 + (season === "ws" ? 1 : 0) + by;
  return `${Math.floor(index / 2)}-${index % 2 ? "ws" : "ss"}`;
};

/** The Semesters a student can give a Course: four years back through the next one, newest first. */
export function semesterChoices(now: Date): Semester[] {
  const current = semesterAt(now);
  return Array.from({ length: 10 }, (_, i) => step(current, 1 - i));
}
