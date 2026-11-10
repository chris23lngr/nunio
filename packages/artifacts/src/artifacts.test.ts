import { randomBytes, randomUUID } from "node:crypto";
import type {
  Embedder,
  Extracted,
  Extractor,
  Maker,
  PracticeInput,
} from "@nunio/ai";
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
import { createArtifacts } from "./artifacts.js";

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

/** Extracts Analysis I from a Source whose first page names it, so the Source belongs to that Course. */
async function linkToCourse(p: Principal, sourceId: string) {
  await facts.extract(p, sourceId, {
    extractor: {
      model: "test-extractor",
      windows: (pages) => [[...pages]],
      estimateMicroUsd: () => 1,
      extract: async () => ({
        value: {
          courses: [
            {
              code: "MA-101",
              title: "Analysis I",
              page: 1,
              quote: "MA-101 Analysis I",
            },
          ],
          obligations: [],
          facts: [],
        },
        usage: { microUsd: 1 },
      }),
    },
    delegation,
  });
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
    async flashcards(input) {
      inputs.push(input);
      return {
        value: {
          cards: [
            {
              id: "1",
              topicIds: [input.topics[0]!.id],
              front: "Gleichmäßige Konvergenz",
              back: "Der Abstand wird überall\ngleichzeitig klein [S1].",
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

it("makes a practice set on a Topic from the student's material, ready until they first open it", async () => {
  const p = await student();
  const { sourceId, courseId, topicId } = await courseWithTopic(p);
  const { maker, inputs } = fakeMaker();
  const artifacts = artifactsWith(maker);

  const started = await artifacts.request(p, {
    kind: "practice_set",
    topicIds: [topicId],
    from: { selection: { courseIds: [courseId], sourceIds: [] } },
  });
  if (started.status !== "started") throw new Error(started.status);
  expect(await artifacts.list(p, { ready: true })).toEqual([]);

  expect(await artifacts.make(started.runId)).toBe("ready");

  expect(inputs).toEqual([
    {
      topics: [{ id: topicId, name: "Gleichmäßige Konvergenz" }],
      data: expect.stringContaining("konvergiert gleichmäßig"),
      tags: ["S1"],
    },
  ]);
  expect(await artifacts.list(p, { ready: true })).toEqual([
    expect.objectContaining({
      id: started.artifactId,
      kind: "practice_set",
      status: "ready",
      topicIds: [topicId],
      withdrawn: false,
    }),
  ]);
  expect(await artifacts.open(p, started.artifactId)).toMatchObject({
    id: started.artifactId,
    content: {
      items: [
        {
          id: "1",
          topicIds: [topicId],
          question: "Wann konvergiert eine Funktionenfolge gleichmäßig? [S1]",
          answer: "Wenn der Abstand überall klein wird [S1].",
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
      ],
    },
  });
  expect(await artifacts.list(p, { ready: true })).toEqual([]);
  expect(await artifacts.open(await student(), started.artifactId)).toBe(
    "gone",
  );
});

it("refuses a Topic that is not the student's, or that they rejected, recording nothing", async () => {
  const p = await student();
  const other = await courseWithTopic(await student());
  const own = await courseWithTopic(p);
  await facts.reject(p, { kind: "fact", id: own.topicId });
  const artifacts = artifactsWith(fakeMaker().maker);

  for (const { topicId, courseId } of [other, own])
    expect(
      await artifacts.request(p, {
        kind: "practice_set",
        topicIds: [topicId],
        from: { selection: { courseIds: [courseId], sourceIds: [] } },
      }),
    ).toEqual({ status: "refused", reason: "gone" });
  expect(await artifacts.list(p, {})).toEqual([]);
});

it("gives the Maker only the material pinned when the student asked, not a Source added since", async () => {
  const p = await student();
  const { courseId, topicId } = await courseWithTopic(p);
  const { maker, inputs } = fakeMaker();
  const artifacts = artifactsWith(maker);
  const started = await artifacts.request(p, {
    kind: "practice_set",
    topicIds: [topicId],
    from: { selection: { courseIds: [courseId], sourceIds: [] } },
  });
  if (started.status !== "started") throw new Error(started.status);
  const later = await readySource(p, "Übungen", [
    "MA-101 Analysis I",
    "Konvergenz-Aufgabe, die erst später hochgeladen wurde.",
  ]);
  await linkToCourse(p, later);

  await artifacts.make(started.runId);

  expect(inputs[0]!.data).toContain("konvergiert gleichmäßig");
  expect(inputs[0]!.data).not.toContain("erst später");
});

it("withdraws a practice set when a Source it was drawn from is deleted, and names it beforehand", async () => {
  const p = await student();
  const { sourceId, courseId, topicId } = await courseWithTopic(p);
  const artifacts = artifactsWith(fakeMaker().maker);
  const started = await artifacts.request(p, {
    kind: "practice_set",
    topicIds: [topicId],
    from: { selection: { courseIds: [courseId], sourceIds: [] } },
  });
  if (started.status !== "started") throw new Error(started.status);
  await artifacts.make(started.runId);
  const elsewhere = await readySource(p, "Notizen", [
    "MA-101 Analysis I",
    "Meine Notizen zur gleichmäßigen Konvergenz.",
  ]);
  await linkToCourse(p, elsewhere);
  const unrelated = await artifacts.request(p, {
    kind: "practice_set",
    topicIds: [topicId],
    from: { selection: { courseIds: [], sourceIds: [elsewhere] } },
  });
  if (unrelated.status !== "started") throw new Error(unrelated.status);
  await artifacts.make(unrelated.runId);

  expect(await artifacts.list(p, { derivedFrom: sourceId })).toEqual([
    expect.objectContaining({ id: started.artifactId, withdrawn: false }),
  ]);
  await sources.remove(p, sourceId);

  expect((await artifacts.list(p, { ready: true })).map((a) => a.id)).toEqual([
    unrelated.artifactId,
  ]);
  expect(await artifacts.open(p, started.artifactId)).toMatchObject({
    id: started.artifactId,
    kind: "practice_set",
    topicIds: [topicId],
    withdrawn: true,
    content: null,
  });
});

it("fails without asking the Maker when the Allowance is exhausted or nothing relevant is pinned", async () => {
  const { maker, inputs } = fakeMaker();
  const artifacts = artifactsWith(maker);

  for (const failure of ["allowance_exhausted", "no_material"]) {
    const p = await student();
    const { courseId, topicId } = await courseWithTopic(p);
    const notes = await readySource(p, "Einkaufsliste", ["Milch und Brot."]);
    const started = await artifacts.request(p, {
      kind: "practice_set",
      topicIds: [topicId],
      from: {
        selection:
          failure === "no_material"
            ? { courseIds: [], sourceIds: [notes] }
            : { courseIds: [courseId], sourceIds: [] },
      },
    });
    if (started.status !== "started") throw new Error(started.status);
    if (failure === "allowance_exhausted")
      await delegation.meter(p, { microUsd: 1 }, async () => ({
        value: null,
        usage: { microUsd: 5_000_000 },
      }));

    expect(await artifacts.make(started.runId)).toBe("failed");
    expect(await artifacts.list(p, {})).toEqual([
      expect.objectContaining({ status: "failed", failure }),
    ]);
  }
  expect(inputs).toEqual([]);
});

it("fails once when the Maker fails, and never makes it again", async () => {
  const p = await student();
  const { courseId, topicId } = await courseWithTopic(p);
  let calls = 0;
  const timedOut = async (): Promise<never> => {
    calls++;
    throw new Error("provider timed out");
  };
  const artifacts = artifactsWith({
    estimateMicroUsd: () => 10,
    practiceSet: timedOut,
    flashcards: timedOut,
  });
  const started = await artifacts.request(p, {
    kind: "practice_set",
    topicIds: [topicId],
    from: { selection: { courseIds: [courseId], sourceIds: [] } },
  });
  if (started.status !== "started") throw new Error(started.status);

  expect(await artifacts.make(started.runId)).toBe("failed");
  expect(await artifacts.make(started.runId)).toBe("failed");
  expect(calls).toBe(1);
  expect(await artifacts.open(p, started.artifactId)).toMatchObject({
    status: "failed",
    failure: "maker_failed",
    content: null,
  });
});

it("fails when the student rejects the Topic before the practice set is made", async () => {
  const p = await student();
  const { courseId, topicId } = await courseWithTopic(p);
  const { maker, inputs } = fakeMaker();
  const artifacts = artifactsWith(maker);
  const started = await artifacts.request(p, {
    kind: "practice_set",
    topicIds: [topicId],
    from: { selection: { courseIds: [courseId], sourceIds: [] } },
  });
  if (started.status !== "started") throw new Error(started.status);
  await facts.reject(p, { kind: "fact", id: topicId });

  expect(await artifacts.make(started.runId)).toBe("failed");
  expect(await artifacts.list(p, {})).toEqual([
    expect.objectContaining({ status: "failed", failure: "gone" }),
  ]);
  expect(inputs).toEqual([]);
});

it("fails, keeping nothing, when a Source is deleted while the practice set is being made", async () => {
  const p = await student();
  const { sourceId, courseId, topicId } = await courseWithTopic(p);
  const { maker } = fakeMaker();
  const artifacts = artifactsWith({
    ...maker,
    async practiceSet(input, options) {
      await sources.remove(p, sourceId);
      return maker.practiceSet(input, options);
    },
  });
  const started = await artifacts.request(p, {
    kind: "practice_set",
    topicIds: [topicId],
    from: { selection: { courseIds: [courseId], sourceIds: [] } },
  });
  if (started.status !== "started") throw new Error(started.status);

  expect(await artifacts.make(started.runId)).toBe("failed");
  expect(await artifacts.open(p, started.artifactId)).toMatchObject({
    status: "failed",
    failure: "gone",
    version: null,
    content: null,
  });
});

it("makes flashcards on a Topic from the student's material", async () => {
  const p = await student();
  const { sourceId, courseId, topicId } = await courseWithTopic(p);
  const artifacts = artifactsWith(fakeMaker().maker);

  const started = await artifacts.request(p, {
    kind: "flashcards",
    topicIds: [topicId],
    from: { selection: { courseIds: [courseId], sourceIds: [] } },
  });
  if (started.status !== "started") throw new Error(started.status);
  expect(await artifacts.make(started.runId)).toBe("ready");

  expect(await artifacts.open(p, started.artifactId)).toMatchObject({
    kind: "flashcards",
    version: 1,
    content: {
      cards: [
        {
          id: "1",
          topicIds: [topicId],
          front: "Gleichmäßige Konvergenz",
          back: "Der Abstand wird überall\ngleichzeitig klein [S1].",
          citations: [
            {
              tag: "S1",
              provenance: { kind: "source", sourceId, title: "Skript" },
            },
          ],
        },
      ],
    },
  });
});

/** Flashcards on the Skript's Topic, made through the interface. */
async function flashcardsOf(p: Principal) {
  const course = await courseWithTopic(p);
  const artifacts = artifactsWith(fakeMaker().maker);
  const started = await artifacts.request(p, {
    kind: "flashcards",
    topicIds: [course.topicId],
    from: { selection: { courseIds: [course.courseId], sourceIds: [] } },
  });
  if (started.status !== "started") throw new Error(started.status);
  await artifacts.make(started.runId);
  return { ...course, artifacts, artifactId: started.artifactId };
}

it("keeps each edit of a set of flashcards as a new version, refusing a stale edit, a practice set and another student's", async () => {
  const p = await student();
  const { artifacts, artifactId, topicId, courseId } = await flashcardsOf(p);
  const edit = {
    baseVersion: 1,
    content: {
      cards: [
        { id: "1", front: "Gleichmäßige Konvergenz", back: "Kürzer gesagt." },
        { front: "Punktweise Konvergenz", back: "Für jedes x einzeln." },
      ],
    },
  };

  expect(await artifacts.edit(p, artifactId, edit)).toEqual({
    status: "ok",
    version: 2,
  });
  expect(await artifacts.open(p, artifactId)).toMatchObject({
    version: 2,
    content: {
      cards: [
        {
          id: "1",
          topicIds: [topicId],
          back: "Kürzer gesagt.",
          citations: [{ tag: "S1" }],
        },
        {
          id: "2",
          topicIds: [topicId],
          front: "Punktweise Konvergenz",
          citations: [],
        },
      ],
    },
  });
  expect(await artifacts.open(p, artifactId, 1)).toMatchObject({
    version: 1,
    content: {
      cards: [{ back: "Der Abstand wird überall\ngleichzeitig klein [S1]." }],
    },
  });
  expect(await artifacts.edit(p, artifactId, edit)).toEqual({
    status: "stale",
  });
  expect(await artifacts.edit(await student(), artifactId, edit)).toEqual({
    status: "gone",
  });

  const practice = await artifacts.request(p, {
    kind: "practice_set",
    topicIds: [topicId],
    from: { selection: { courseIds: [courseId], sourceIds: [] } },
  });
  if (practice.status !== "started") throw new Error(practice.status);
  await artifacts.make(practice.runId);
  expect(await artifacts.edit(p, practice.artifactId, edit)).toEqual({
    status: "not_editable",
  });
});

it("exports the latest version of a set of flashcards for Anki, and nothing once withdrawn, for a practice set or for another student", async () => {
  const p = await student();
  const { artifacts, artifactId, topicId, courseId, sourceId } =
    await flashcardsOf(p);
  await artifacts.edit(p, artifactId, {
    baseVersion: 1,
    content: {
      cards: [
        { id: "1", front: "Gleichmäßige Konvergenz", back: "Kürzer gesagt." },
      ],
    },
  });

  const exported = await artifacts.exportFlashcards(p, artifactId);

  if (exported === "gone") throw new Error("gone");
  expect(exported.filename).toMatch(
    /^nunio-flashcards-\d{4}-\d{2}-\d{2}\.tsv$/,
  );
  expect(exported.tsv.split("\n").slice(6)).toEqual([
    `Gleichmäßige Konvergenz\tKürzer gesagt.\tGleichmäßige_Konvergenz\tnunio-${artifactId}-1`,
    "",
  ]);
  expect(await artifacts.exportFlashcards(await student(), artifactId)).toBe(
    "gone",
  );
  const practice = await artifacts.request(p, {
    kind: "practice_set",
    topicIds: [topicId],
    from: { selection: { courseIds: [courseId], sourceIds: [] } },
  });
  if (practice.status !== "started") throw new Error(practice.status);
  await artifacts.make(practice.runId);
  expect(await artifacts.exportFlashcards(p, practice.artifactId)).toBe("gone");

  await sources.remove(p, sourceId);

  expect(await artifacts.exportFlashcards(p, artifactId)).toBe("gone");
  expect(
    await artifacts.edit(p, artifactId, {
      baseVersion: 2,
      content: { cards: [] },
    }),
  ).toEqual({ status: "withdrawn" });
});
