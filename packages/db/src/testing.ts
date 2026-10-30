/**
 * A throwaway Postgres with every migration applied, for integration tests.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";

export interface TestDatabase {
  connectionString: string;
  stop(): Promise<void>;
}

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer(
    "pgvector/pgvector:0.8.7-pg18",
  ).start();
  const connectionString = container.getConnectionUri();

  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: "pipe",
  });

  return {
    connectionString,
    stop: async () => {
      await container.stop();
    },
  };
}
