import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { maxPdfBytes, parsePdf, ParseError } from "./pdf.js";

/** No secrets: the worker supplies only one file's short-lived URL and key (ADR-0009). */
export function createParserServer(options: {
  storageEndpoint?: string; quarantineBucket?: string; fetch?: typeof fetch;
} = {}): Server {
  const endpoint = new URL(options.storageEndpoint ?? process.env.PARSER_STORAGE_ENDPOINT ?? "https://fsn1.your-objectstorage.com");
  const bucket = options.quarantineBucket ?? process.env.PARSER_QUARANTINE_BUCKET ?? "nunio-quarantine-staging";
  let busy = false;
  return createServer(async (req, res) => {
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    };
    if (req.method === "GET" && req.url === "/health") return json(200, { status: "ok" });
    if (req.method !== "POST" || req.url !== "/parse") { res.writeHead(404).end(); return; }
    if (busy) return json(503, { error: "busy" });
    busy = true;
    try {
      const chunks: Buffer[] = [];
      let bodyBytes = 0;
      for await (const chunk of req) {
        bodyBytes += chunk.length;
        if (bodyBytes > 16_384) throw new ParseError(413, "request_limit");
        chunks.push(Buffer.from(chunk));
      }
      let input: { url?: unknown; keyBase64?: unknown; expectedBytes?: unknown; etag?: unknown };
      try { input = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { throw new ParseError(400, "invalid_request"); }
      if (!input || typeof input.url !== "string" || typeof input.keyBase64 !== "string"
        || !Number.isSafeInteger(input.expectedBytes) || Number(input.expectedBytes) <= 0 || Number(input.expectedBytes) > maxPdfBytes) {
        throw new ParseError(400, "invalid_request");
      }
      let url: URL;
      try { url = new URL(input.url); } catch { throw new ParseError(400, "invalid_url"); }
      const pathStyle = url.hostname === endpoint.hostname && url.pathname.startsWith(`/${bucket}/`);
      const virtualHost = url.hostname === `${bucket}.${endpoint.hostname}` && url.pathname.length > 1;
      if (url.protocol !== "https:" || url.port || url.username || url.password || url.hash || !(pathStyle || virtualHost)) {
        throw new ParseError(400, "invalid_url");
      }
      const key = Buffer.from(input.keyBase64, "base64");
      if (key.length !== 32 || key.toString("base64") !== input.keyBase64) throw new ParseError(400, "invalid_key");
      const response = await (options.fetch ?? fetch)(url, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: {
        ...(typeof input.etag === "string" ? { "if-match": input.etag } : {}),
        "x-amz-server-side-encryption-customer-algorithm": "AES256",
        "x-amz-server-side-encryption-customer-key": input.keyBase64,
        "x-amz-server-side-encryption-customer-key-md5": createHash("md5").update(key).digest("base64"),
      } });
      if (!response.ok || !response.body) throw new ParseError(502, "storage_unavailable");
      const parts: Uint8Array[] = [];
      let size = 0;
      for await (const part of response.body) {
        size += part.length;
        if (size > Number(input.expectedBytes) || size > maxPdfBytes) throw new ParseError(413, "size_mismatch");
        parts.push(part);
      }
      if (size !== input.expectedBytes) throw new ParseError(422, "size_mismatch");
      return json(200, await parsePdf(Buffer.concat(parts)));
    } catch (error) {
      return json(error instanceof ParseError ? error.status : 502,
        { error: error instanceof ParseError ? error.message : "parser_unavailable" });
    } finally { busy = false; }
  });
}
