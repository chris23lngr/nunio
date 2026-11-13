// The documents both retrieval evals read: public handbook excerpts, parsed in-process (host qpdf/Poppler) into a
// throwaway Postgres, with real ingestion and query embeddings through OpenRouter.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ModelConfig } from "@nunio/ai";
import {
  createEmbedder,
  createModels,
  createScanReader,
  fetchZeroRetentionPrices,
} from "@nunio/ai";
import { createPool, createPrismaClient } from "@nunio/db";
import { startTestDatabase } from "@nunio/db/testing";
import type { Principal } from "@nunio/delegation";
import { createDelegation, principal } from "@nunio/delegation";
import { createSourceKeys } from "@nunio/keys";
import { createSources } from "@nunio/knowledge";
import { createParserServer } from "@nunio/parser/server";
import { parseSource } from "../../src/source-activities.ts";

interface Source {
  url: string;
  pages?: [number, number];
}
export interface EvalDocument {
  id: string;
  /** A student of its own, holding only this document. */
  p: Principal;
  sourceId: string;
  questions: { text: string; pages: number[] }[];
  unanswerable: string[];
}

const exec = promisify(execFile);
const here = (path: string) => new URL(path, import.meta.url);
const cache = join(tmpdir(), "nunio-extraction-eval");

async function bytesOf(id: string, source: Source) {
  await mkdir(cache, { recursive: true });
  const whole = join(cache, `${id}-whole.pdf`);
  if (!existsSync(whole)) {
    const response = await fetch(source.url, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok)
      throw new Error(`${id}: download failed (${response.status})`);
    await writeFile(whole, Buffer.from(await response.arrayBuffer()));
  }
  if (!source.pages) return readFile(whole);
  const [from, to] = source.pages,
    excerpt = join(cache, `${id}.pdf`);
  await exec("qpdf", [whole, "--pages", whole, `${from}-${to}`, "--", excerpt]);
  return readFile(excerpt);
}

/**
 * Ingests every labelled document for a student of its own. `models` are Model Catalog rows to price live from
 * OpenRouter's zero-retention endpoints; Haiku is always among them, for reading scanned pages.
 */
export async function startRetrievalEval(
  models: Omit<ModelConfig, "prices" | "upstream">[] = [],
) {
  const provider = {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseURL: process.env.OPENROUTER_BASE_URL ?? "",
  };
  if (!provider.apiKey || !provider.baseURL)
    throw new Error("OPENROUTER_API_KEY and OPENROUTER_BASE_URL are required");
  const rows = [
    {
      key: "haiku-5.5-reasoning-high",
      providerModelId: "anthropic/claude-haiku-5.5",
      reasoningEffort: "high" as const,
      maxOutputTokens: 8_000,
    },
    ...models,
  ];
  const priced = await fetchZeroRetentionPrices({
    baseURL: provider.baseURL,
    only: new Set(rows.map((row) => row.providerModelId)),
  });
  const catalog: ModelConfig[] = rows.map((row) => {
    const synced = priced.get(row.providerModelId);
    if (!synced)
      throw new Error(`${row.providerModelId} has no zero-retention endpoint`);
    return { ...row, prices: synced.prices, upstream: synced.upstream };
  });
  const set = JSON.parse(
    await readFile(here("../extraction/set.json"), "utf8"),
  ) as { documents: { id: string; source: Source | { file: string } }[] };
  const labels = JSON.parse(
    await readFile(here("./questions.json"), "utf8"),
  ) as {
    documents: {
      id: string;
      questions: { text: string; pages: number[] }[];
      unanswerable: string[];
    }[];
  };
  const embedder = createEmbedder(provider),
    scans = createScanReader(createModels({ ...provider, catalog }));

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
  const close = async () => {
    await new Promise<void>((resolve) => parser.close(() => resolve()));
    await db.$disconnect();
    await admin.$disconnect();
    await database.stop();
  };
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
  const delegation = createDelegation({ db, aiEnabled: () => true });

  const documents: EvalDocument[] = [];
  try {
    for (const labelled of labels.documents) {
      const source = set.documents.find((d) => d.id === labelled.id)?.source;
      if (!source || !("url" in source))
        throw new Error(
          `${labelled.id}: not a fetched document in the extraction set`,
        );
      const studentId = randomUUID();
      await admin.user.create({
        data: {
          id: studentId,
          email: `${studentId}@eval.invalid`,
          name: "Eval",
        },
      });
      await admin.pilotEntitlement.create({ data: { studentId } });
      await admin.allowance.create({
        data: { studentId, limitMicroUsd: 5_000_000 },
      });
      const p = principal.fromSession({ studentId });
      const bytes = await bytesOf(labelled.id, source);
      const upload = await sources.upload(p, {
        title: `${labelled.id}.pdf`,
        bytes: bytes.length,
        type: "application/pdf",
      });
      if (upload.status !== "ok")
        throw new Error(`${labelled.id}: upload ${upload.status}`);
      objects.set(upload.source.id, bytes);
      await sources.complete(p, upload.source.id);
      const ingestion = await sources.ingest(p, upload.source.id, {
        delegation,
        embedder,
        scans,
        parse: (input) =>
          parseSource(parserHostport, input, AbortSignal.timeout(600_000)),
      });
      if (ingestion.status !== "ready")
        throw new Error(`${labelled.id}: ingestion ${ingestion.status}`);
      documents.push({ ...labelled, p, sourceId: upload.source.id });
    }
  } catch (error) {
    await close();
    throw error;
  }
  return {
    provider,
    catalog,
    embedder,
    db,
    keys,
    delegation,
    documents,
    close,
  };
}
