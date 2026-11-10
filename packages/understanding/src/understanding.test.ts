import { randomBytes, randomUUID } from "node:crypto";
import type {
  Embedder,
  Extracted,
  Extractor,
  GradeInput,
  Grader,
  Maker,
  PracticeInput,
} from "@nunio/ai";
import { createArtifacts } from "@nunio/artifacts";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Delegation, Principal } from "@nunio/delegation";
import {
  createDelegation,
  createResponsibilities,
  principal,
} from "@nunio/delegation";
import type { SourceKeys } from "@nunio/keys";
import { createSourceKeys } from "@nunio/keys";
import type { Facts, KnowledgeReader, Sources } from "@nunio/knowledge";
import {
  createFacts,
  createKnowledgeReader,
  createSources,
} from "@nunio/knowledge";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createUnderstanding } from "./understanding.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
let keys: SourceKeys;
let delegation: Delegation;
let sources: Sources;
let facts: Facts;
let reader: KnowledgeReader;
const clock = { now: () => new Date() };

/** Deterministic vectors: one dimension per keyword, so a query scores the passages that share its keywords. */
const keywords = ["konvergenz", "integral"];
const vector = (text: string) => [
  ...keywords.map((k) => (text.toLowerCase().includes(k) ? 1 : 0)),
  0.01,
];
const embedder: Embedder = {
  model: "test-embedding",
  dims: 3,
  relevanceFloor: 0.3,
  estimateMicroUsd: () => 1,
  async embed(texts) {
    return { vectors: texts.map(vector), usage: { microUsd: 1 } };
  },
};

beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
  keys = createSourceKeys({
    activeVersion: "v1",
    masters: { v1: randomBytes(32) },
  });
  delegation = createDelegation({ db: runtime, aiEnabled: () => true });
  sources = createSources({
    db: runtime,
    keys,
    storage: {
      upload: async (id) => ({
        url: `https://storage.invalid/${id}`,
        headers: {},
        expiresAt: new Date(Date.now() + 300_000),
      }),
      download: async (id, key) => ({
        url: `https://storage.invalid/${id}`,
        keyBase64: key.toString("base64"),
        etag: "etag",
      }),
      promote: async () => {},
      remove: async () => {},
    },
  });
  facts = createFacts({ db: runtime, keys, clock });
  reader = createKnowledgeReader({
    db: runtime,
    keys,
    embedder,
    delegation,
    clock,
  });
}, 180_000);
afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
});

async function student(limitMicroUsd = 5_000_000): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({
    data: { id, email: `${id}@example.com`, name: "Student" },
  });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  await admin.allowance.create({ data: { studentId: id, limitMicroUsd } });
  return principal.fromSession({ studentId: id });
}

/** A ready Source, one page per text, through the Sources interface. */
async function readySource(p: Principal, title: string, pages: string[]) {
  const upload = await sources.upload(p, {
    title,
    bytes: 100,
    type: "application/pdf",
  });
  if (upload.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, upload.source.id);
  const result = await sources.ingest(p, upload.source.id, {
    parse: async () => ({
      pages: pages.map((text, i) => ({ page: i + 1, text })),
    }),
    delegation,
    embedder,
    scans: {
      estimateMicroUsd: () => 1,
      read: async () => ({ text: "", usage: { microUsd: 1 } }),
    },
  });
  if (result.status !== "ready") throw new Error(`ingestion ${result.status}`);
  return upload.source.id;
}

/** A Skript Source for Analysis I with one Topic, extracted and accepted through the Facts interface. */
async function courseWithTopic(p: Principal) {
  const sourceId = await readySource(p, "Skript", [
    "MA-101 Analysis I",
    "Gleichmäßige Konvergenz: Eine Funktionenfolge konvergiert gleichmäßig, wenn der Abstand überall klein wird.",
    "Das Integral misst Flächen.",
  ]);
  const extracted: Extracted = {
    courses: [
      {
        code: "MA-101",
        title: "Analysis I",
        page: 1,
        quote: "MA-101 Analysis I",
      },
    ],
    obligations: [],
    facts: [
      {
        course: "MA-101",
        type: "topic",
        key: "Gleichmäßige Konvergenz",
        value: "Gleichmäßige Konvergenz",
        page: 2,
        quote: "Gleichmäßige Konvergenz",
        uncertainty: null,
      },
    ],
  };
  const extractor: Extractor = {
    model: "test-extractor",
    windows: (pages) => [[...pages]],
    estimateMicroUsd: () => 1,
    extract: async () => ({ value: extracted, usage: { microUsd: 1 } }),
  };
  await facts.extract(p, sourceId, { extractor, delegation });
  const course = (await facts.review(p)).courses[0]!;
  await facts.decideCourse(p, course.id, "accept");
  return { sourceId, courseId: course.id, topicId: course.facts[0]!.id };
}

