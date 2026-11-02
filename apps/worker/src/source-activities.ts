import { Context } from "@temporalio/activity";
import { createPool, createPrismaClient, type PrismaClient } from "@nunio/db";
import { createDelegation, principal } from "@nunio/delegation";
import { sourceKeysFromEnv } from "@nunio/keys";
import { createSources, sourceStorageFromEnv, type Ingestion, type Sources } from "@nunio/knowledge";
import { createEmbedder, createModels, createScanReader } from "@nunio/ai";

export interface SourceRun { studentId: string; sourceId: string }
export function createSourceActivities(env: NodeJS.ProcessEnv) {
  let db: PrismaClient | undefined;
  let sources: Sources | undefined;
  const required = (name: string) => { const value = env[name]; if (!value) throw new Error(`${name} is not set`); return value; };
  const runtime = () => {
    db ??= createPrismaClient(createPool(required("DATABASE_URL")));
    sources ??= createSources({ db, keys: sourceKeysFromEnv(env), storage: sourceStorageFromEnv(env) });
    return { db, sources };
  };
  return {
    async close() { await db?.$disconnect(); },
    activities: {
      async processSource({ studentId, sourceId }: SourceRun) {
        const { db, sources } = runtime();
        const context = Context.current();
        const heartbeat = setInterval(() => context.heartbeat(), 5_000);
        try {
          const provider = { apiKey: required("OPENROUTER_API_KEY"), baseURL: required("OPENROUTER_BASE_URL") };
          const deps: Ingestion = {
            signal: context.cancellationSignal,
            delegation: createDelegation({ db, aiEnabled: () => env.AI_DISABLED !== "true" }),
            embedder: createEmbedder(provider), scans: createScanReader(createModels(provider)),
            async parse(input) {
              const response = await fetch(`http://${required("PARSER_HOSTPORT")}/parse`, { method: "POST",
                headers: { "content-type": "application/json" }, body: JSON.stringify(input),
                signal: AbortSignal.any([AbortSignal.timeout(75_000), context.cancellationSignal]) });
              if (!response.ok) throw new Error(`Parser refused Source (${response.status})`);
              if (!response.body) throw new Error("Empty parser response");
              const parts: Uint8Array[] = [];
              let bytes = 0;
              for await (const part of response.body) {
                bytes += part.length;
                if (bytes > 18 * 1024 * 1024) throw new Error("Parser response exceeds its bound");
                parts.push(part);
              }
              return JSON.parse(Buffer.concat(parts).toString()) as Awaited<ReturnType<Ingestion["parse"]>>;
            },
          };
          // Decrypted keys and content stay inside this Activity, never in workflow arguments/results.
          return await sources.ingest(principal.fromSession({ studentId }), sourceId, deps);
        } finally { clearInterval(heartbeat); }
      },
      async purgeSource({ studentId, sourceId }: SourceRun) {
        const { sources } = runtime();
        const p = principal.fromSession({ studentId });
        // Dispatch precedes API deletion: finish the tombstone even if the API process stopped.
        await sources.remove(p, sourceId);
        await sources.purge(p, sourceId);
      },
    },
  };
}
export type SourceActivities = ReturnType<typeof createSourceActivities>["activities"];
