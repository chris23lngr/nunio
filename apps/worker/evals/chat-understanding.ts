// Phase 15 Understanding and Plan eval (ADR-0021). A synthetic student with known Understanding Levels, an exam with a
// Shortfall, a ready practice set they have not opened, and a Study Block. Each question runs in a fresh Chat through
// the real tool loop. Automatic checks record whether the model read the tool its answer needs, whether practice it
// starts is on weak Topics only, whether it starts none where a ready set exists, and whether it proposes a removal
// when asked; the answers are kept for the founder's spot-check. Build the workspace first, then from the repo root:
//   apps/worker/node_modules/.bin/tsx --env-file=packages/ai/.env.staging apps/worker/evals/chat-understanding.ts
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { Extracted, Grader, Maker } from "@nunio/ai";
import {
  createAnswerer,
  createEmbedder,
  createModels,
  fetchZeroRetentionPrices,
} from "@nunio/ai";
import type { ArtifactRequest } from "@nunio/artifacts";
import { createArtifacts } from "@nunio/artifacts";
import { createChats } from "@nunio/chat";
import { createPool, createPrismaClient } from "@nunio/db";
import { startTestDatabase } from "@nunio/db/testing";
import {
  createDelegation,
  createResponsibilities,
  principal,
} from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import {
  createFacts,
  createKnowledgeReader,
  createSources,
} from "@nunio/knowledge";
import { createPlan, deadline } from "@nunio/planning";
import { createUnderstanding } from "@nunio/understanding";

const pages = [
  [
    "INF-230 Datenbanksysteme",
    "Wintersemester 2026/27",
    "Themen: relationales Modell, SQL, Normalformen, Transaktionen.",
  ].join("\n"),
  [
    "Kapitel 3: Normalformen",
    "Die dritte Normalform verlangt, dass kein Nichtschlüsselattribut transitiv von einem Schlüssel abhängt.",
  ].join("\n"),
];
const topics = ["Relationales Modell", "SQL", "Normalformen", "Transaktionen"];
/** What the fixture makes of each Topic (ADR-0002): two correct Attempts are solid, one wrong is shaky. */
const expected = {
  "Relationales Modell": "not_yet_practiced",
  SQL: "solid",
  Normalformen: "shaky",
  Transaktionen: "disputed",
} as const;
const weak = new Set(["Normalformen", "Transaktionen"]);

type Check = {
  text: string;
  /** Tools the answer needs to have read in this turn. */
  reads: ("courseFacts" | "agenda")[];
  /** Practice it starts must be on these Topics only. */
  startsOnlyOn?: Set<string>;
  /** A ready, unopened practice set covers this request, so nothing should start. */
  startsNothing?: true;
  /** The student asked to remove their block, so a removal should be proposed. */
  proposesRemoval?: true;
};
const questions: Check[] = [
  { text: "Wo stehe ich in Datenbanksysteme?", reads: ["courseFacts"] },
  {
    text: "Welche Themen beherrsche ich schon sicher?",
    reads: ["courseFacts"],
  },
  {
    text: "Bin ich beim relationalen Modell schwach?",
    reads: ["courseFacts"],
  },
  {
    text: "Mach mir ein Practice Set zu meinen schwachen Themen.",
    reads: ["courseFacts"],
    startsOnlyOn: weak,
  },
  {
    text: "Erstelle mir ein Practice Set zu Normalformen.",
    reads: ["courseFacts"],
    startsNothing: true,
  },
  { text: "Schaffe ich die Klausur?", reads: ["agenda"] },
  { text: "Wie viel Zeit fehlt mir noch bis zur Klausur?", reads: ["agenda"] },
  {
    text: "Was kann ich tun, damit ich die Klausur noch schaffe?",
    reads: ["agenda"],
  },
  {
    text: "Plane mir Zeit für meine schwachen Themen ein.",
    reads: ["courseFacts", "agenda"],
  },
  {
    text: "Lösch meinen Lernblock übermorgen, den brauche ich nicht.",
    reads: ["agenda"],
    proposesRemoval: true,
  },
];

const provider = {
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  baseURL: process.env.OPENROUTER_BASE_URL ?? "",
};
if (!provider.apiKey || !provider.baseURL)
  throw new Error("OPENROUTER_API_KEY and OPENROUTER_BASE_URL are required");
