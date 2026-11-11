// Synthetic scanned German page; run from repo root after building ai and parser.
// node --env-file=packages/ai/.env.staging packages/ai/evals/source-scan.ts

import { readFile, writeFile } from "node:fs/promises";
import { createModels, createScanReader } from "../dist/index.js";

// Synthetic fixture rendered by Poppler: "Prüfung am 12. März um 9 Uhr in Raum H1."
const image = await readFile(
  new URL("./fixtures/german-scan.jpg", import.meta.url),
);
const reader = createScanReader(
  createModels({
    apiKey: process.env.OPENROUTER_API_KEY!,
    baseURL: process.env.OPENROUTER_BASE_URL!,
  }),
);
const estimate = reader.estimateMicroUsd(image, "");
const result = await reader.read(image, {
  text: "",
  signal: AbortSignal.timeout(120_000),
});
const checks = {
  checkedAt: new Date().toISOString(),
  synthetic: true,
  model: "anthropic/claude-haiku-5.5",
  text: result.text,
  estimateMicroUsd: estimate,
  actualMicroUsd: result.usage.microUsd,
  datesAndRoom: result.text.includes("12.") && result.text.includes("H1"),
  germanCharacters:
    result.text.includes("Prüfung") && result.text.includes("März"),
  withinEstimate: result.usage.microUsd <= estimate,
};
await writeFile(
  new URL("../../../docs/operations/phase-5-scan-eval.json", import.meta.url),
  JSON.stringify(checks, null, 2) + "\n",
);
console.log(checks);
if (!checks.datesAndRoom || !checks.germanCharacters || !checks.withinEstimate)
  process.exitCode = 1;
