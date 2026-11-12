import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModelCatalog, Principal } from "./index.js";
import { createModelCatalog, principal } from "./index.js";

let db: TestDatabase;
/** Seeds fixtures as the migration role. */
let admin: PrismaClient;
/** The restricted runtime role, as the API and worker connect. */
let runtime: PrismaClient;
let now = new Date();
let catalog: ModelCatalog;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
  runtime = createPrismaClient(createPool(db.runtimeConnectionString));
  catalog = createModelCatalog({ db: runtime, clock: { now: () => now } });
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

const day = 24 * 60 * 60 * 1000;

/** Adds an enabled, freshly synced Model as the migration role; `overrides` change any column. */
async function addModel(overrides: Record<string, unknown> = {}) {
  const key = `test-${randomUUID().slice(0, 8)}`;
  await admin.catalogModel.create({
    data: {
      key,
      providerModelId: "anthropic/claude-sonnet-5.5",
      reasoningEffort: "medium",
      maxOutputTokens: 4000,
      name: key,
      provider: "Anthropic",
      description: "Test",
      position: 100,
      chatEnabled: true,
      prices: [
        {
          minPromptTokens: 0,
          inputMicroUsdPerMTok: 1,
          outputMicroUsdPerMTok: 2,
        },
      ],
      upstream: ["Google"],
      zeroRetentionAvailable: true,
      syncedAt: now,
      ...overrides,
    },
  });
  return key;
}

async function student(): Promise<Principal> {
  const id = randomUUID();
  await admin.user.create({
    data: {
      id,
      name: "Student",
      email: `${id}@example.com`,
      emailVerified: true,
    },
  });
  return principal.fromSession({ studentId: id });
}