/** A Maker that records what it was given and answers with one item citing the first tag. */
function fakeMaker() {
  const inputs: PracticeInput[] = [];
  const maker: Maker = {
    estimateMicroUsd: () => 10,
    async practiceSet(input) {
      inputs.push(input);
      return {
        value: {
          items: [
            {
              id: "1",
              topicIds: [input.topics[0]!.id],
              question:
                "Wann konvergiert eine Funktionenfolge gleichmäßig? [S1]",
              answer: "Wenn der Abstand überall klein wird [S1].",
              cited: ["S1"],
            },
          ],
        },
        usage: { microUsd: 20 },
      };
    },
  };
  return { maker, inputs };
}

function artifactsWith(maker: Maker) {
  return createArtifacts({
    db: runtime,
    keys,
    reader,
    facts,
    responsibilities: createResponsibilities({ db: runtime, clock }),
    delegation,
    maker,
    clock,
  });
}

/** A practice set on the Skript's Topic, made through the Artifacts interface. */
async function practiceSet(p: Principal) {
  const course = await courseWithTopic(p);
  const artifacts = artifactsWith(fakeMaker().maker);
  const started = await artifacts.request(p, {
    kind: "practice_set",
    topicIds: [course.topicId],
    from: { selection: { courseIds: [course.courseId], sourceIds: [] } },
  });
  if (started.status !== "started") throw new Error(started.status);
  await artifacts.make(started.runId);
  return { ...course, artifacts, artifactId: started.artifactId };
}

/** A Grader that records what it was given and answers with the scripted verdicts in turn. */
function scriptedGrader(
  ...verdicts: ("correct" | "partial" | "incorrect" | Error)[]
) {
  const inputs: GradeInput[] = [];
  const grader: Grader = {
    estimateMicroUsd: () => 5,
    async grade(input) {
      inputs.push(input);
      const verdict = verdicts.shift() ?? "correct";
      if (verdict instanceof Error) throw verdict;
      return {
        value: {
          verdict,
          text: `Das ist ${verdict} [S1].`,
          cited: ["S1"],
        },
        usage: { microUsd: 7 },
      };
    },
  };
  return { grader, inputs };
}

function understandingWith(
  artifacts: ReturnType<typeof artifactsWith>,
  grader: Grader,
) {
  return createUnderstanding({
    db: runtime,
    keys,
    artifacts,
    reader,
    facts,
    delegation,
    grader,
    clock,
  });
}

it("records the student's Attempt on a Practice Item and grades it, with Feedback citing the item's material", async () => {
  const p = await student();
  const { artifacts, artifactId, topicId, sourceId } = await practiceSet(p);
  const { grader, inputs } = scriptedGrader("partial");
  const understanding = understandingWith(artifacts, grader);

  const result = await understanding.attempt(
    p,
    { artifactId, itemId: "1" },
    "Wenn sie punktweise konvergiert.",
  );

  expect(inputs).toEqual([
    {
      question: "Wann konvergiert eine Funktionenfolge gleichmäßig? [S1]",
      answer: "Wenn der Abstand überall klein wird [S1].",
      attempt: "Wenn sie punktweise konvergiert.",
      tags: ["S1"],
    },
  ]);
  expect(result).toEqual({
    status: "graded",
    attempt: {
      id: expect.any(String),
      artifactId,
      itemId: "1",
      topicIds: [topicId],
      text: "Wenn sie punktweise konvergiert.",
      verdict: "partial",
      feedback: {
        text: "Das ist partial [S1].",
        citations: [
          {
            tag: "S1",
            provenance: {
              kind: "source",
              sourceId,
              title: "Skript",
              location: { page: 2 },
            },
          },
        ],
      },
      createdAt: expect.any(Date),
    },
  });
});

it("moves a Topic's Level only through graded Attempts, never through Artifacts, and shows a differing Self-assessment as disputed", async () => {
  const p = await student();
  const { artifacts, artifactId, topicId, courseId } = await practiceSet(p);
  const understanding = understandingWith(
    artifacts,
    scriptedGrader("correct", "correct").grader,
  );
  const level = async () => (await understanding.levels(p, { courseId }))[0];
  const item = { artifactId, itemId: "1" };

  expect(await understanding.levels(p, { courseId })).toEqual([
    {
      topicId,
      level: "not_yet_practiced",
      fromAttempts: null,
      selfAssessment: null,
      lastEvidenceAt: null,
    },
  ]);
  await artifacts.open(p, artifactId);
  expect(await level()).toMatchObject({ level: "not_yet_practiced" });
  await understanding.attempt(p, item, "Erster Versuch.");
  expect(await level()).toMatchObject({ level: "shaky" });
  await understanding.attempt(p, item, "Zweiter Versuch.");
  expect(await level()).toMatchObject({ level: "solid" });

  expect(await understanding.selfAssess(p, topicId, "shaky")).toEqual({
    status: "ok",
  });
  expect(await level()).toMatchObject({
    level: "disputed",
    fromAttempts: "solid",
    selfAssessment: "shaky",
  });
  expect(
    await understanding.selfAssess(await student(), topicId, "solid"),
  ).toEqual({ status: "gone" });
});

