import { randomBytes, randomUUID } from "node:crypto";
import type {
  Extracted,
  Extractor,
  Grouped,
  Grouper,
  GroupingInput,
} from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import type { Delegation, Principal } from "@nunio/delegation";
import { createDelegation, principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { Facts } from "./facts.js";
import { createFacts } from "./facts.js";
import type { SourceStorage, Sources } from "./sources.js";
import { createSources } from "./sources.js";
import type { TopicAreas } from "./topic-areas.js";
import { createTopicAreas } from "./topic-areas.js";

let database: TestDatabase;
let admin: PrismaClient;
let runtime: PrismaClient;
let sources: Sources;
let facts: Facts;
let areas: TopicAreas;
let delegation: Delegation;
const now = new Date("2026-11-02T12:00:00Z");
const storage: SourceStorage = {
  async upload(id) {
    return {
      url: `https://storage.invalid/${id}`,
      headers: {},
      expiresAt: new Date(Date.now() + 300_000),
    };
  },
  async download(id, key) {
    return {
      url: `https://storage.invalid/${id}`,
      keyBase64: key.toString("base64"),
      etag: "etag",
    };
  },
  async promote() {},
  async remove() {},
};
beforeAll(async () => {
  database = await startTestDatabase();
  admin = createPrismaClient(createPool(database.connectionString));
  runtime = createPrismaClient(createPool(database.runtimeConnectionString));
  const keys = createSourceKeys({
    activeVersion: "v1",
    masters: { v1: randomBytes(32) },
  });
  sources = createSources({ db: runtime, keys, storage });
  facts = createFacts({ db: runtime, keys, clock: { now: () => now } });
  areas = createTopicAreas({ db: runtime, facts, clock: { now: () => now } });
  delegation = createDelegation({ db: runtime, aiEnabled: () => true });
}, 180_000);
afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await database?.stop();
});

async function student(): Promise<Principal & { kind: "student" }> {
  const id = randomUUID();
  await admin.user.create({
    data: { id, email: `${id}@example.com`, name: "Student" },
  });
  await admin.pilotEntitlement.create({ data: { studentId: id } });
  await admin.allowance.create({
    data: { studentId: id, limitMicroUsd: 5_000_000 },
  });
  return principal.fromSession({ studentId: id }) as Principal & {
    kind: "student";
  };
}

/**
 * Reads a deck of Algorithmen whose pages each teach the given Topics, and returns the Course's ID.
 * Pages are one extraction window each.
 */
async function readDeck(
  p: Principal,
  title: string,
  pages: string[][],
): Promise<string> {
  const upload = await sources.upload(p, {
    title,
    bytes: 100,
    type: "application/pdf",
  });
  if (upload.status !== "ok") throw new Error("upload refused");
  await sources.complete(p, upload.source.id);
  const ingested = await sources.ingest(p, upload.source.id, {
    parse: async () => ({
      pages: pages.map((topics, index) => ({
        page: index + 1,
        text: ["INF-2 Algorithmen", ...topics].join("\n"),
      })),
    }),
    delegation,
    embedder: {
      model: "test-embedding",
      dims: 3,
      relevanceFloor: 0.3,
      estimateMicroUsd: () => 1,
      embed: async (texts) => ({
        vectors: texts.map(() => [1, 0, 0]),
        usage: { microUsd: 1 },
      }),
    },
    scans: {
      estimateMicroUsd: () => 1,
      read: async () => ({ text: "", usage: { microUsd: 1 } }),
    },
  });
  if (ingested.status !== "ready") throw new Error("ingestion failed");
  const results: Extracted[] = pages.map((topics, index) => ({
    courses: [
      {
        code: "INF-2",
        title: "Algorithmen",
        page: index + 1,
        quote: "INF-2 Algorithmen",
      },
    ],
    obligations: [],
    facts: topics.map((name) => ({
      course: "INF-2",
      type: "topic" as const,
      key: name,
      value: name,
      page: index + 1,
      quote: name,
      uncertainty: null,
    })),
  }));
  const extractor: Extractor = {
    model: "test-extractor",
    windows: (all) => all.map((page) => [page]),
    estimateMicroUsd: () => 10,
    async extract() {
      return { value: results.shift()!, usage: { microUsd: 5 } };
    },
  };
  const extracted = await facts.extract(p, upload.source.id, {
    extractor,
    delegation,
  });
  if (extracted.status !== "done") throw new Error("extraction failed");
  const course = (await facts.review(p)).courses.find(
    (c) => c.code === "INF-2",
  );
  return course!.id;
}

