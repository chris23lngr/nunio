/**
 * A throwaway Postgres with every migration applied, for integration tests.
 *
 * With DATABASE_URL_UNPOOLED and DATABASE_URL set (a throwaway Neon branch), migrates over the
 * unpooled URL and hands tests the pooled one; otherwise starts a Testcontainers Postgres.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
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
      runtimeConnectionString: await createRuntimeLogin(
        connectionString,
        connectionString,
      ),
      stop: async () => {
        await container.stop();
      },
    };
  } catch (error) {
    await container.stop();
    throw error;
  }
}

export interface DatabaseBeforeMigration {
  /** The migration role, which owns the tables. */
  connectionString: string;
  /** Applies the migration the database stopped before, and only that one. */
  applyMigration(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * A throwaway Testcontainers Postgres with only the migrations before `migration` applied, for testing what that
 * migration does to rows seeded as the schema stood then. A shared Neon branch is already fully migrated, so this
 * always starts a container.
 */
export async function startTestDatabaseBefore(
  migration: string,
): Promise<DatabaseBeforeMigration> {
  const migrations = join(packageDir, "prisma", "migrations");
  const names = readdirSync(migrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (!names.includes(migration)) throw new Error(`No migration ${migration}`);
  const container = await new PostgreSqlContainer(
    "pgvector/pgvector:0.8.7-pg18",
  ).start();
  const connectionString = container.getConnectionUri();
  // Each migration's SQL as one script, as `prisma migrate deploy` sends it.
  const apply = async (name: string) => {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      await client.query(
        readFileSync(join(migrations, name, "migration.sql"), "utf8"),
      );
    } finally {
      await client.end();
    }
  };
  try {
    for (const name of names.slice(0, names.indexOf(migration)))
      await apply(name);
  } catch (error) {
    await container.stop();
    throw error;
  }
  return {
    connectionString,
    applyMigration: () => apply(migration),
    stop: async () => {
      await container.stop();
    },
  };
}

function migrate(url: string): void {
  const prismaCli = createRequire(import.meta.url).resolve(
    "prisma/build/index.js",
  );
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

/** Creates a uniquely named runtime login, so concurrent suites never share one; returns `target` as it. */
async function createRuntimeLogin(
  adminUrl: string,
  target: string,
): Promise<string> {
  const user = `nunio_runtime_test_${randomBytes(6).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(
      `CREATE ROLE ${user} LOGIN PASSWORD '${password}' IN ROLE nunio_runtime`,
    );
  } finally {
    await client.end();
  }
  const url = new URL(target);
  url.username = user;
  url.password = password;
  return url.toString();
}
