import type { PrismaClient } from "@nunio/db";
import type { ToolDefinition } from "./pin.js";

/** An Integration a student can connect, as Einstellungen › Verbindungen shows it. */
export interface CatalogIntegration {
  key: string;
  name: string;
  /** The path of its logo in the web app. */
  logo: string;
  description: string;
  /** Where the vendor processes data. */
  dataNote: string;
  kind: "mcp" | "email";
}

/** How nunio treats a tool (#262): read freely, ask with Immer erlaubt possible, always ask, or never offer. */
export type ToolClass = "read" | "write" | "write_always_asked" | "blocked";

/** A tool nunio reviewed and classified, with its pin. */
export interface CatalogTool {
  /** The server's own tool name. */
  name: string;
  class: ToolClass;
  /** nunio's German label. */
  label: string;
  /** The argument an Approval card shows first. */
  headlineArgument: string | null;
  /** Offered only in a Chat, never to an Agent. */
  chatOnly: boolean;
  definition: ToolDefinition;
  definitionHash: string;
  reviewedAt: Date | null;
}

/** The Integration catalog: database rows, seeded and changed through migrations (#280). */
export function createCatalog({ db }: { db: PrismaClient }) {
  return {
    /** The Integrations students can connect, by name; hidden and withdrawn ones are left out. */
    async offered(): Promise<CatalogIntegration[]> {
      const rows = await db.integration.findMany({
        where: { status: "offered" },
        orderBy: { name: "asc" },
      });
      return rows.map((row) => ({
        key: row.key,
        name: row.name,
        logo: row.logo,
        description: row.description,
        dataNote: row.dataNote,
        kind: row.kind as CatalogIntegration["kind"],
      }));
    },
    /** An Integration's classified tools, by name. */
    async tools(integrationKey: string): Promise<CatalogTool[]> {
      const rows = await db.integrationTool.findMany({
        where: { integrationKey },
        orderBy: { name: "asc" },
      });
      return rows.map((row) => ({
        name: row.name,
        class: row.class as ToolClass,
        label: row.label,
        headlineArgument: row.headlineArgument,
        chatOnly: row.chatOnly,
        definition: row.definition as unknown as ToolDefinition,
        definitionHash: row.definitionHash,
        reviewedAt: row.reviewedAt,
      }));
    },
  };
}

export type Catalog = ReturnType<typeof createCatalog>;

/** Whether "Immer erlaubt" may apply to a tool: only a plain write, never an always-asked or Chat-only one. */
export function isGrantable(tool: Pick<CatalogTool, "class" | "chatOnly">) {
  return tool.class === "write" && !tool.chatOnly;
}
