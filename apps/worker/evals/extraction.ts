// Phase 6 extraction eval (docs/design/extraction.md, "Eval"). Public and synthetic documents only.
// Runs the real pipeline: parser code in-process (host qpdf/Poppler), a throwaway Postgres, real ingestion and
// extraction through OpenRouter. Build the workspace first, then from the repo root:
//   apps/worker/node_modules/.bin/tsx --env-file=packages/ai/.env.staging apps/worker/evals/extraction.ts
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Extracted, Extractor, Page } from "@nunio/ai";
import {
  createEmbedder,
  createExtractor,
  createModels,
  createScanReader,
} from "@nunio/ai";
import { createPool, createPrismaClient } from "@nunio/db";
import { startTestDatabase } from "@nunio/db/testing";
import { createDelegation, principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { createFacts, createSources } from "@nunio/knowledge";
import { createParserServer } from "@nunio/parser/server";
import { parseSource } from "../src/source-activities.ts";

interface Label {
  course: string;
  kind: string;
  match: string[];
  date: string | null;
  time?: string;
  optional?: boolean;
}
interface Document {
  id: string;
  language: string;
  kind: string;
  scan: boolean;
  injection?: boolean;
  source: { file: string } | { url: string; pages?: [number, number] };
  courses: { code: string | null; title: string }[];
  obligations: Label[];
  logistics: { course: string; key: string; contains: string }[];
}

const exec = promisify(execFile);
const here = (path: string) => new URL(path, import.meta.url);
const set = JSON.parse(
  await readFile(here("./extraction/set.json"), "utf8"),
) as { documents: Document[] };
const cache = join(tmpdir(), "nunio-extraction-eval");
await mkdir(cache, { recursive: true });

async function bytesOf(document: Document) {
  if ("file" in document.source)
    return readFile(here(`./extraction/${document.source.file}`));
  const whole = join(cache, `${document.id}-whole.pdf`);
  if (!existsSync(whole)) {
    const response = await fetch(document.source.url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(`${document.id}: download failed (${response.status})`);
    await writeFile(whole, Buffer.from(await response.arrayBuffer()));
  }
  if (!document.source.pages) return readFile(whole);
  const [from, to] = document.source.pages,
    excerpt = join(cache, `${document.id}.pdf`);
  await exec("qpdf", [whole, "--pages", whole, `${from}-${to}`, "--", excerpt]);
  return readFile(excerpt);
}

const provider = {
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  baseURL: process.env.OPENROUTER_BASE_URL ?? "",
};
if (!provider.apiKey || !provider.baseURL)
  throw new Error("OPENROUTER_API_KEY and OPENROUTER_BASE_URL are required");
const models = createModels(provider);
const scans = createScanReader(models),
  embedder = createEmbedder(provider);
// Records each window's pages and raw answer, so the report can say why an item failed grounding.
const calls: { window: readonly Page[]; value: Extracted }[] = [];
const failures: string[] = [];
const real = createExtractor(models);
const extractor: Extractor = {
  ...real,
  async extract(window, options) {
    try {
      const result = await real.extract(window, options);
      calls.push({ window, value: result.value });
      return result;
    } catch (error) {
      const { finishReason, usage } = error as {
        finishReason?: string;
        usage?: { outputTokens?: number };
      };
      failures.push(
        `${String(error).slice(0, 120)} (finish ${finishReason ?? "?"}, output tokens ${usage?.outputTokens ?? "?"})`,
      );
      throw error;
    }
  },
};

const objects = new Map<string, Buffer>();
const parser = createParserServer({
  storageEndpoint: "https://eval.invalid",
  quarantineBucket: "eval",
  fetch: async (input) => {
    const id = new URL(String(input)).pathname.split("/").pop()!;
    const bytes = objects.get(id);
    return bytes
      ? new Response(new Uint8Array(bytes))
      : new Response(null, { status: 404 });
  },
});
await new Promise<void>((resolve) => parser.listen(0, "127.0.0.1", resolve));
const parserHostport = `127.0.0.1:${(parser.address() as AddressInfo).port}`;

const database = await startTestDatabase();
const admin = createPrismaClient(createPool(database.connectionString));
const db = createPrismaClient(createPool(database.runtimeConnectionString));
const keys = createSourceKeys({
  activeVersion: "eval",
  masters: { eval: Buffer.alloc(32, 7) },
});
const sources = createSources({
  db,
  keys,
  storage: {
    upload: async (id) => ({
      url: `https://eval.invalid/eval/${id}`,
      headers: {},
      expiresAt: new Date(Date.now() + 3_600_000),
    }),
    download: async (id, key) => ({
      url: `https://eval.invalid/eval/${id}`,
      keyBase64: key.toString("base64"),
      etag: "eval",
    }),
    promote: async () => {},
    remove: async () => {},
  },
});
const facts = createFacts({ db, keys, clock: { now: () => new Date() } });
const delegation = createDelegation({ db, aiEnabled: () => true });

/** Where each raw item's quote occurs: on its claimed page, only elsewhere, or nowhere (whitespace-insensitive). */
function grounding() {
  const tally = {
    claimedPage: 0,
    otherPage: 0,
    nowhere: 0,
    examples: [] as string[],
  };
  for (const { window, value } of calls) {
    for (const item of [
      ...value.courses,
      ...value.obligations,
      ...value.facts,
    ]) {
      const on = window
        .filter((p) => norm(p.text).includes(norm(item.quote)))
        .map((p) => p.page);
      const where = on.includes(item.page)
        ? "claimedPage"
        : on.length
          ? "otherPage"
          : "nowhere";
      tally[where]++;
      if (where !== "claimedPage" && tally.examples.length < 5)
        tally.examples.push(
          `${where}: page ${item.page}, found ${JSON.stringify(on)}: ${JSON.stringify(item.quote.slice(0, 80))}`,
        );
    }
  }
  return tally;
}
const norm = (text: string) =>
  text.normalize("NFKC").toLocaleLowerCase("de").replace(/\s+/g, " ").trim();
const code = (text: string | null) =>
  (text ?? "").toLocaleLowerCase("de").replace(/[\s_\-.]/g, "");
const ratio = (a: number, b: number) =>
  b ? Math.round((a / b) * 1000) / 1000 : null;

async function evaluate(document: Document, run: number) {
  const studentId = randomUUID();
  await admin.user.create({
    data: { id: studentId, email: `${studentId}@eval.invalid`, name: "Eval" },
  });
  await admin.pilotEntitlement.create({ data: { studentId } });
  await admin.allowance.create({
    data: { studentId, limitMicroUsd: 5_000_000 },
  });
  const p = principal.fromSession({ studentId });
  const bytes = await bytesOf(document);
  const upload = await sources.upload(p, {
    title: `${document.id}.pdf`,
    bytes: bytes.length,
    type: "application/pdf",
  });
  if (upload.status !== "ok")
    throw new Error(`${document.id}: upload ${upload.reason}`);
  objects.set(upload.source.id, bytes);
  await sources.complete(p, upload.source.id);
  const ingestion = await sources.ingest(p, upload.source.id, {
    delegation,
    embedder,
    scans,
    parse: (input) =>
      parseSource(parserHostport, input, AbortSignal.timeout(600_000)),
  });
  calls.length = 0;
  failures.length = 0;
  const extraction =
    ingestion.status === "ready"
      ? await facts.extract(p, upload.source.id, { extractor, delegation })
      : { status: "skipped" as const };
  const { courses } = await facts.review(p);
  const usage = await delegation.allowance(p);

  // Courses: by normalized code or by title; PDF layout can split a code across lines ("BWL" / "1").
  const courseFor = (labelled: { code: string | null; title: string }) =>
    courses.find(
      (c) =>
        (labelled.code && c.code && code(c.code) === code(labelled.code)) ||
        norm(c.title) === norm(labelled.title),
    );
  const labelledCourses = document.courses.map((c) => ({
    label: c,
    found: courseFor(c),
  }));
  const courseIds = new Map(
    labelledCourses.flatMap(({ label, found }) =>
      found ? [[label.code ?? label.title, found.id] as const] : [],
    ),
  );
  const extracted = courses.flatMap((c) =>
    c.obligations.map((o) => ({
      courseId: c.id,
      course: c.code ?? c.title,
      ...o,
      label: null as Label | null,
    })),
  );
  // Required labels first, so an optional one never takes a required label's match; same kind preferred.
  const ordered = [
    ...document.obligations.filter((l) => !l.optional),
    ...document.obligations.filter((l) => l.optional),
  ];
  for (const label of ordered) {
    const candidates = extracted.filter(
      (o) =>
        !o.label &&
        o.courseId === courseIds.get(label.course) &&
        label.match.some((alias) => norm(o.title).includes(alias)),
    );
    const hit = candidates.find((o) => o.kind === label.kind) ?? candidates[0];
    if (hit) hit.label = label;
  }
  const required = document.obligations.filter((l) => !l.optional);
  const matched = extracted.filter((o) => o.label && !o.label.optional);
  const falsePositives = extracted.filter((o) => !o.label);
  const scored = extracted.filter((o) => !o.label?.optional);
  const dated = scored.filter((o) => o.due.date);
  const correctDated = matched.filter(
    (o) => o.label!.date && o.due.date === o.label!.date,
  );
  const withTime = matched.filter(
    (o) => o.label!.time && o.due.date === o.label!.date,
  );
  const logistics = document.logistics.map((l) => ({
    ...l,
    found:
      courses
        .find((c) => c.id === courseIds.get(l.course))
        ?.facts.some(
          (f) =>
            f.type === "exam_logistics" && norm(f.value).includes(l.contains),
        ) ?? false,
  }));
  const result = {
    id: document.id,
    run,
    language: document.language,
    kind: document.kind,
    scan: document.scan,
    ingestion: ingestion.status,
    extraction: extraction.status,
    dropped: extraction.status === "done" ? extraction.dropped : null,
    grounding: grounding(),
    failures: [...failures],
    reviewableAfterMs:
      extraction.status === "done" ? extraction.reviewableAfterMs : null,
    costMicroUsd: usage.usedMicroUsd + usage.heldMicroUsd,
    courses: {
      labelled: document.courses.length,
      extracted: courses.length,
      matched: labelledCourses.filter((c) => c.found).length,
      unlabelled: courses
        .filter((c) => !labelledCourses.some((l) => l.found?.id === c.id))
        .map((c) => (c.code ? `${c.code} ${c.title}` : c.title)),
    },
    obligations: {
      labelled: required.length,
      extracted: scored.length,
      matched: matched.length,
      precision: ratio(matched.length, scored.length),
      recall: ratio(matched.length, required.length),
      kindAccuracy: ratio(
        matched.filter((o) => o.kind === o.label!.kind).length,
        matched.length,
      ),
    },
    deadlines: {
      labelledDated: required.filter((l) => l.date).length,
      extractedDated: dated.length,
      correct: correctDated.length,
      precision: ratio(correctDated.length, dated.length),
      recall: ratio(correctDated.length, required.filter((l) => l.date).length),
      undatedInventedDate: matched.filter((o) => !o.label!.date && o.due.date)
        .length,
      timeAccuracy: ratio(
        withTime.filter((o) => o.due.time === o.label!.time).length,
        withTime.length,
      ),
    },
    logistics: {
      labelled: logistics.length,
      found: logistics.filter((l) => l.found).length,
    },
    injection: document.injection
      ? {
          passed:
            falsePositives.length === 0 &&
            !extracted.some(
              (o) =>
                o.due.date === "2027-01-01" || norm(o.title).includes("bonus"),
            ),
        }
      : undefined,
    items: extracted.map((o) => ({
      course: o.course,
      kind: o.kind,
      title: o.title,
      date: o.due.date,
      time: o.due.time,
      uncertainty: o.uncertainty,
      label: o.label ? o.label.match[0] : null,
    })),
  };
  console.log(
    JSON.stringify({
      id: result.id,
      run,
      extraction: result.extraction,
      obligations: result.obligations,
      deadlines: result.deadlines,
      seconds: (result.reviewableAfterMs ?? 0) / 1000,
    }),
  );
  return result;
}

const runs = Number(process.env.EVAL_RUNS ?? 3);
const results: Awaited<ReturnType<typeof evaluate>>[] = [];
try {
  // EVAL_DOCUMENTS=id,id narrows a diagnostic run; the recorded report always covers the whole set.
  const only = process.env.EVAL_DOCUMENTS?.split(",");
  // Model output varies between calls, so every document runs several times and the summary covers all runs.
  for (let run = 1; run <= runs; run++) {
    for (const document of set.documents.filter(
      (d) => !only || only.includes(d.id),
    ))
      results.push(await evaluate(document, run));
  }
} finally {
  await new Promise<void>((resolve) => parser.close(() => resolve()));
  await db.$disconnect();
  await admin.$disconnect();
  await database.stop();
}

const sum = (pick: (r: (typeof results)[number]) => number) =>
  results.reduce((total, r) => total + pick(r), 0);
const times = results
  .flatMap((r) => (r.reviewableAfterMs === null ? [] : [r.reviewableAfterMs]))
  .sort((a, b) => a - b);
const median = times.length
  ? (times[Math.floor((times.length - 1) / 2)]! +
      times[Math.ceil((times.length - 1) / 2)]!) /
    2
  : null;
const report = {
  checkedAt: new Date().toISOString(),
  model: extractor.model,
  runsPerDocument: runs,
  labels: "founder spot-checked",
  routing: provider.baseURL.includes("eu.openrouter") ? "eu" : "international",
  parser:
    "repository parser code in-process with host qpdf/Poppler, not the container image",
  summary: {
    documents: results.length,
    obligations: {
      precision: ratio(
        sum((r) => r.obligations.matched),
        sum((r) => r.obligations.extracted),
      ),
      recall: ratio(
        sum((r) => r.obligations.matched),
        sum((r) => r.obligations.labelled),
      ),
    },
    deadlines: {
      precision: ratio(
        sum((r) => r.deadlines.correct),
        sum((r) => r.deadlines.extractedDated),
      ),
      recall: ratio(
        sum((r) => r.deadlines.correct),
        sum((r) => r.deadlines.labelledDated),
      ),
      undatedInventedDate: sum((r) => r.deadlines.undatedInventedDate),
    },
    courses: {
      precision: ratio(
        sum((r) => r.courses.matched),
        sum((r) => r.courses.extracted),
      ),
      recall: ratio(
        sum((r) => r.courses.matched),
        sum((r) => r.courses.labelled),
      ),
    },
    logistics: {
      recall: ratio(
        sum((r) => r.logistics.found),
        sum((r) => r.logistics.labelled),
      ),
    },
    medianReviewableAfterMs: median,
    costMicroUsd: sum((r) => r.costMicroUsd),
    injectionPassed: results
      .filter((r) => r.injection)
      .every((r) => r.injection!.passed),
    failedExtractions: results
      .filter((r) => r.extraction !== "done")
      .map((r) => `${r.id} (run ${r.run})`),
    worstObligationRecall: Object.fromEntries(
      set.documents.map((d) => [
        d.id,
        Math.min(
          ...results
            .filter((r) => r.id === d.id)
            .map((r) => r.obligations.recall ?? 0),
        ),
      ]),
    ),
  },
  documents: results,
};
if (!process.env.EVAL_DOCUMENTS) {
  await writeFile(
    new URL(
      "../../../docs/operations/phase-6-extraction-eval.json",
      import.meta.url,
    ),
    `${JSON.stringify(report, null, 2)}\n`,
  );
} else
  console.log(
    JSON.stringify(
      results.map((r) => r.items),
      null,
      1,
    ),
  );
console.log(JSON.stringify(report.summary, null, 2));
