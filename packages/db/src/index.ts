/**
 * Prisma 7 client and multi-file schema; one schema file per owning module.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { PrismaClient } from "./generated/prisma/client.js";

export {
  CourseStatus,
  ExtractionStatus,
  FactType,
  Grounding,
  ObligationKind,
  ReviewState,
  SourceFailure,
  SourceStatus,
  Unsupported,
} from "./generated/prisma/enums.js";
export { PrismaClient };
export type Pool = pg.Pool;

/**
 * Runtime `pg` pool over TCP; pass Neon's pooled URL. Idle connections close after 5 s, so a
 * suspended serverless instance holds none; the cost is a reconnect after 5 s without queries.
 */
export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString, idleTimeoutMillis: 5_000 });
}

/** Runtime client over `pool`; `$disconnect()` ends the pool. */
export function createPrismaClient(pool: Pool): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg(pool, { disposeExternalPool: true }),
  });
}
