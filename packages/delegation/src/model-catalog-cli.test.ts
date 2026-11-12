import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execute = promisify(execFile);

let db: TestDatabase;
/** Reads results as the migration role. */
let admin: PrismaClient;
/** An operator login with only the privileges docs/operations/environments.md lists for the catalog. */
let operatorURL: string;
/** A stand-in for OpenRouter's public zero-retention endpoint list. */
let openrouter: Server;
let openrouterURL: string;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
  const user = `nunio_operator_test_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  for (const statement of [
    `CREATE ROLE ${user} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`,
    `GRANT USAGE ON SCHEMA public TO ${user}`,
    `GRANT SELECT, INSERT ON "catalog_model" TO ${user}`,
    `GRANT UPDATE ("chatEnabled", "chatDefault", "position", "retiredAt", "prices", "upstream", "zeroRetentionAvailable", "syncedAt") ON "catalog_model" TO ${user}`,
    `GRANT SELECT, INSERT ON "model_catalog_change" TO ${user}`,
  ])
    await admin.$executeRawUnsafe(statement);
  const url = new URL(db.connectionString);
  url.username = user;
  url.password = password;
  operatorURL = url.toString();
  const fixture = readFileSync(
    fileURLToPath(
      new URL("../../ai/src/fixtures/zdr-endpoints.json", import.meta.url),
    ),
  );
  openrouter = createServer((request, response) => {
    if (request.url !== "/api/v1/endpoints/zdr")
      return void response.writeHead(404).end();
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(fixture);
  });
  await new Promise<void>((resolve) =>
    openrouter.listen(0, "127.0.0.1", resolve),
  );
  openrouterURL = `http://127.0.0.1:${(openrouter.address() as AddressInfo).port}/api/v1`;
}, 180_000);

afterAll(async () => {
  openrouter?.close();
  await admin?.$disconnect();
  await db?.stop();
});

const script = fileURLToPath(
  new URL("./model-catalog-cli.ts", import.meta.url),
);

function models(...args: string[]) {
  return execute(process.execPath, ["--import", "tsx", script, ...args], {
    env: {
      PATH: process.env.PATH,
      OPERATOR_DATABASE_URL: operatorURL,
      OPERATOR_ID: "founder",
      OPENROUTER_BASE_URL: openrouterURL,
    },
  });
}

/** The command's failure message, or a test failure if it succeeded. */
async function refusal(...args: string[]): Promise<string> {
  const error = await models(...args).then(
    () => expect.fail(`models ${args.join(" ")} succeeded`),
    (error: { code: number; stderr: string }) => error,
  );
  expect(error.code).toBe(1);
  return error.stderr;
}

const audit = (modelKey: string) =>
  admin.modelCatalogChange
    .findMany({ where: { modelKey }, orderBy: { at: "asc" } })
    .then((changes) =>
      changes.map(({ action, operator }) => `${action} by ${operator}`),
    );

