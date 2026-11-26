/**
 * What the model sees of an Integration read (#273, ADR-0026 "Integration content"): only text, fenced as `Untrusted`
 * data, at most `READ_RESULT_MAX_CHARACTERS` of it.
 */
import { randomBytes } from "node:crypto";

/** The most characters of a read's result the model sees; the rest is cut, with no paging. */
export const READ_RESULT_MAX_CHARACTERS = 20_000;

/** The parts of an MCP tool result nunio reads. */
export interface ToolResult {
  content?: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
}

type Content =
  | { type: "text"; text: string }
  | { type: "image" | "audio"; mimeType?: string; data?: string }
  | {
      type: "resource";
      resource: { mimeType?: string; text?: string; blob?: string };
    }
  | { type: string };

/** The size of base64 data, as a person reads it. */
function sizeOf(base64: string | undefined) {
  const padding = base64?.endsWith("==") ? 2 : base64?.endsWith("=") ? 1 : 0;
  const bytes = Math.max(
    0,
    Math.floor(((base64?.length ?? 0) * 3) / 4) - padding,
  );
  return bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`;
}

/** One content part as text: its own text, or one line naming what isn't text. */
function textOf(part: Content): string {
  if (part.type === "text" && "text" in part) return part.text;
  if ((part.type === "image" || part.type === "audio") && "data" in part)
    return `[${part.type}, ${part.mimeType ?? "unknown type"}, ${sizeOf(part.data)}, not shown]`;
  if (part.type === "resource" && "resource" in part) {
    const { resource } = part;
    if (typeof resource.text === "string") return resource.text;
    return `[file, ${resource.mimeType ?? "unknown type"}, ${sizeOf(resource.blob)}, not shown]`;
  }
  return `[${part.type}, not shown]`;
}

/** Service text in a nonce fence, as data the model must never follow. Fence look-alikes are escaped. */
function fenced(text: string) {
  const nonce = randomBytes(8).toString("hex");
  const escaped = text.replaceAll("<<<", "‹‹‹").replaceAll(">>>", "›››");
  return [
    `<<<BEGIN untrusted ${nonce}>>>`,
    escaped,
    `<<<END untrusted ${nonce}>>>`,
  ].join("\n");
}

/** A read's result as the model sees it: its text fenced and cut at the cap, then `truncated: true` if it was cut. */
export function shapeResult(result: ToolResult): string {
  const parts = (result.content ?? []) as Content[];
  const text =
    parts.length || result.structuredContent === undefined
      ? parts.map(textOf).join("\n")
      : JSON.stringify(result.structuredContent);
  const truncated = text.length > READ_RESULT_MAX_CHARACTERS;
  const shaped = fenced(text.slice(0, READ_RESULT_MAX_CHARACTERS));
  const body = truncated ? `${shaped}\ntruncated: true` : shaped;
  return result.isError ? `The service reported an error:\n${body}` : body;
}

/** A service's error message (a JSON-RPC error) as the model sees it: fenced like any result. */
export function shapeError(message: string): string {
  return shapeResult({
    content: [{ type: "text", text: message }],
    isError: true,
  });
}
