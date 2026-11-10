import { createServer } from "node:http";
import { afterAll, afterEach, beforeAll, expect } from "vitest";

type Handler = (request: Request) => Response | Promise<Response>;
const handlers = new Map<string, Handler>();
const errors: unknown[] = [];

/** An isolated HTTP API fixture: the real transport and fetch stay in use. */
export const api = {
  origin: "",
  route(method: string, path: string, handler: Handler) {
    handlers.set(`${method} ${path}`, handler);
  },
};
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const url = new URL(incoming.url!, api.origin);
    const handler = handlers.get(`${incoming.method} ${url.pathname}`);
    if (!handler)
      throw new Error(
        `Unhandled test request: ${incoming.method} ${url.pathname}`,
      );
    const request = new Request(url, {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.flushHeaders();
    if (response.body) {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          outgoing.write(next.value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    outgoing.end();
  } catch (error) {
    errors.push(error);
    outgoing.writeHead(500).end();
  }
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test API did not start");
  api.origin = `http://127.0.0.1:${address.port}`;
});
afterEach(() => {
  handlers.clear();
  const failures = errors.splice(0);
  expect(failures).toEqual([]);
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
