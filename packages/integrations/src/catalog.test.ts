import type { PrismaClient } from "@nunio/db";
import { createPool, createPrismaClient } from "@nunio/db";
import type { TestDatabase } from "@nunio/db/testing";
import { startTestDatabase } from "@nunio/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Catalog, CatalogTool } from "./index.js";
import { createCatalog, definitionHash, isGrantable } from "./index.js";
import { seedIntegrationCatalog, testnotizenTools } from "./testing.js";

let db: TestDatabase;
/** The migration role, which seeds as the dev migrate step does. */
let admin: PrismaClient;
/** The restricted runtime role, as the API and worker connect. */
let runtime: PrismaClient;
let catalog: Catalog;

const fake = {
  url: "https://mcp.nunio.test",
  mcpUrl: "https://mcp.nunio.test/mcp",
};

beforeAll(async () => {
  db = await startTestDatabase();
  admin = createPrismaClient(createPool(db.connectionString));
  runtime = createPrismaClient(createPool(db.runtimeConnectionString));
  catalog = createCatalog({ db: runtime });
}, 180_000);

afterAll(async () => {
  await runtime?.$disconnect();
  await admin?.$disconnect();
  await db?.stop();
});

describe("the Integration catalog as migrated", () => {
  it("offers nothing, because Email is seeded hidden until the eval passes", async () => {
    expect(await catalog.offered()).toEqual([]);
  });

  it("seeds Email's six tools with fixed classes and labels, and only email.submit Chat-only", async () => {
    const tools = await catalog.tools("email");
    expect(
      Object.fromEntries(
        tools.map((tool) => [
          tool.name,
          [tool.class, tool.label, tool.headlineArgument, tool.chatOnly],
        ]),
      ),
    ).toEqual({
      "email.search": ["read", "Mails durchsuchen", null, false],
      "email.read": ["read", "Mail lesen", null, false],
      "email.send": ["write_always_asked", "Mail senden", "to", false],
      "email.reply": [
        "write_always_asked",
        "Auf Mail antworten",
        "body",
        false,
      ],
      "email.forward": ["write_always_asked", "Mail weiterleiten", "to", false],
      "email.submit": [
        "write_always_asked",
        "Per E-Mail abgeben",
        "subject",
        true,
      ],
    });
  });

  it("pins each Email tool to its definition with the spec's arguments", async () => {
    const tools = await catalog.tools("email");
    const argumentsOf = (name: string) =>
      Object.keys(
        tools.find((tool) => tool.name === name)!.definition.inputSchema
          .properties as object,
      ).sort();
    expect(argumentsOf("email.search")).toEqual(
      ["folder", "sender", "text", "since", "before", "unread", "limit"].sort(),
    );
    expect(argumentsOf("email.read")).toEqual(["messageId"]);
    expect(argumentsOf("email.send")).toEqual(
      ["to", "cc", "bcc", "subject", "body"].sort(),
    );
    expect(argumentsOf("email.reply")).toEqual(
      ["messageId", "replyAll", "body"].sort(),
    );
    expect(argumentsOf("email.forward")).toEqual(
      ["messageId", "to", "cc", "note"].sort(),
    );
    expect(argumentsOf("email.submit")).toEqual(
      ["obligationId", "attachments", "subject", "body"].sort(),
    );
  });
});

