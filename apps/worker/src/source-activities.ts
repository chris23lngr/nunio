import { setTimeout as sleep } from "node:timers/promises";
import type { ModelConfig } from "@nunio/ai";
import {
  createEmbedder,
  createExtractor,
  createModels,
  createScanReader,
} from "@nunio/ai";
import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import { createDelegation, principal } from "@nunio/delegation";
import { sourceKeysFromEnv } from "@nunio/keys";
import type { Ingestion, Sources } from "@nunio/knowledge";
import {
  createFacts,
  createSources,
  IngestionError,
  sourceStorageFromEnv,
} from "@nunio/knowledge";
import { Context } from "@temporalio/activity";
import { log } from "./log.js";

export interface SourceRef {
  studentId: string;
  sourceId: string;
}
const settings = [
  "DATABASE_URL",
  "SOURCE_KEY_VERSION",
  "SOURCE_MASTER_KEYS",
  "HETZNER_S3_ENDPOINT",
  "HETZNER_S3_REGION",
  "HETZNER_S3_ACCESS_KEY_ID",
  "HETZNER_S3_SECRET_ACCESS_KEY",
  "HETZNER_QUARANTINE_BUCKET",
  "HETZNER_SOURCES_BUCKET",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "PARSER_HOSTPORT",
] as const;

/**
 * Reads every setting up front: a misconfigured worker fails at startup, not after taking a Source.
 * `catalog` is the Model Catalog's task Models, read once at start.
 */
export function createSourceActivities(
  env: NodeJS.ProcessEnv,
  catalog: readonly ModelConfig[],
) {
  const missing = settings.filter((name) => !env[name]);
  if (missing.length)
    throw new Error(`Missing settings: ${missing.join(", ")}`);
  const db: PrismaClient = createPrismaClient(createPool(env.DATABASE_URL!));
  const keys = sourceKeysFromEnv(env);
  const sources: Sources = createSources({
    db,
    keys,
    storage: sourceStorageFromEnv(env),
  });
  const facts = createFacts({ db, keys, clock: { now: () => new Date() } });
  const provider = {
    apiKey: env.OPENROUTER_API_KEY!,
    baseURL: env.OPENROUTER_BASE_URL!,
  };
  const models = createModels({ ...provider, catalog });
  const embedder = createEmbedder(provider),
    scans = createScanReader(models),
    extractor = createExtractor(models);
  const delegation = createDelegation({
    db,
    aiEnabled: () => env.AI_DISABLED !== "true",
  });
  return {
    async close() {
      await db.$disconnect();
    },
    activities: {
      async processSource({ studentId, sourceId }: SourceRef) {
        const context = Context.current();
        const heartbeat = setInterval(() => context.heartbeat(), 5_000);
        try {
          const deps: Ingestion = {
            signal: context.cancellationSignal,
            delegation,
            embedder,
            scans,
            parse: (input) =>
              parseSource(
                env.PARSER_HOSTPORT!,
                input,
                context.cancellationSignal,
              ),
          };
          // Decrypted keys and content stay inside this Activity, never in workflow arguments/results.
          const result = await sources.ingest(
            principal.fromSession({ studentId }),
            sourceId,
            deps,
          );
          if (result.status === "failed")
            log("ingestion failed", {
              sourceId,
              failure: result.failure ?? "internal",
            });
          return result;
        } finally {
          clearInterval(heartbeat);
        }
      },
      async extractFacts({ studentId, sourceId }: SourceRef) {
        const context = Context.current();
        const heartbeat = setInterval(() => context.heartbeat(), 5_000);
        try {
          const result = await facts.extract(
            principal.fromSession({ studentId }),
            sourceId,
            { extractor, delegation, signal: context.cancellationSignal },
          );
          // IDs and counts only: never Source content.
          log("extraction finished", { sourceId, ...result });
          return result;
        } finally {
          clearInterval(heartbeat);
        }
      },
      async purgeSource({ studentId, sourceId }: SourceRef) {
        const p = principal.fromSession({ studentId });
        // Dispatch precedes API deletion: finish the tombstone even if the API process stopped.
        await sources.remove(p, sourceId);
        await sources.purge(p, sourceId);
      },
    },
  };
}
/** Parser refusals the student can act on; any other refusal is ours to investigate. */
const parserFailures: Record<string, IngestionError["reason"]> = {
  page_limit: "too_many_pages",
  pdf_limit: "too_large",
  output_limit: "too_large",
  image_limit: "too_large",
  invalid_pdf: "unreadable",
  invalid_or_excessive_pdf: "unreadable",
};
/** The parser takes one PDF at a time; wait out `503 busy` until the Activity's own timeout cancels. */
export async function parseSource(
  hostport: string,
  input: Parameters<Ingestion["parse"]>[0],
  signal: AbortSignal,
) {
  let response: Response;
  for (let pause = 250; ; pause = Math.min(pause * 2, 15_000)) {
    response = await fetch(`http://${hostport}/parse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      // Above the parser's own 240 s deadline plus its 15 s download.
      signal: AbortSignal.any([AbortSignal.timeout(300_000), signal]),
    });
    if (response.status !== 503) break;
    await response.body?.cancel();
    await sleep(pause, undefined, { signal });
  }
  if (!response.ok) {
    const { error } = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    const failure =
      error && Object.hasOwn(parserFailures, error)
        ? parserFailures[error]
        : undefined;
    throw failure
      ? new IngestionError(failure)
      : new Error(`Parser refused Source (${response.status})`);
  }
  if (!response.body) throw new Error("Empty parser response");
  const parts: Uint8Array[] = [];
  let bytes = 0;
  for await (const part of response.body) {
    bytes += part.length;
    // The parser's 64 MiB output bound plus JSON framing.
    if (bytes > 72 * 1024 * 1024)
      throw new Error("Parser response exceeds its bound");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString()) as Awaited<
    ReturnType<Ingestion["parse"]>
  >;
}
export type SourceActivities = ReturnType<
  typeof createSourceActivities
>["activities"];