const chatModel = {
  key: "sonnet-5.5-reasoning-high",
  providerModelId: "anthropic/claude-sonnet-5.5",
  reasoningEffort: "high" as const,
  maxOutputTokens: 8_000,
};
const priced = (
  await fetchZeroRetentionPrices({
    baseURL: provider.baseURL,
    only: new Set([chatModel.providerModelId]),
  })
).get(chatModel.providerModelId);
if (!priced) throw new Error("Sonnet has no zero-retention endpoint");
const catalog = [
  { ...chatModel, prices: priced.prices, upstream: priced.upstream },
];
const answerer = createAnswerer(
  createModels({ ...provider, catalog }).fromConfig(catalog[0]!),
);

const database = await startTestDatabase();
const admin = createPrismaClient(createPool(database.connectionString));
const db = createPrismaClient(createPool(database.runtimeConnectionString));
const clock = { now: () => new Date() };
const keys = createSourceKeys({
  activeVersion: "eval",
  masters: { eval: Buffer.alloc(32, 9) },
});
const delegation = createDelegation({ db, aiEnabled: () => true });
const embedder = createEmbedder(provider);
const facts = createFacts({ db, keys, clock });
const plan = createPlan({ db, facts, clock });
const reader = createKnowledgeReader({ db, keys, embedder, delegation, clock });
const sources = createSources({
  db,
  keys,
  storage: {
    upload: async (id) => ({
      url: `https://eval.invalid/${id}`,
      headers: {},
      expiresAt: new Date(Date.now() + 3_600_000),
    }),
    download: async (id, key) => ({
      url: `https://eval.invalid/${id}`,
      keyBase64: key.toString("base64"),
      etag: "eval",
    }),
    promote: async () => {},
    remove: async () => {},
  },
});
/** Makes the fixture's practice sets without a model, so they cost nothing. */
const maker: Maker = {
  estimateMicroUsd: () => 1,
  practiceSet: async (input) => ({
    value: {
      items: input.topics.map((topic, i) => ({
        id: String(i + 1),
        topicIds: [topic.id],
        question: `Was gehört zu ${topic.name}? [S1]`,
        answer: "Siehe Skript [S1].",
        cited: ["S1"],
      })),
    },
    usage: { microUsd: 1 },
  }),
  flashcards: async () => ({ value: { cards: [] }, usage: { microUsd: 1 } }),
  draft: async () => ({
    value: { text: "", cited: [] },
    usage: { microUsd: 1 },
  }),
  critique: async () => ({
    value: { text: "", cited: [] },
    usage: { microUsd: 1 },
  }),
};
const responsibilities = createResponsibilities({
  db,
  schedules: {
    create: async () => {},
    pause: async () => {},
    unpause: async () => {},
    delete: async () => {},
  },
  clock,
});
const artifacts = createArtifacts({
  db,
  keys,
  reader,
  facts,
  responsibilities,
  delegation,
  maker,
  clock,
});
/** Practice the Chat asked to start; none is made, so the eval spends nothing on it. */
const requested: ArtifactRequest[] = [];
const chats = createChats({
  db,
  keys,
  reader,
  delegation,
  plan,
  clock,
  artifacts: {
    request: async (_p, req) => {
      requested.push(req);
      return { status: "refused", reason: "gone" };
    },
    list: (...args) => artifacts.list(...args),
  },
  // Levels read only Attempts and Self-assessments, so grading is never asked for.
  understanding: createUnderstanding({
    db,
    keys,
    artifacts,
    reader,
    facts,
    delegation,
    grader: {} as Grader,
    clock,
  }),
  startArtifactRun: async () => {},
});

const berlinDay = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Europe/Berlin",
  });

/**
 * A student whose exam in four days needs 40 hours, more than fit before it; whose Levels are as `expected`; who has a
 * practice set on Normalformen ready and unopened; and who has a Study Block the day after tomorrow.
 */