describe("the Model Catalog", () => {
  it("offers the seeded Models in Chat, in order, with Sonnet as the default", async () => {
    const offered = await catalog.chatModels();
    expect(offered.map((model) => model.key)).toEqual([
      "haiku-5.5-reasoning-high",
      "sonnet-5.5-reasoning-high",
      "opus-5.5-reasoning-high",
    ]);
    expect(offered.find((model) => model.chatDefault)?.key).toBe(
      "sonnet-5.5-reasoning-high",
    );
    expect(offered[1]).toMatchObject({
      providerModelId: "anthropic/claude-sonnet-5.5",
      reasoningEffort: "high",
      maxOutputTokens: 8000,
      name: "Sonnet 5.5",
      provider: "Anthropic",
      upstream: ["Amazon Bedrock", "Google"],
      prices: [
        {
          minPromptTokens: 0,
          inputMicroUsdPerMTok: 2_200_000,
          outputMicroUsdPerMTok: 11_000_000,
        },
      ],
    });
  });

  it("offers an enabled Model only while it has a zero-retention endpoint and prices synced within 7 days", async () => {
    const fresh = await addModel({
      syncedAt: new Date(now.getTime() - 7 * day + 60_000),
    });
    const disabled = await addModel({ chatEnabled: false });
    const withoutZeroRetention = await addModel({
      zeroRetentionAvailable: false,
    });
    const stale = await addModel({
      syncedAt: new Date(now.getTime() - 7 * day - 60_000),
    });
    const neverSynced = await addModel({ syncedAt: null, prices: undefined });
    const covered = await addModel({
      providerModelId: "anthropic/claude-fable-5-1",
    });
    const offered = (await catalog.chatModels()).map((model) => model.key);
    expect(offered).toContain(fresh);
    for (const key of [
      disabled,
      withoutZeroRetention,
      stale,
      neverSynced,
      covered,
    ])
      expect(offered).not.toContain(key);
  });

  it("answers with the Chat default until a student chooses, then remembers their choice", async () => {
    const p = await student();
    expect((await catalog.chatModelFor(p))?.key).toBe(
      "sonnet-5.5-reasoning-high",
    );
    expect(
      (await catalog.chatModelFor(p, "opus-5.5-reasoning-high"))?.key,
    ).toBe("opus-5.5-reasoning-high");
    expect((await catalog.chatModelFor(p))?.key).toBe(
      "opus-5.5-reasoning-high",
    );
    // Another student's choice is their own.
    expect((await catalog.chatModelFor(await student()))?.key).toBe(
      "sonnet-5.5-reasoning-high",
    );
  });

  it("refuses a chosen Model that is not offered, and falls back to the default once a remembered one stops being offered", async () => {
    const p = await student();
    const key = await addModel();
    expect((await catalog.chatModelFor(p, key))?.key).toBe(key);
    await admin.catalogModel.update({
      where: { key },
      data: { chatEnabled: false },
    });
    expect(await catalog.chatModelFor(p, key)).toBeNull();
    expect(await catalog.chatModelFor(p, "no-such-model")).toBeNull();
    expect((await catalog.chatModelFor(p))?.key).toBe(
      "sonnet-5.5-reasoning-high",
    );
  });

  it("syncs prices and zero-retention availability without touching the founder's switches", async () => {
    const synced = await addModel({
      providerModelId: "anthropic/claude-test-a",
      syncedAt: new Date(0),
    });
    const vanished = await addModel({
      providerModelId: "anthropic/claude-test-b",
    });
    now = new Date(now.getTime() + 60_000);
    const tier = (input: number, output: number) => [
      {
        minPromptTokens: 0,
        inputMicroUsdPerMTok: input,
        outputMicroUsdPerMTok: output,
      },
    ];
    await catalog.applySync(
      new Map(
        [
          ["anthropic/claude-test-a", tier(3, 4)],
          ["anthropic/claude-haiku-5.5", tier(110_000, 550_000)],
          ["anthropic/claude-sonnet-5.5", tier(2_200_000, 11_000_000)],
          ["anthropic/claude-opus-5.5", tier(4_400_000, 22_000_000)],
        ].map(([id, prices]) => [
          id as string,
          {
            providerModelId: id as string,
            prices: prices as never,
            upstream: ["Amazon Bedrock"],
          },
        ]),
      ),
    );
    const rows = await admin.catalogModel.findMany({
      where: { key: { in: [synced, vanished] } },
    });
    expect(rows.find((row) => row.key === synced)).toMatchObject({
      prices: tier(3, 4),
      upstream: ["Amazon Bedrock"],
      zeroRetentionAvailable: true,
      syncedAt: now,
      chatEnabled: true,
    });
    expect(rows.find((row) => row.key === vanished)).toMatchObject({
      zeroRetentionAvailable: false,
      chatEnabled: true,
    });
    const offered = (await catalog.chatModels()).map((model) => model.key);
    expect(offered).toContain(synced);
    expect(offered).not.toContain(vanished);
  });

  it("leaves the founder's switches out of the runtime role's reach", async () => {
    const key = await addModel();
    await expect(
      runtime.catalogModel.update({
        where: { key },
        data: { chatEnabled: false },
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runtime.catalogModel.update({
        where: { key },
        data: { reasoningEffort: "low" },
      }),
    ).rejects.toThrow(/permission denied/);
  });

  it("gives tasks every priced Model that is not retired, whether or not Chat offers it", async () => {
    const hidden = await addModel({ chatEnabled: false });
    const retired = await addModel({ chatEnabled: false, retiredAt: now });
    const keys = (await catalog.taskModels()).map((model) => model.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "haiku-5.5-reasoning-high",
        "sonnet-5.5-reasoning-high",
        "opus-5.5-reasoning-high",
        hidden,
      ]),
    );
    expect(keys).not.toContain(retired);
  });

  it("names the OpenRouter models to price: every Model's that is not retired, once", async () => {
    await addModel({ providerModelId: "anthropic/claude-test-c" });
    await addModel({ providerModelId: "anthropic/claude-test-c" });
    await addModel({
      providerModelId: "anthropic/claude-test-d",
      chatEnabled: false,
      retiredAt: now,
    });
    const ids = await catalog.providerModelIds();
    expect(ids.filter((id) => id === "anthropic/claude-test-c")).toHaveLength(
      1,
    );
    expect(ids).toContain("anthropic/claude-sonnet-5.5");
    expect(ids).not.toContain("anthropic/claude-test-d");
  });
});
