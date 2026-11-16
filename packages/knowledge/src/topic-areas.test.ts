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
  areas = createTopicAreas({ db: runtime, facts });
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
