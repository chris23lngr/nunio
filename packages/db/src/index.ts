/**
 * Prisma 7 client and multi-file schema; one schema file per owning module.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import pg from "pg";
import { PrismaClient } from "./generated/prisma/client.js";

export { PrismaClient };
export type Pool = pg.Pool;

/**
 * Runtime `pg` pool over TCP; pass Neon's pooled URL. On Vercel Fluid compute, `attachDatabasePool`
 * keeps the instance alive until idle clients are released, so connections are reused across
 * invocations without leaking when the instance suspends. Outside Vercel it does nothing.
 */
export function createPool(connectionString: string): Pool {
  const pool = new pg.Pool({ connectionString, idleTimeoutMillis: 5_000 });
  attachDatabasePool(pool);
  return pool;
}

/** Runtime client over `pool`; `$disconnect()` ends the pool. */
export function createPrismaClient(pool: Pool): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
}
