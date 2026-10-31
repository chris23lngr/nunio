/**
 * A throwaway Postgres with every migration applied, for integration tests.
 *
 * With DATABASE_URL_UNPOOLED and DATABASE_URL set (a throwaway Neon branch), migrates over the
 * unpooled URL and hands tests the pooled one; otherwise starts a Testcontainers Postgres.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";

export interface TestDatabase {
  /** The migration role, which owns the tables. */
  connectionString: string;
  /** A login role in `nunio_runtime`, subject to RLS like the deployed API. */
  runtimeConnectionString: string;
  stop(): Promise<void>;
}

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function startTestDatabase(): Promise<TestDatabase> {
  const { DATABASE_URL: pooled, DATABASE_URL_UNPOOLED: unpooled } = process.env;
  if (pooled && unpooled) {
    migrate(unpooled);
    return {
      connectionString: pooled,
      runtimeConnectionString: await createRuntimeLogin(unpooled, pooled),
      stop: async () => {},
    };
  }

  const container = await new PostgreSqlContainer(
    "pgvector/pgvector:0.8.7-pg18",
  ).start();
  try {
    const connectionString = container.getConnectionUri();
    migrate(connectionString);
    return {
      connectionString,
      runtimeConnectionString: await createRuntimeLogin(connectionString, connectionString),
      stop: async () => {
        await container.stop();
      },
    };
  } catch (error) {
    await container.stop();
    throw error;
  }
}

function migrate(url: string): void {
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

/** Creates a uniquely named runtime login, so concurrent suites never share one; returns `target` as it. */
async function createRuntimeLogin(adminUrl: string, target: string): Promise<string> {
  const user = `nunio_runtime_test_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE ROLE ${user} LOGIN PASSWORD '${password}' IN ROLE nunio_runtime`);
  } finally {
    await client.end();
  }
  const url = new URL(target);
  url.username = user;
  url.password = password;
  return url.toString();
}
