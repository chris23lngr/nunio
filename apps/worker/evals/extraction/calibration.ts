// Offline: apps/worker/node_modules/.bin/tsx apps/worker/evals/extraction/calibration.ts report.json checklist.md [seed]
import { readFile, writeFile } from "node:fs/promises";
import type { ExtractedTopic, Judgement, TopicLabel } from "./topics.js";
import { calibrationSample } from "./topics.js";

const [input, output, seed = "42"] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Usage: calibration.ts report.json checklist.md [seed]");
const report = JSON.parse(await readFile(input, "utf8")) as {
  documents: {
    id: string;
    run: number;
    topicJudgement: {
      labels: TopicLabel[];
      extracted: ExtractedTopic[];
      decisions: Judgement | null;
    };
  }[];
};
// Scenario results ("scenario/deck") repeat the plain decks; sampling them would crowd out the rest.
const candidates = report.documents.flatMap((document) => {
  if (document.id.includes("/")) return [];
  if (!document.topicJudgement)
    throw new Error(`${document.id}: no Topic judgements recorded`);
  const { labels, extracted, decisions } = document.topicJudgement;
  if (!decisions) return [];
  return extracted.map((topic, topicId) => {
    const labelId = decisions[topicId] ?? null;
    return {
      deck: document.id,
      run: document.run,
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
    "| Geprüft | Foliensatz / Lauf / Topic-ID | Course | Extrahiertes Topic (Schlüssel und Wert) | Bewerteter Begriff | Urteil des Gründers |",
    "| --- | --- | --- | --- | --- | --- |",
    ...sample.map(
      (item) =>
        `| ☐ | ${cell(item.deck)} / ${item.run} / ${item.topicId} | ${cell(item.topic.course)} | ${cell(`${item.topic.key}: ${item.topic.value}`)} | ${cell(item.label ? `${item.label.aliases.join(" / ")} (${item.label.course})` : `keins; zur Auswahl: ${item.courseLabels.map((label) => label.aliases[0]).join("; ") || "keine Begriffe"}`)} | |`,
    ),
    "",
  ].join("\n"),
);
