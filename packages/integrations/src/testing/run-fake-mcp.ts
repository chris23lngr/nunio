/**
 * Runs the fake MCP server standalone, for dev and e2e: `node --import tsx src/testing/run-fake-mcp.ts`.
 *
 * `HOST` and `PORT` bind it. `PUBLIC_URL` is the origin clients reach it at, needed when that isn't the bound address.
 * `TLS_KEY` and `TLS_CERT` are paths to PEM files, which switch it to HTTPS.
 */
import { readFileSync } from "node:fs";
import { startFakeMcpServer } from "./mcp-server.js";

const { HOST, PORT, PUBLIC_URL, TLS_KEY, TLS_CERT } = process.env;
const server = await startFakeMcpServer({
  host: HOST,
  port: PORT ? Number(PORT) : undefined,
  url: PUBLIC_URL,
  tls:
    TLS_KEY && TLS_CERT
      ? { key: readFileSync(TLS_KEY), cert: readFileSync(TLS_CERT) }
      : undefined,
});
console.log(`Testnotizen serves MCP at ${server.mcpUrl}`);