/** A Grouper answering with Topic names, which it turns into the handles it was shown. */
function grouping(...answers: { name: string; topics: string[] }[][]) {
  const inputs: GroupingInput[] = [];
  const grouper: Grouper = {
    model: "test-grouper",
    estimateMicroUsd: () => 10,
    async group(input) {
      inputs.push(input);
      const answer = answers.shift();
      if (!answer) throw new Error("no scripted grouping left");
      const handle = (name: string) =>
        input.topics.find((topic) => topic.name === name)?.handle ?? name;
      const value: Grouped = {
        areas: answer.map((area) => ({
          name: area.name,
          topics: area.topics.map(handle),
        })),
      };
      return { value, usage: { microUsd: 5 } };
    },
  };
  return { grouper, inputs };
}

/** The Course's Topic Areas as names only, then its ungrouped Topics. */
async function shown(p: Principal, courseId: string) {
  const listed = await areas.list(p, courseId);
  return {
    areas: listed.areas.map((area) => ({
      name: area.name,
      topics: area.topics.map((topic) => topic.name),
    })),
    ungrouped: listed.ungrouped.map((topic) => topic.name),
  };
}

const eight = [
  ["Bubblesort", "Quicksort", "Mergesort"],
  ["Breitensuche", "Tiefensuche", "Dijkstra"],
  ["Hashing", "O-Notation"],
];

it("groups a Course's Topics into the Topic Areas the Grouper returns, in its order", async () => {
  const p = await student();
  const courseId = await readDeck(p, "Algorithmen.pdf", eight);
  const { grouper } = grouping([
    { name: "Graphen", topics: ["Dijkstra", "Breitensuche", "Tiefensuche"] },
    { name: "Sortieren", topics: ["Quicksort", "Bubblesort", "Mergesort"] },
  ]);

  await areas.group(p, courseId, { grouper, delegation });

  expect(await shown(p, courseId)).toEqual({
    areas: [
      { name: "Graphen", topics: ["Dijkstra", "Breitensuche", "Tiefensuche"] },
      { name: "Sortieren", topics: ["Quicksort", "Bubblesort", "Mergesort"] },
    ],
    ungrouped: ["Hashing", "O-Notation"],
  });
});

it("leaves a Course with fewer than 8 Topics flat, without asking the model", async () => {
  const p = await student();
  const courseId = await readDeck(p, "Algorithmen.pdf", [eight[0]!, eight[1]!]);
  const { grouper, inputs } = grouping();

  const result = await areas.group(p, courseId, { grouper, delegation });

  expect(result).toEqual({ status: "skipped" });
  expect(inputs).toEqual([]);
  expect((await shown(p, courseId)).ungrouped).toHaveLength(6);
});

it("drops an Area with a single Topic, and ignores Topics the model was not shown", async () => {
  const p = await student();
  const courseId = await readDeck(p, "Algorithmen.pdf", eight);
  const { grouper } = grouping([
    { name: "Hashing", topics: ["Hashing"] },
    { name: "Sortieren", topics: ["Quicksort", "Heapsort", "Mergesort"] },
    { name: "Suchen", topics: ["Binärsuche", "Dijkstra"] },
  ]);

  await areas.group(p, courseId, { grouper, delegation });

  expect(await shown(p, courseId)).toEqual({
    areas: [{ name: "Sortieren", topics: ["Quicksort", "Mergesort"] }],
    ungrouped: [
      "Bubblesort",
      "Breitensuche",
      "Dijkstra",
      "Tiefensuche",
      "Hashing",
      "O-Notation",
    ],
  });
});