async function student() {
  const studentId = randomUUID();
  await admin.user.create({
    data: { id: studentId, email: `${studentId}@eval.invalid`, name: "Eval" },
  });
  await admin.pilotEntitlement.create({ data: { studentId } });
  await admin.allowance.create({
    data: { studentId, limitMicroUsd: 5_000_000 },
  });
  const p = principal.fromSession({ studentId });
  const upload = await sources.upload(p, {
    title: "INF-230 Skript.pdf",
    bytes: 100,
    type: "application/pdf",
  });
  if (upload.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, upload.source.id);
  const ingested = await sources.ingest(p, upload.source.id, {
    delegation,
    embedder,
    parse: async () => ({
      pages: pages.map((text, i) => ({ page: i + 1, text })),
    }),
    scans: {
      estimateMicroUsd: () => 1,
      read: async () => ({ text: "", usage: { microUsd: 1 } }),
    },
  });
  if (ingested.status !== "ready") throw new Error(ingested.status);
  const exam = berlinDay(4);
  await facts.extract(p, upload.source.id, {
    delegation,
    extractor: {
      model: "eval",
      windows: (all) => [[...all]],
      estimateMicroUsd: () => 1,
      extract: async () => ({
        usage: { microUsd: 1 },
        value: {
          courses: [
            {
              code: "INF-230",
              title: "Datenbanksysteme",
              page: 1,
              quote: "INF-230 Datenbanksysteme",
            },
          ],
          obligations: [
            {
              course: "INF-230",
              kind: "exam",
              title: "Klausur",
              key: "Klausur",
              destination: null,
              due: {
                date: exam,
                time: "14:00",
                timeZone: "Europe/Berlin",
                text: `${exam}, 14:00 Uhr`,
              },
              page: 1,
              quote: "INF-230 Datenbanksysteme",
              uncertainty: null,
            },
          ],
          facts: topics.map((name): Extracted["facts"][number] => ({
            course: "INF-230",
            type: "topic",
            key: name,
            value: name,
            page: 1,
            quote:
              "Themen: relationales Modell, SQL, Normalformen, Transaktionen.",
            uncertainty: null,
          })),
        },
      }),
    },
  });
  const course = (await facts.review(p)).courses[0]!;
  await facts.decideCourse(p, course.id, "accept");
  const examId = course.obligations[0]!.id;
  const topicId = new Map(
    course.facts
      .filter((fact) => fact.type === "topic")
      .map((fact) => [fact.value, fact.id]),
  );
  const id = (name: string) => topicId.get(name)!;
  await plan.estimate(p, { kind: "obligation", id: examId }, 40 * 60);
  const day = berlinDay(2);
  await plan.placeBlock(p, {
    work: { kind: "obligation", id: examId },
    start: deadline(day, "10:00", "Europe/Berlin"),
    end: deadline(day, "12:00", "Europe/Berlin"),
  });

  const from = { selection: { courseIds: [course.id], sourceIds: [] } };
  const made = async (names: string[]) => {
    const started = await artifacts.request(p, {
      kind: "practice_set",
      topicIds: names.map(id),
      from,
    });
    if (started.status !== "started") throw new Error(started.reason);
    if ((await artifacts.make(started.runId)) !== "ready")
      throw new Error("practice set not made");
    return started.artifactId;
  };
  // An earlier set the student opened and practised with, then a new one on Normalformen they have not opened yet.
  const practised = await made(["SQL", "Normalformen", "Transaktionen"]);
  await artifacts.open(p, practised);
  await made(["Normalformen"]);
  const attempt = (name: string, verdict: string) =>
    admin.practiceAttempt.create({
      data: {
        id: randomUUID(),
        studentId,
        artifactId: practised,
        itemId: "1",
        topicIds: [id(name)],
        text: "Meine Antwort.",
        verdict,
        derivedFrom: [],
        gradedAt: new Date(),
      },
    });
  await attempt("SQL", "correct");
  await attempt("SQL", "correct");
  await attempt("Normalformen", "incorrect");
  await attempt("Transaktionen", "partial");
  await admin.selfAssessment.create({
    data: {
      id: randomUUID(),
      studentId,
      topicId: id("Transaktionen"),
      level: "solid",
    },
  });
  const levels = await createUnderstanding({
    db,
    keys,
    artifacts,
    reader,
    facts,
    delegation,
    grader: {} as Grader,
    clock,
  }).levels(p, { courseId: course.id });
  for (const name of topics) {
    const level = levels.find((l) => l.topicId === id(name))?.level;
    if (level !== expected[name as keyof typeof expected])
      throw new Error(`fixture: ${name} is ${level}`);
  }
  if (!(await plan.view(p)).proposal.shortfalls.length)
    throw new Error("fixture: the exam has no Shortfall");
  return {
    p,
    courseId: course.id,
    nameOf: new Map([...topicId].map(([n, t]) => [t, n])),
  };
}

