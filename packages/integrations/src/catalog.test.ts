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