it("places only new Topics on a later pass, reusing Areas by name and showing the model where Topics are", async () => {
  const p = await student();
  const courseId = await readDeck(p, "Algorithmen.pdf", eight);
  const { grouper, inputs } = grouping(
    [
      { name: "Sortieren", topics: ["Bubblesort", "Quicksort", "Mergesort"] },
      { name: "Graphen", topics: ["Breitensuche", "Tiefensuche", "Dijkstra"] },
    ],
    [
      { name: "sortieren", topics: ["Heapsort", "Bubblesort"] },
      { name: "Spannbäume", topics: ["Prim", "Kruskal", "Dijkstra"] },
    ],
  );
  await areas.group(p, courseId, { grouper, delegation });
  await readDeck(p, "Graphen.pdf", [["Heapsort", "Prim", "Kruskal"]]);

  await areas.group(p, courseId, { grouper, delegation });

  expect(await shown(p, courseId)).toEqual({
    areas: [
      {
        name: "Sortieren",
        topics: ["Bubblesort", "Quicksort", "Mergesort", "Heapsort"],
      },
      { name: "Graphen", topics: ["Breitensuche", "Tiefensuche", "Dijkstra"] },
      { name: "Spannbäume", topics: ["Prim", "Kruskal"] },
    ],
    ungrouped: ["Hashing", "O-Notation"],
  });
  expect(inputs[1]?.areas).toEqual([
    { name: "Sortieren", rejected: false },
    { name: "Graphen", rejected: false },
  ]);
  expect(inputs[1]?.topics.find((t) => t.name === "Dijkstra")?.area).toBe(
    "Graphen",
  );
});

/** Reads the eight-Topic deck and groups it into Sortieren and Graphen. */
async function grouped(p: Principal) {
  const courseId = await readDeck(p, "Algorithmen.pdf", eight);
  await areas.group(p, courseId, {
    grouper: grouping([
      { name: "Sortieren", topics: ["Bubblesort", "Quicksort", "Mergesort"] },
      { name: "Graphen", topics: ["Breitensuche", "Tiefensuche", "Dijkstra"] },
    ]).grouper,
    delegation,
  });
  const listed = await areas.list(p, courseId);
  const area = (name: string) => listed.areas.find((a) => a.name === name)!;
  const topic = (name: string) =>
    [...listed.areas.flatMap((a) => a.topics), ...listed.ungrouped].find(
      (t) => t.name === name,
    )!;
  return { courseId, area, topic };
}

it("keeps a Topic where the student moved it, to another Area or to none, over later passes", async () => {
  const p = await student();
  const { courseId, area, topic } = await grouped(p);

  expect(
    await areas.move(p, topic("Dijkstra").id, area("Sortieren").id),
  ).toEqual({ status: "ok" });
  expect(await areas.move(p, topic("Quicksort").id, null)).toEqual({
    status: "ok",
  });
  await areas.group(p, courseId, {
    grouper: grouping([
      { name: "Graphen", topics: ["Dijkstra", "Quicksort"] },
      { name: "Sonstiges", topics: ["Quicksort", "Hashing"] },
    ]).grouper,
    delegation,
  });

  expect(await shown(p, courseId)).toEqual({
    areas: [
      { name: "Sortieren", topics: ["Bubblesort", "Mergesort", "Dijkstra"] },
      { name: "Graphen", topics: ["Breitensuche", "Tiefensuche"] },
    ],
    ungrouped: ["Quicksort", "Hashing", "O-Notation"],
  });
});

it("refuses to move a Topic into an Area of another Course or of another student", async () => {
  const p = await student();
  const other = await student();
  const mine = await grouped(p);
  const theirs = await grouped(other);

  expect(
    await areas.move(p, mine.topic("Dijkstra").id, theirs.area("Graphen").id),
  ).toEqual({ status: "not_found" });
  expect(await areas.move(other, mine.topic("Dijkstra").id, null)).toEqual({
    status: "not_found",
  });
});

