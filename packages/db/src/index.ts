/**
 * Prisma 7 client and multi-file schema; one schema file per owning module.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export { PrismaClient };

/** Runtime client over TCP `pg`; pass Neon's pooled URL. */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
