const numbers = [
  "",
  "",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
  "zehn",
  "elf",
  "zwölf",
];

/** "eine Antwort", "zwei Antworten", "13 Antworten"; `one` is the article for a single one. */
function counted(n: number, one: string, singular: string, plural: string) {
  if (n === 1) return `${one} ${singular}`;
  return `${numbers[n] ?? n} ${plural}`;
}

/** The day's headline: how many answers nunio waits for and how many Interventions need the student. */
export function headline(answers: number, hints: number) {
  if (!answers && !hints) return "Ein ruhiger Tag. Nichts braucht dich gerade.";
  const parts = [
    answers && counted(answers, "eine", "Antwort", "Antworten"),
    hints && counted(hints, "ein", "Hinweis", "Hinweise"),
  ].filter(Boolean);
  const text = `${parts.join(" und ")} für dich.`;
  return text.charAt(0).toLocaleUpperCase("de") + text.slice(1);
}

/** Minutes as German hours, such as "1,5 Std.". */
export const hours = (minutes: number) =>
  `${(Math.round((minutes / 60) * 10) / 10).toLocaleString("de-DE")} Std.`;

const timeFormat = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "10:00". */
export const time = (value: string) => timeFormat.format(new Date(value));
/** "Mi., 2. Dez., 09:00". */
export const when = (value: string) =>
  `${dateFormat.format(new Date(value))}, ${time(value)}`;
/** "Di., 17. Nov., 10:00–11:00". */
export const span = ({ start, end }: { start: string; end: string }) =>
  `${when(start)}–${time(end)}`;
/** "2. Dez.". */
export const day = (value: string) =>
  new Date(value).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "short",
  });