it("keeps the student's name for an Area, shows it to the model, and refuses a name another Area has", async () => {
  const p = await student();
  const { courseId, area } = await grouped(p);
  const { grouper, inputs } = grouping([
    { name: "Sortierverfahren", topics: ["Hashing", "O-Notation"] },
  ]);

  expect(
    await areas.rename(p, area("Sortieren").id, "Sortierverfahren"),
  ).toEqual({ status: "ok" });
  expect(
    await areas.rename(p, area("Graphen").id, " sortierverfahren "),
  ).toEqual({ status: "clash" });
  await readDeck(p, "Nachtrag.pdf", [["Heapsort"]]);
  await areas.group(p, courseId, { grouper, delegation });

  expect(inputs[0]?.areas).toEqual([
    { name: "Sortierverfahren", rejected: false },
    { name: "Graphen", rejected: false },
  ]);
  expect((await shown(p, courseId)).areas).toEqual([
    {
      name: "Sortierverfahren",
      topics: ["Bubblesort", "Quicksort", "Mergesort", "Hashing", "O-Notation"],
    },
    { name: "Graphen", topics: ["Breitensuche", "Tiefensuche", "Dijkstra"] },
  ]);
});

it("hides a rejected Area for good, leaving its Topics ungrouped over later passes", async () => {
  const p = await student();
  const { courseId, area } = await grouped(p);
  const { grouper, inputs } = grouping([
    { name: "Sortieren", topics: ["Bubblesort", "Hashing", "O-Notation"] },
    { name: "Graphen", topics: ["Quicksort"] },
  ]);

  expect(await areas.reject(p, area("Sortieren").id)).toEqual({
    status: "ok",
  });
  await areas.group(p, courseId, { grouper, delegation });

  expect(inputs[0]?.areas).toContainEqual({
    name: "Sortieren",
    rejected: true,
  });
  expect(await shown(p, courseId)).toEqual({
    areas: [
      { name: "Graphen", topics: ["Breitensuche", "Tiefensuche", "Dijkstra"] },
    ],
    ungrouped: [
      "Bubblesort",
      "Mergesort",
      "Quicksort",
      "Hashing",
      "O-Notation",
    ],
  });
});

it("changes nothing when the model call is refused", async () => {
  const p = await student();
  const courseId = await readDeck(p, "Algorithmen.pdf", eight);
  const { grouper, inputs } = grouping();
  const disabled = createDelegation({ db: runtime, aiEnabled: () => false });

  const result = await areas.group(p, courseId, {
    grouper,
    delegation: disabled,
  });

  expect(result).toEqual({ status: "refused", reason: "ai_disabled" });
  expect(inputs).toEqual([]);
  expect((await shown(p, courseId)).areas).toEqual([]);
});

it("forgets an Area once it has no Topics left, but keeps a rejected one", async () => {
  const p = await student();
  const { courseId, area, topic } = await grouped(p);
  const { grouper, inputs } = grouping([]);
  await areas.reject(p, area("Graphen").id);
  for (const name of ["Bubblesort", "Quicksort", "Mergesort"])
    await areas.move(p, topic(name).id, null);

  expect((await shown(p, courseId)).areas).toEqual([]);
  await areas.group(p, courseId, { grouper, delegation });
  await areas.group(p, courseId, {
    grouper: grouping([
      { name: "Sortieren", topics: ["Hashing", "O-Notation"] },
    ]).grouper,
    delegation,
  });

  expect(inputs[0]?.areas).toEqual([{ name: "Graphen", rejected: true }]);
  expect((await shown(p, courseId)).areas).toEqual([
    { name: "Sortieren", topics: ["Hashing", "O-Notation"] },
  ]);
});

it("marks an Area inferred unless a member's quote or Source title names it", async () => {
  const p = await student();
  const courseId = await readDeck(p, "Algorithmen.pdf", [
    ...eight,
    ["Hashing mit Verkettung", "Offene Adressierung"],
  ]);
  await areas.group(p, courseId, {
    grouper: grouping([
      {
        name: "Hashing",
        topics: ["Hashing mit Verkettung", "Offene Adressierung"],
      },
      { name: "algorithmen", topics: ["Quicksort", "Mergesort"] },
      { name: "Graphen", topics: ["Breitensuche", "Dijkstra"] },
    ]).grouper,
    delegation,
  });

  expect(
    (await areas.list(p, courseId)).areas.map((a) => [a.name, a.inferred]),
  ).toEqual([
    ["Hashing", false],
    ["algorithmen", false],
    ["Graphen", true],
  ]);
});
