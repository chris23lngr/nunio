import { createServer } from "node:http";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect } from "vitest";

type Handler = (request: Request) => Response | Promise<Response>;
const handlers = new Map<string, Handler>();
const errors: unknown[] = [];

// Requests still unanswered, so a test ends only once its own handlers served them.
const pending = new Set<Promise<unknown>>();
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const response = realFetch(input, init);
  const settled: Promise<unknown> = response.then(
    () => pending.delete(settled),
    () => pending.delete(settled),
  );
  pending.add(settled);
  return response;
};

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
    // Local tools probe new ports (T3 Code sends GET / to localhost:<port>).
    if (incoming.headers.host !== url.host) {
      outgoing.writeHead(404).end();
      return;
    }
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
afterEach(async () => {
  // Unmount first: a failure below must not leave this test's app running into the next.
  cleanup();
  while (pending.size) await Promise.all(pending);
  handlers.clear();
  const failures = errors.splice(0);
  expect(failures).toEqual([]);
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