describe("the dev and test seed", () => {
  beforeAll(async () => {
    await seedIntegrationCatalog(admin, fake);
    // The dev migrate step runs it on every start.
    await seedIntegrationCatalog(admin, fake);
  });

  it("offers Email and Testnotizen", async () => {
    expect(await catalog.offered()).toEqual([
      {
        key: "email",
        name: "E-Mail",
        logo: "/integrations/email.svg",
        description:
          "Mails deiner Uni-Adresse durchsuchen und lesen, nach deiner Freigabe senden",
        dataNote: "Daten werden von deiner Hochschule verarbeitet",
        kind: "email",
      },
      {
        key: "testnotizen",
        name: "Testnotizen",
        logo: "/integrations/testnotizen.svg",
        description: "Notizen durchsuchen und lesen, Seiten anlegen",
        dataNote: "Test-Dienst, Daten bleiben auf deinem Rechner",
        kind: "mcp",
      },
    ]);
  });

  it("pins Testnotizen's tools to the fake MCP server's definitions, with classes and labels", async () => {
    const tools = await catalog.tools("testnotizen");
    expect(tools.map((tool) => [tool.name, tool.class, tool.label])).toEqual([
      ["notes.create_page", "write", "Seite anlegen"],
      ["notes.read", "read", "Notiz lesen"],
      ["notes.search", "read", "Notizen durchsuchen"],
      ["notes.share", "write_always_asked", "Notiz teilen"],
    ]);
    for (const served of testnotizenTools) {
      const pinned = tools.find((tool) => tool.name === served.name)!;
      expect(pinned.definition).toEqual({
        description: served.description,
        inputSchema: served.inputSchema,
      });
      expect(pinned.reviewedAt).not.toBeNull();
    }
  });

  it("gives every seeded tool a class, a label and a pin that matches its definition", async () => {
    for (const tool of await allSeededTools()) {
      expect(["read", "write", "write_always_asked", "blocked"]).toContain(
        tool.class,
      );
      expect(tool.label).not.toBe("");
      expect(tool.definitionHash).toBe(definitionHash(tool.definition));
    }
  });

  it("lets only plain write tools be granted, never always-asked or Chat-only ones", async () => {
    const grantable = (await allSeededTools()).filter(isGrantable);
    expect(grantable.map((tool) => tool.name)).toEqual(["notes.create_page"]);
    expect(isGrantable({ class: "write_always_asked", chatOnly: false })).toBe(
      false,
    );
    expect(isGrantable({ class: "write", chatOnly: true })).toBe(false);
    expect(isGrantable({ class: "read", chatOnly: false })).toBe(false);
    expect(isGrantable({ class: "blocked", chatOnly: false })).toBe(false);
  });

  it("resets every column it seeds when run again", async () => {
    await admin.integrationTool.update({
      where: {
        integrationKey_name: {
          integrationKey: "testnotizen",
          name: "notes.search",
        },
      },
      data: { headlineArgument: "query" },
    });
    await admin.integrationTool.update({
      where: {
        integrationKey_name: {
          integrationKey: "testnotizen",
          name: "notes.share",
        },
      },
      data: { chatOnly: true },
    });

    await seedIntegrationCatalog(admin, fake);

    const tools = await catalog.tools("testnotizen");
    const tool = (name: string) => tools.find((t) => t.name === name)!;
    expect(tool("notes.search").headlineArgument).toBeNull();
    expect(tool("notes.share").chatOnly).toBe(false);
    expect(tool("notes.share").headlineArgument).toBe("email");
  });
});

