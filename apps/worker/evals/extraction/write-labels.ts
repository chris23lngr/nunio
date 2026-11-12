// Copies founder Topic labels from labels/<deck-id>.md into set.json; files without rows are skipped.
//   apps/worker/node_modules/.bin/tsx apps/worker/evals/extraction/write-labels.ts
import { execFile } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parseTopicLabels } from "./labels.js";

const here = (path: string) => new URL(path, import.meta.url);
const set = JSON.parse(await readFile(here("./set.json"), "utf8")) as {
  documents: {
    id: string;
    courses: { title: string }[];
    topics?: unknown;
    labelsStatus?: string;
  }[];
};
for (const name of await readdir(here("./labels/"))) {
  if (!name.endsWith(".md") || name === "LEITFADEN.md") continue;
  const id = name.slice(0, -".md".length);
  const text = await readFile(here(`./labels/${name}`), "utf8");
  let topics: ReturnType<typeof parseTopicLabels>;
  try {
    topics = parseTopicLabels(text);
  } catch (error) {
    throw new Error(`${name}: ${(error as Error).message}`);
  }
  const document = set.documents.find((d) => d.id === id);
  if (!document) throw new Error(`${name}: no document "${id}" in set.json`);
  // Checked before skipping empty templates, so a wrong Kurs line shows up before labelling starts.
  const course = text
    .split("\n")
    .find((line) => line.startsWith("Kurs:"))!
    .slice("Kurs:".length)
    .trim();
  if (!document.courses.some((c) => c.title === course))
    throw new Error(`${name}: Kurs is not a Course of "${id}"`);
  if (!topics.length) continue;
  document.topics = topics;
  document.labelsStatus = "Topic labels written blind by founder";
  console.log(`${id}: ${topics.length} Topic labels`);
}
// One line, then Biome expands only what overflows, so unchanged entries keep their layout.
// Biome also aligns the label tables.
const path = fileURLToPath(here("./set.json"));
await writeFile(path, `${JSON.stringify(set)}\n`);
await promisify(execFile)("bunx", [
  "biome",
  "format",
  "--write",
  path,
  fileURLToPath(here("./labels/")),
]);
