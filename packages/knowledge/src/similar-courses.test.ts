import { expect, it } from "vitest";
import { similarCourses } from "./similar-courses.js";

const course = (title: string, code: string | null = null) => ({
  title,
  code,
});

it.each([
  ["MA-101", "ma 101"],
  ["INF 1.2", "inf12"],
  ["BWL–01", "bwl01"],
])(
  "takes Courses whose codes %s and %s differ only in case, spaces and punctuation as alike",
  (a, b) => {
    expect(similarCourses(course("Analysis", a), course("Mathe", b))).toBe(
      true,
    );
  },
);

it.each([
  ["Analysis I", "Analysis 1"],
  ["Analysis I", "Analysis"],
  ["Einführung in die Programmierung", "Einfuehrung in die Programmierung"],
  ["Grundlagen der Informatik", "Grundlagen der Informatik (Vorlesung)"],
  ["Theoretische Informatik", "Theoretische Informatik – Übung"],
  ["Software Engineering", "Software-Engineering"],
])("takes %s and %s as alike by their titles", (a, b) => {
  expect(similarCourses(course(a), course(b))).toBe(true);
});

it.each([
  ["Lineare Algebra", "Analysis I"],
  ["Einführung in die Informatik", "Einführung in die Programmierung"],
  ["Datenbanksysteme", "Datenbanken"],
  ["Analysis für Informatiker", "Analysis"],
  ["Analysis I", "Analysis II"],
  ["Mathematik für Informatiker 1", "Mathematik für Informatiker 2"],
])("keeps %s and %s apart", (a, b) => {
  expect(similarCourses(course(a), course(b))).toBe(false);
});
