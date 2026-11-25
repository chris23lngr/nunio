/**
 * Offers Integrations in dev and test databases, never through a migration: production offers one only after the
 * Integration injection eval passed (#280).
 */
import type { PrismaClient } from "@nunio/db";
import type { ToolClass } from "../catalog.js";
import { definitionHash } from "../pin.js";
import { testnotizenTools } from "./testnotizen.js";

const testnotizenClasses: Record<
  string,
  { class: ToolClass; label: string; headlineArgument?: string }
> = {
  "notes.search": { class: "read", label: "Notizen durchsuchen" },
  "notes.read": { class: "read", label: "Notiz lesen" },
  "notes.create_page": {
    class: "write",
    label: "Seite anlegen",
    headlineArgument: "title",
  },
  "notes.share": {
    class: "write_always_asked",
    label: "Notiz teilen",
    headlineArgument: "email",
  },
};

/**
 * Adds Testnotizen, served by the fake MCP server at `fake` and registering through CIMD with the fake as its issuer,
 * and offers it and Email. Runs as the migration role, and again on every dev start, so it overwrites what it seeded.
 */
export async function seedIntegrationCatalog(
  db: PrismaClient,
  fake: { url: string; mcpUrl: string },
): Promise<void> {
  const testnotizen = {
    name: "Testnotizen",
    logo: "/integrations/testnotizen.svg",
    description: "Notizen durchsuchen und lesen, Seiten anlegen",
    dataNote: "Test-Dienst, Daten bleiben auf deinem Rechner",
    status: "offered",
    kind: "mcp",
    mcpUrl: fake.mcpUrl,
    transport: "http",
    scopes: ["notes"],
    issuers: [fake.url],
    registration: "cimd",
  };
  const reviewedAt = new Date();
  await db.$transaction([
    db.integration.upsert({
      where: { key: "testnotizen" },
      create: { key: "testnotizen", ...testnotizen },
      update: testnotizen,
    }),
    ...testnotizenTools.map((tool) => {
      const definition = {
        description: tool.description ?? "",
        inputSchema: tool.inputSchema,
      };
      const pinned = {
        ...testnotizenClasses[tool.name]!,
        definition: definition as object,
        definitionHash: definitionHash(definition),
        reviewedAt,
      };
      return db.integrationTool.upsert({
        where: {
          integrationKey_name: {
            integrationKey: "testnotizen",
            name: tool.name,
          },
        },
        create: { integrationKey: "testnotizen", name: tool.name, ...pinned },
        update: pinned,
      });
    }),
    db.integration.update({
      where: { key: "email" },
      data: { status: "offered" },
    }),
  ]);
}
