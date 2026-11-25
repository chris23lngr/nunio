/**
 * Seeds the Integration catalog for the fakes, for the dev stack's migrate step:
 * `node --import tsx src/testing/run-seed.ts`.
 *
 * `DATABASE_URL` connects as the migration role. `FAKE_MCP_URL` is the origin the fake MCP server is reached at.
 */
import { createPool, createPrismaClient } from "@nunio/db";
import { seedIntegrationCatalog } from "./seed.js";

const { DATABASE_URL, FAKE_MCP_URL } = process.env;
if (!DATABASE_URL || !FAKE_MCP_URL)
  throw new Error("DATABASE_URL and FAKE_MCP_URL must be set");
const db = createPrismaClient(createPool(DATABASE_URL));
try {
  await seedIntegrationCatalog(db, {
    url: FAKE_MCP_URL,
    mcpUrl: `${FAKE_MCP_URL}/mcp`,
  });
} finally {
  await db.$disconnect();
}
console.log(`Seeded Testnotizen at ${FAKE_MCP_URL}/mcp and offered Email`);
