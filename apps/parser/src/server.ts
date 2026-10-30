import { createServer, type Server } from "node:http";

/** Document parsing service. Holds no secrets; reachable only from the worker (ADR-0009). */
export function createParserServer(): Server {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404).end();
  });
}
