import { createHash } from "node:crypto";

/** What the model sees of a tool, as pinned when nunio reviewed it (#262). */
export interface ToolDefinition {
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * The hash a definition is pinned by: sha256 over its JSON with sorted keys and no whitespace. Undefined values read
 * as JSON.stringify and Postgres store them (a key left out, null in an array), so a definition hashes alike in
 * memory and read back.
 */
export function definitionHash(definition: ToolDefinition): string {
  return createHash("sha256").update(canonical(definition)).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonical(item ?? null)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
