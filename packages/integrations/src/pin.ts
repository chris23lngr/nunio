import { createHash } from "node:crypto";

/** What the model sees of a tool, as pinned when nunio reviewed it (#262). */
export interface ToolDefinition {
  description: string;
  inputSchema: Record<string, unknown>;
}

/** The hash a definition is pinned by: sha256 over its JSON with sorted keys and no whitespace. */
export function definitionHash(definition: ToolDefinition): string {
  return createHash("sha256").update(canonical(definition)).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
