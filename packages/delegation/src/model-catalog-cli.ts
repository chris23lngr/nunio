import {
  fetchZeroRetentionPrices,
  isCoveredModel,
  taskModels,
} from "@nunio/ai";
import { createPool, createPrismaClient } from "@nunio/db";
import { createModelCatalog } from "./model-catalog.js";

const usage =
  "Usage: model-catalog.js <command>; requires OPERATOR_ID and OPERATOR_DATABASE_URL\n" +
  "  list\n" +
  "  add <key> <openrouter-model-id> <low|medium|high> <max-output-tokens> <name> <description>\n" +
  "  enable <key> | disable <key> | set-default <key> | retire <key>\n" +
  "  sync";
const [command, ...args] = process.argv.slice(2);
const operator = process.env.OPERATOR_ID?.trim();
const databaseURL = process.env.OPERATOR_DATABASE_URL;
if (!command || !operator || !databaseURL) {
  console.error(usage);
  process.exit(1);
}

/** Audit attribution, checked above. */
const operatorId: string = operator;

class Refused extends Error {}

/** The model's maker as the picker shows it, from OpenRouter's ID prefix. */
const makers: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
};

const prisma = createPrismaClient(createPool(databaseURL));

async function existing(key: string) {
  const row = await prisma.catalogModel.findUnique({ where: { key } });
  if (!row) throw new Refused(`No Model ${key}`);
  return row;
}

/** Applies a switch change and its audit record together. */
async function change(
  key: string,
  action: string,
  data: Parameters<typeof prisma.catalogModel.update>[0]["data"],
) {
  await prisma.$transaction([
    prisma.catalogModel.update({ where: { key }, data }),
    prisma.modelCatalogChange.create({
      data: { modelKey: key, action, operator: operatorId },
    }),
  ]);
  console.log(JSON.stringify({ key, action, operator: operatorId }));
}
try {
  if (command === "list" && args.length === 0) {
    const rows = await prisma.catalogModel.findMany({
      orderBy: [{ position: "asc" }, { key: "asc" }],
    });
    for (const row of rows)
      console.log(
        JSON.stringify({
          key: row.key,
          name: row.name,
          providerModelId: row.providerModelId,
          reasoningEffort: row.reasoningEffort,
          maxOutputTokens: row.maxOutputTokens,
          position: row.position,
          chatEnabled: row.chatEnabled,
          chatDefault: row.chatDefault,
          retired: row.retiredAt !== null,
          zeroRetentionAvailable: row.zeroRetentionAvailable,
          syncedAt: row.syncedAt?.toISOString() ?? null,
        }),
      );
  } else if (command === "add" && args.length === 6) {
    const [key, providerModelId, effort, tokens, name, description] = args as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(key))
      throw new Refused(
        "The key may use only lowercase letters, digits, dots and dashes",
      );
    if (isCoveredModel(providerModelId))
      throw new Refused(
        "Covered Models need 30-day retention and stay excluded (ADR-0011)",
      );
    if (!["low", "medium", "high"].includes(effort))
      throw new Refused("The reasoning effort is low, medium or high");
    if (!/^[1-9]\d*$/.test(tokens))
      throw new Refused("The max output tokens are a positive whole number");
    const provider = makers[providerModelId.split("/")[0] ?? ""];
    if (!provider)
      throw new Refused(`Unknown model maker in ${providerModelId}`);
    if (await prisma.catalogModel.findUnique({ where: { key } }))
      throw new Refused(
        `The Model ${key} already exists; Models never change, so add one under a new key`,
      );
    const position =
      ((await prisma.catalogModel.aggregate({ _max: { position: true } }))._max
        .position ?? 0) + 1;
    await prisma.$transaction([
      prisma.catalogModel.create({
        data: {
          key,
          providerModelId,
          reasoningEffort: effort,
          maxOutputTokens: Number(tokens),
          name,
          provider,
          description,
          position,
        },
      }),
      prisma.modelCatalogChange.create({
        data: { modelKey: key, action: "add", operator },
      }),
    ]);
    console.log(JSON.stringify({ key, added: true, operator }));
  } else if (command === "enable" && args.length === 1) {
    const row = await existing(args[0]!);
    if (row.retiredAt) throw new Refused(`The Model ${row.key} is retired`);
    await change(row.key, "enable", { chatEnabled: true });
  } else if (command === "disable" && args.length === 1) {
    const row = await existing(args[0]!);
    if (row.chatDefault)
      throw new Refused(
        `${row.key} is the Chat default; set another default first`,
      );
    await change(row.key, "disable", { chatEnabled: false });
  } else if (command === "set-default" && args.length === 1) {
    const row = await existing(args[0]!);
    if (!row.chatEnabled)
      throw new Refused(`${row.key} is not offered in Chat; enable it first`);
    await prisma.$transaction([
      prisma.catalogModel.updateMany({
        where: { chatDefault: true },
        data: { chatDefault: false },
      }),
      prisma.catalogModel.update({
        where: { key: row.key },
        data: { chatDefault: true },
      }),
      prisma.modelCatalogChange.create({
        data: { modelKey: row.key, action: "set-default", operator },
      }),
    ]);
    console.log(
      JSON.stringify({ key: row.key, action: "set-default", operator }),
    );
  } else if (command === "retire" && args.length === 1) {
    const row = await existing(args[0]!);
    const tasks = Object.entries(taskModels)
      .filter(([, key]) => key === row.key)
      .map(([task]) => task);
    if (tasks.length)
      throw new Refused(
        `${row.key} still answers ${tasks.join(", ")}; change taskModels in @nunio/ai first`,
      );
    if (row.chatDefault)
      throw new Refused(
        `${row.key} is the Chat default; set another default first`,
      );
    await change(row.key, "retire", {
      chatEnabled: false,
      retiredAt: new Date(),
    });
  } else if (command === "sync" && args.length === 0) {
    const catalog = createModelCatalog({
      db: prisma,
      clock: { now: () => new Date() },
    });
    const synced = await fetchZeroRetentionPrices({
      baseURL:
        process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
      only: new Set(await catalog.providerModelIds()),
    });
    await catalog.applySync(synced);
    console.log(JSON.stringify({ synced: [...synced.keys()] }));
  } else {
    throw new Refused(usage);
  }
} catch (error) {
  console.error(
    error instanceof Refused
      ? error.message
      : "Could not change the Model Catalog; check operator database access and applied migrations",
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
