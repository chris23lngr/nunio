// Model Catalog Activities (ADR-0017): the daily price sync, and the task Models read at start.

import { fetchZeroRetentionPrices } from "@nunio/ai";
import { createPool, createPrismaClient } from "@nunio/db";
import { createModelCatalog } from "@nunio/delegation";
import { log } from "./log.js";

export function createModelCatalogActivities(env: NodeJS.ProcessEnv) {
  for (const name of ["DATABASE_URL", "OPENROUTER_BASE_URL"])
    if (!env[name]) throw new Error(`Missing settings: ${name}`);
  const db = createPrismaClient(createPool(env.DATABASE_URL!));
  const catalog = createModelCatalog({ db, clock: { now: () => new Date() } });
  return {
    taskModels: () => catalog.taskModels(),
    async close() {
      await db.$disconnect();
    },
    activities: {
      /** Fails loudly, so a broken sync shows as a failing Schedule long before prices go stale. */
      async syncModelPrices() {
        try {
          const synced = await fetchZeroRetentionPrices({
            baseURL: env.OPENROUTER_BASE_URL!,
            only: new Set(await catalog.providerModelIds()),
          });
          await catalog.applySync(synced);
          log("model prices synced", { models: [...synced.keys()] });
        } catch (error) {
          log("model price sync failed", {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    },
  };
}
