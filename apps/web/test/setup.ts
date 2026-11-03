import { cleanup } from "@testing-library/react";
import { afterEach, afterAll, beforeAll, vi } from "vitest";
import { setupServer } from "msw/node";

export const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => { cleanup(); server.resetHandlers(); vi.restoreAllMocks(); vi.useRealTimers(); });
afterAll(() => server.close());
