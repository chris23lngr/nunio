// Offline: apps/worker/node_modules/.bin/tsx apps/worker/evals/extraction/calibration.ts report.json checklist.md [seed]
import { readFile, writeFile } from "node:fs/promises";
import type { ExtractedTopic, Judgement, TopicLabel } from "./topics.js";
import { calibrationSample } from "./topics.js";

const [input, output, seed = "42"] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Usage: calibration.ts report.json checklist.md [seed]");
const report = JSON.parse(await readFile(input, "utf8")) as {
  courses: {
    id: string;
    run: number;
    topicJudgement: {
      labels: TopicLabel[];
      extracted: ExtractedTopic[];
      decisions: Judgement | null;
    };
  }[];
};
// `deck` is the stratum calibrationSample alternates over: here, the Topic Course.
const candidates = report.courses.flatMap((course) => {
  const { labels, extracted, decisions } = course.topicJudgement;
  if (!decisions) return [];
  return extracted.map((topic, topicId) => {
    const labelId = decisions[topicId] ?? null;
    return {
      deck: course.id,
      run: course.run,
      topicId,
      topic,
      labelId,
      label: labelId === null ? null : labels[labelId],
      courseLabels: labels.filter((label) => label.course === topic.course),
    };
  });
});
const sample = calibrationSample(candidates, 50, Number(seed));
const cell = (text: string) =>
  text.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
await writeFile(
  output,
  [
    "# Kalibrierung der Topic-Bewertung",
    "",
    `Stichprobe: ${sample.length} Entscheidungen; Seed: ${seed}.`,
    "",
    "Bitte abhaken und Urteil eintragen: stimmt / falsch; bei Bedarf den richtigen Begriff ergänzen.",
    "",
    "| Geprüft | Kurs / Lauf / Topic-ID | Course | Extrahiertes Topic (Schlüssel und Wert) | Bewerteter Begriff | Urteil des Gründers |",
    "| --- | --- | --- | --- | --- | --- |",
    ...sample.map(
      (item) =>
        `| ☐ | ${cell(item.deck)} / ${item.run} / ${item.topicId} | ${cell(item.topic.course)} | ${cell(`${item.topic.key}: ${item.topic.value}`)} | ${cell(item.label ? `${item.label.aliases.join(" / ")} (${item.label.course})` : `keins; zur Auswahl: ${item.courseLabels.map((label) => label.aliases[0]).join("; ") || "keine Begriffe"}`)} | |`,
    ),
    "",
  ].join("\n"),
);
