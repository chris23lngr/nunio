// Artifact Activities: the one step of an Artifact's Run, made from material pinned when the student asked.

import type { ModelConfig } from "@nunio/ai";
import { createEmbedder, createMaker, createModels } from "@nunio/ai";
import { createArtifacts } from "@nunio/artifacts";
import { createPool, createPrismaClient } from "@nunio/db";
import { createDelegation, createResponsibilities } from "@nunio/delegation";
import { sourceKeysFromEnv } from "@nunio/keys";
import { createFacts, createKnowledgeReader } from "@nunio/knowledge";
import { log } from "./log.js";

const settings = [
  "DATABASE_URL",
  "SOURCE_KEY_VERSION",
  "SOURCE_MASTER_KEYS",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
];

/** `catalog` is the Model Catalog's task Models, read once at start. */
export function createArtifactActivities(
  env: NodeJS.ProcessEnv,
  catalog: readonly ModelConfig[],
) {
  const missing = settings.filter((name) => !env[name]);
  if (missing.length)
    throw new Error(`Missing settings: ${missing.join(", ")}`);
  const db = createPrismaClient(createPool(env.DATABASE_URL!));
  const keys = sourceKeysFromEnv(env);
  const clock = { now: () => new Date() };
  const provider = {
    apiKey: env.OPENROUTER_API_KEY!,
    baseURL: env.OPENROUTER_BASE_URL!,
  };
  const delegation = createDelegation({
    db,
    aiEnabled: () => env.AI_DISABLED !== "true",
  });
  const artifacts = createArtifacts({
    db,
    keys,
    reader: createKnowledgeReader({
      db,
      keys,
      embedder: createEmbedder(provider),
      delegation,
      clock,
    }),
    facts: createFacts({ db, keys, clock }),
    responsibilities: createResponsibilities({ db, clock }),
    delegation,
    maker: createMaker(createModels({ ...provider, catalog })),
    clock,
  });
  return {
    async close() {
      await db.$disconnect();
    },
    activities: {
      async makeArtifact(runId: string) {
        const result = await artifacts.make(runId);
        // IDs and outcomes only: never Artifact content.
        log("artifact made", { runId, result });
        return result;
      },
    },
  };
}