describe("the Model Catalog command", () => {
  it("lists every Model with its switches and when its prices were last synced", async () => {
    const { stdout } = await models("list");
    const rows = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows.map((row) => row.key)).toEqual([
      "haiku-5.5-reasoning-high",
      "sonnet-5.5-reasoning-high",
      "opus-5.5-reasoning-high",
    ]);
    expect(rows[1]).toMatchObject({
      key: "sonnet-5.5-reasoning-high",
      providerModelId: "anthropic/claude-sonnet-5.5",
      reasoningEffort: "high",
      chatEnabled: true,
      chatDefault: true,
      retired: false,
      zeroRetentionAvailable: true,
    });
    expect(typeof rows[1].syncedAt).toBe("string");
  });

  it("adds a Model switched off and unpriced, which the sync then prices from OpenRouter", async () => {
    await models(
      "add",
      "sonnet-5.5-reasoning-medium",
      "anthropic/claude-sonnet-5.5",
      "medium",
      "16000",
      "Sonnet 5.5 (mittel)",
      "Ausgewogen, denkt kürzer nach.",
    );
    expect(
      await admin.catalogModel.findUnique({
        where: { key: "sonnet-5.5-reasoning-medium" },
      }),
    ).toMatchObject({
      providerModelId: "anthropic/claude-sonnet-5.5",
      reasoningEffort: "medium",
      maxOutputTokens: 16000,
      name: "Sonnet 5.5 (mittel)",
      provider: "Anthropic",
      chatEnabled: false,
      prices: null,
      syncedAt: null,
    });
    await models("sync");
    // The highest price across the fixture's zero-retention Sonnet endpoints.
    expect(
      await admin.catalogModel.findUnique({
        where: { key: "sonnet-5.5-reasoning-medium" },
      }),
    ).toMatchObject({
      prices: [
        {
          minPromptTokens: 0,
          inputMicroUsdPerMTok: 2_200_000,
          outputMicroUsdPerMTok: 11_000_000,
        },
      ],
      upstream: ["Amazon Bedrock", "Google"],
      zeroRetentionAvailable: true,
    });
    expect(await audit("sonnet-5.5-reasoning-medium")).toEqual([
      "add by founder",
    ]);
  });

  it.each([
    [
      [
        "claude-fable",
        "anthropic/claude-fable-5-1",
        "high",
        "8000",
        "Fable",
        "x",
      ],
      /Covered Model/,
    ],
    [
      ["opus-off", "anthropic/claude-opus-5.5", "none", "8000", "Opus", "x"],
      /low, medium or high/,
    ],
    [
      ["Opus Off", "anthropic/claude-opus-5.5", "high", "8000", "Opus", "x"],
      /key/,
    ],
    [
      ["opus-big", "anthropic/claude-opus-5.5", "high", "lots", "Opus", "x"],
      /output tokens/,
    ],
    [
      [
        "sonnet-5.5-reasoning-high",
        "anthropic/claude-sonnet-5.5",
        "high",
        "8000",
        "Sonnet",
        "x",
      ],
      /already exists/,
    ],
  ])("refuses to add %j", async (args, message) => {
    expect(await refusal("add", ...args)).toMatch(message);
  });

  it("switches a Model on and off for Chat, and moves the Chat default, recording each change", async () => {
    await models(
      "add",
      "opus-5.5-reasoning-low",
      "anthropic/claude-opus-5.5",
      "low",
      "8000",
      "Opus 5.5 (kurz)",
      "x",
    );
    await models("enable", "opus-5.5-reasoning-low");
    expect(
      await admin.catalogModel.findUnique({
        where: { key: "opus-5.5-reasoning-low" },
      }),
    ).toMatchObject({
      chatEnabled: true,
    });
    await models("set-default", "opus-5.5-reasoning-low");
    const defaults = await admin.catalogModel.findMany({
      where: { chatDefault: true },
    });
    expect(defaults.map((row) => row.key)).toEqual(["opus-5.5-reasoning-low"]);
    expect(await refusal("disable", "opus-5.5-reasoning-low")).toMatch(
      /Chat default/,
    );
    await models("set-default", "sonnet-5.5-reasoning-high");
    await models("disable", "opus-5.5-reasoning-low");
    expect(
      await admin.catalogModel.findUnique({
        where: { key: "opus-5.5-reasoning-low" },
      }),
    ).toMatchObject({
      chatEnabled: false,
      chatDefault: false,
    });
    expect(await audit("opus-5.5-reasoning-low")).toEqual([
      "add by founder",
      "enable by founder",
      "set-default by founder",
      "disable by founder",
    ]);
  });

  it("refuses to make a switched-off Model the Chat default", async () => {
    await models(
      "add",
      "haiku-5.5-reasoning-low",
      "anthropic/claude-haiku-5.5",
      "low",
      "8000",
      "Haiku",
      "x",
    );
    expect(await refusal("set-default", "haiku-5.5-reasoning-low")).toMatch(
      /enable it first/,
    );
  });

  it("retires a Model for good, but never one a task or the Chat default still uses", async () => {
    // haiku-5.5-reasoning-high answers extraction (taskModels in @nunio/ai).
    expect(await refusal("retire", "haiku-5.5-reasoning-high")).toMatch(
      /extraction/,
    );
    expect(await refusal("retire", "sonnet-5.5-reasoning-high")).toMatch(
      /Chat default|explanation/,
    );
    await models(
      "add",
      "opus-5.5-reasoning-medium",
      "anthropic/claude-opus-5.5",
      "medium",
      "8000",
      "Opus",
      "x",
    );
    await models("enable", "opus-5.5-reasoning-medium");
    await models("retire", "opus-5.5-reasoning-medium");
    const row = await admin.catalogModel.findUnique({
      where: { key: "opus-5.5-reasoning-medium" },
    });
    expect(row?.retiredAt).not.toBeNull();
    expect(row?.chatEnabled).toBe(false);
    expect(await refusal("enable", "opus-5.5-reasoning-medium")).toMatch(
      /retired/,
    );
  });

  it("refuses an unknown Model", async () => {
    expect(await refusal("enable", "no-such-model")).toMatch(
      /No Model no-such-model/,
    );
  });
});