describe("the catalog's database rules", () => {
  const mcpColumns = `"key", "name", "logo", "description", "dataNote", "kind", "mcpUrl", "transport", "scopes", "issuers", "registration"`;
  /** Inserts an MCP Integration as a migration would, with `overrides` replacing column values (as SQL). */
  const insertMcp = (key: string, overrides: Record<string, string> = {}) => {
    const values: Record<string, string> = {
      transport: "'http'",
      scopes: "ARRAY['notes']",
      issuers: "ARRAY['https://mcp.example']",
      registration: "'cimd'",
      ...overrides,
    };
    return admin.$executeRawUnsafe(
      `INSERT INTO "integration" (${mcpColumns}) VALUES ('${key}', 'Dienst', '/integrations/x.svg', 'd', 'n', 'mcp',
        'https://mcp.example/mcp', ${values.transport}, ${values.scopes}, ${values.issuers}, ${values.registration})`,
    );
  };
  const insertTool = (
    name: string,
    definition: string,
    headlineArgument = "NULL",
  ) =>
    admin.$executeRawUnsafe(
      `INSERT INTO "integration_tool" ("integrationKey", "name", "class", "definition", "definitionHash", "label",
        "headlineArgument") VALUES ('email', '${name}', 'read', '${definition}', '${"a".repeat(64)}', 'Test',
        ${headlineArgument})`,
    );
  const valid = `{"description":"d","inputSchema":{"type":"object","properties":{"q":{"type":"string"}}}}`;

  it("lets the runtime read the catalog but never change it", async () => {
    await expect(runtime.integration.findMany()).resolves.toBeDefined();
    await expect(
      runtime.$executeRawUnsafe(
        `INSERT INTO "integration" ("key", "name", "logo", "description", "dataNote", "kind")
          VALUES ('runtime-added', 'X', '/x.svg', 'd', 'n', 'email')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runtime.$executeRawUnsafe(
        `UPDATE "integration" SET "status" = 'offered' WHERE "key" = 'email'`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runtime.$executeRawUnsafe(
        `DELETE FROM "integration" WHERE "key" = 'email'`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runtime.$executeRawUnsafe(
        `INSERT INTO "integration_tool" ("integrationKey", "name", "class", "definition", "definitionHash", "label")
          VALUES ('email', 'email.extra', 'write', '${valid}', '${"a".repeat(64)}', 'X')`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runtime.$executeRawUnsafe(
        `UPDATE "integration_tool" SET "class" = 'write' WHERE "integrationKey" = 'email'`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runtime.$executeRawUnsafe(
        `DELETE FROM "integration_tool" WHERE "integrationKey" = 'email'`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses an MCP Integration without a transport, registration, scopes or issuers", async () => {
    await expect(insertMcp("mcp-complete")).resolves.toBe(1);
    await expect(
      insertMcp("mcp-no-transport", { transport: "NULL" }),
    ).rejects.toThrow(/integration_mcp_check/);
    await expect(
      insertMcp("mcp-no-registration", { registration: "NULL" }),
    ).rejects.toThrow(/integration_mcp_check/);
    await expect(
      insertMcp("mcp-null-issuers", { issuers: "NULL" }),
    ).rejects.toThrow(/null value/);
    await expect(
      insertMcp("mcp-null-scopes", { scopes: "NULL" }),
    ).rejects.toThrow(/null value/);
    await expect(
      insertMcp("mcp-no-issuers", { issuers: "ARRAY[]::TEXT[]" }),
    ).rejects.toThrow(/integration_mcp_check/);
  });

  it("refuses a tool definition without a description and an input schema object", async () => {
    await expect(insertTool("email.valid", valid, "'q'")).resolves.toBe(1);
    await expect(insertTool("email.array", "[]")).rejects.toThrow(
      /integration_tool_definition_check/,
    );
    await expect(
      insertTool("email.no-description", `{"inputSchema":{"type":"object"}}`),
    ).rejects.toThrow(/integration_tool_definition_check/);
    await expect(
      insertTool("email.no-schema", `{"description":"d"}`),
    ).rejects.toThrow(/integration_tool_definition_check/);
    await expect(
      insertTool("email.array-schema", `{"description":"d","inputSchema":[]}`),
    ).rejects.toThrow(/integration_tool_definition_check/);
  });

  it("refuses a headline argument that is not one of the schema's properties", async () => {
    await expect(insertTool("email.other", valid, "'other'")).rejects.toThrow(
      /integration_tool_headlineArgument_check/,
    );
    await expect(
      insertTool(
        "email.no-properties",
        `{"description":"d","inputSchema":{"type":"object"}}`,
        "'q'",
      ),
    ).rejects.toThrow(/integration_tool_headlineArgument_check/);
    await expect(
      insertTool(
        "email.array-properties",
        `{"description":"d","inputSchema":{"type":"object","properties":["q"]}}`,
        "'q'",
      ),
    ).rejects.toThrow(/integration_tool_headlineArgument_check/);
  });
});

/** Every Integration's tools, so a later catalog migration's are checked too. */
async function allSeededTools(): Promise<CatalogTool[]> {
  const integrations = await admin.integration.findMany({
    select: { key: true },
  });
  return (
    await Promise.all(integrations.map(({ key }) => catalog.tools(key)))
  ).flat();
}