const used = async (p: ReturnType<typeof principal.fromSession>) =>
  (await delegation.allowance(p)).usedMicroUsd;

/** Asks in a fresh Chat over the Course, then checks what the answer read, started and proposed. */
async function ask(check: Check) {
  const { p, courseId, nameOf } = await student();
  const chat = await chats.create(p, { courseIds: [courseId], sourceIds: [] });
  if (chat.status !== "ok") throw new Error(chat.status);
  const before = await used(p);
  const starts = requested.length;
  const result = await chats
    .ask(p, chat.id, check.text, answerer)
    .catch((error: unknown) => ({
      status: "failed" as const,
      error: String(error),
    }));
  const costMicroUsd = (await used(p)) - before;
  if (result.status !== "ok")
    return {
      question: check.text,
      error: "error" in result ? result.error : JSON.stringify(result),
      costMicroUsd,
    };
  const parts = result.message.parts;
  const read = new Set(
    parts.flatMap((part) =>
      part.type === "tool-courseFacts"
        ? ["courseFacts"]
        : part.type === "tool-agenda"
          ? ["agenda"]
          : [],
    ),
  );
  const startedOn = requested
    .slice(starts)
    .flatMap((req) => ("topicIds" in req ? req.topicIds : []))
    .map((topic) => nameOf.get(topic) ?? topic);
  const removals = parts.filter(
    (part) => part.type === "tool-proposeStudyBlockRemove",
  ).length;
  const passed = {
    read: check.reads.every((tool) => read.has(tool)),
    ...(check.startsOnlyOn && {
      startsOnlyOnWeak:
        startedOn.length > 0 &&
        startedOn.every((name) => check.startsOnlyOn!.has(name)),
    }),
    ...(check.startsNothing && { startsNothing: startedOn.length === 0 }),
    ...(check.proposesRemoval && { proposesRemoval: removals > 0 }),
  };
  return {
    question: check.text,
    read: [...read],
    startedOn,
    proposals: parts.filter((part) => "approvalId" in part).length,
    removals,
    passed,
    answer: result.message.text,
    costMicroUsd,
  };
}

const results: Awaited<ReturnType<typeof ask>>[] = [];
try {
  for (const check of questions) {
    results.push(await ask(check));
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  await db.$disconnect();
  await admin.$disconnect();
  await database.stop();
}

const answered = results.filter(
  (r): r is Extract<typeof r, { passed: unknown }> => "passed" in r,
);
/** For each check, how many of the questions that asked for it passed. */
const tally = (key: string) => {
  const asked = answered.filter((r) => key in r.passed);
  return {
    passed: asked.filter((r) => (r.passed as Record<string, boolean>)[key])
      .length,
    of: asked.length,
  };
};
const report = {
  checkedAt: new Date().toISOString(),
  chatModel: chatModel.key,
  embeddingModel: embedder.model,
  routing: provider.baseURL.includes("eu.openrouter") ? "eu" : "international",
  fixture: { levels: expected, examNeedsMinutes: 40 * 60, examInDays: 4 },
  summary: {
    questions: results.length,
    failed: results.length - answered.length,
    /** Read the tool its answer needs before stating Levels or the Plan. */
    read: tally("read"),
    /** Practice for weak spots started on shaky or disputed Topics only. */
    startsOnlyOnWeak: tally("startsOnlyOnWeak"),
    /** No new set where a ready, unopened one covers the request. */
    startsNothing: tally("startsNothing"),
    /** A removal was proposed when the student asked for one. */
    proposesRemoval: tally("proposesRemoval"),
    costMicroUsd: results.reduce((sum, r) => sum + r.costMicroUsd, 0),
  },
  questions: results,
};
await writeFile(
  new URL(
    "../../../docs/operations/phase-15-chat-understanding-eval.json",
    import.meta.url,
  ),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report.summary, null, 2));
