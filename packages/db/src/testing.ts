/**
 * A throwaway Postgres with every migration applied, for integration tests.
 *
 * With DATABASE_URL_UNPOOLED and DATABASE_URL set (a throwaway Neon branch), migrates over the
 * unpooled URL and hands tests the pooled one; otherwise starts a Testcontainers Postgres.
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
  const { DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: unpooled } = process.env;
  if (pooled && unpooled) {
    migrate(unpooled);
    return { connectionString: pooled, stop: async () => {} };
  }

  const container = await new PostgreSqlContainer(
    "pgvector/pgvector:0.8.7-pg18",
  ).start();
  const connectionString = container.getConnectionUri();
  migrate(connectionString);

  return {
    connectionString,
    stop: async () => {
      await container.stop();
    },
  };
}

function migrate(url: string): void {
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