it("keeps an Attempt ungraded when grading fails or the Allowance is spent, and grades it when asked again", async () => {
  const p = await student();
  const { artifacts, artifactId, courseId } = await practiceSet(p);
  const { grader, inputs } = scriptedGrader(
    new Error("provider timed out"),
    "correct",
  );
  const understanding = understandingWith(artifacts, grader);
  const item = { artifactId, itemId: "1" };
  const level = async () => (await understanding.levels(p, { courseId }))[0];

  const failed = await understanding.attempt(p, item, "Erster Versuch.");
  expect(failed).toEqual({
    status: "ungraded",
    attemptId: expect.any(String),
    reason: "grader_failed",
  });
  if (failed.status !== "ungraded") throw new Error(failed.status);
  expect(await level()).toMatchObject({ level: "not_yet_practiced" });
  expect(await understanding.grade(p, failed.attemptId)).toMatchObject({
    id: failed.attemptId,
    text: "Erster Versuch.",
    verdict: "correct",
    feedback: { text: "Das ist correct [S1]." },
  });
  expect(await level()).toMatchObject({ level: "shaky" });
  expect(await understanding.grade(await student(), failed.attemptId)).toBe(
    "gone",
  );

  await delegation.meter(p, { microUsd: 1 }, async () => ({
    value: null,
    usage: { microUsd: 5_000_000 },
  }));
  expect(await understanding.attempt(p, item, "Dritter Versuch.")).toEqual({
    status: "ungraded",
    attemptId: expect.any(String),
    reason: "allowance_exhausted",
  });
  expect(inputs).toHaveLength(2);
});

it("withdraws Feedback with its practice set's Source while its verdicts keep counting, and takes no new Attempt on it", async () => {
  const p = await student();
  const { artifacts, artifactId, topicId, courseId, sourceId } =
    await practiceSet(p);
  const understanding = understandingWith(
    artifacts,
    scriptedGrader("correct", "correct").grader,
  );
  const item = { artifactId, itemId: "1" };
  const first = await understanding.attempt(p, item, "Erster Versuch.");
  await understanding.attempt(p, item, "Zweiter Versuch.");
  await understanding.selfAssess(p, topicId, "solid");
  if (first.status !== "graded") throw new Error(first.status);
  // A corrected Topic outlives its last Source; an uncorrected one would go, with its Evidence (an accepted limit).
  await facts.correct(
    p,
    { kind: "fact", id: topicId },
    { value: "Gleichmäßige Konvergenz" },
  );

  await sources.remove(p, sourceId);

  expect(await understanding.history(p, topicId)).toEqual([
    { kind: "self_assessment", level: "solid", at: expect.any(Date) },
    {
      kind: "attempt",
      attempt: expect.objectContaining({
        text: "Zweiter Versuch.",
        verdict: "correct",
        feedback: null,
      }),
    },
    {
      kind: "attempt",
      attempt: expect.objectContaining({
        id: first.attempt.id,
        text: "Erster Versuch.",
        verdict: "correct",
        feedback: null,
      }),
    },
  ]);
  expect((await understanding.levels(p, { courseId }))[0]).toMatchObject({
    level: "solid",
  });
  expect(await understanding.attempt(p, item, "Dritter Versuch.")).toEqual({
    status: "refused",
    reason: "gone",
  });
  expect(await understanding.grade(p, first.attempt.id)).toBe("gone");
});

it("keeps the verdict but no Feedback when a Source is deleted while grading", async () => {
  const p = await student();
  const { artifacts, artifactId, topicId, sourceId } = await practiceSet(p);
  await facts.correct(
    p,
    { kind: "fact", id: topicId },
    { value: "Gleichmäßige Konvergenz" },
  );
  const { grader } = scriptedGrader("correct");
  const understanding = understandingWith(artifacts, {
    ...grader,
    async grade(input, options) {
      await sources.remove(p, sourceId);
      return grader.grade(input, options);
    },
  });

  const result = await understanding.attempt(
    p,
    { artifactId, itemId: "1" },
    "Versuch.",
  );

  expect(result).toMatchObject({
    status: "graded",
    attempt: { verdict: "correct", feedback: null },
  });
  expect(await understanding.history(p, topicId)).toEqual([
    {
      kind: "attempt",
      attempt: expect.objectContaining({ verdict: "correct", feedback: null }),
    },
  ]);
});

it("never takes an Attempt on another student's practice set, or shows them another student's Evidence", async () => {
  const owner = await student();
  const { artifacts, artifactId, topicId } = await practiceSet(owner);
  const understanding = understandingWith(artifacts, scriptedGrader().grader);
  await understanding.attempt(owner, { artifactId, itemId: "1" }, "Meins.");
  const other = await student();

  expect(
    await understanding.attempt(other, { artifactId, itemId: "1" }, "Fremd."),
  ).toEqual({ status: "refused", reason: "gone" });
  expect(
    await understanding.attempt(owner, { artifactId, itemId: "9" }, "?"),
  ).toEqual({ status: "refused", reason: "gone" });
  expect(await understanding.history(other, topicId)).toEqual([]);
});
