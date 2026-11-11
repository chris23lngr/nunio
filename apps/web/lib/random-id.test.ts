import { afterEach, expect, test, vi } from "vitest";
import { randomId } from "./random-id";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

test("gives a v4 UUID where the browser has no randomUUID, as on plain HTTP", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
  const first = randomId();
  expect(first).toMatch(uuid);
  expect(randomId()).not.toBe(first);
});

test("uses the browser's randomUUID where it has one", () => {
  expect(randomId()).toMatch(uuid);
});
